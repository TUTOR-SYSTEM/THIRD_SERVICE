import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ERROR_MESSAGES } from 'src/data/constants';
import type {
  CreateTestFixtureDto,
  FixtureResolverDto,
  UpdateTestFixtureDto,
} from '@packages/entities/test-scenario';
import { TestAuthService } from './test-auth.service';
import { TestFixtureRepository, type TestFixtureRow } from './test-fixture.repository';
import { extractPath } from './test-template';

const RESOLVE_TIMEOUT_MS = 10_000;

/** A fixture a scenario references can't produce a value — recorded on the run, not thrown. */
export class FixtureError extends Error {}

/**
 * Named values for `{{fixture.<key>}}`: a fixed value, or one fetched through the gateway with a
 * resolver (`GET path` as some auth profile, then a dot path into the JSON). A resolved value is
 * cached on the row until resolved again, so runs don't refetch it every time.
 */
@Injectable()
export class TestFixtureService {
  constructor(
    private readonly repo: TestFixtureRepository,
    private readonly auth: TestAuthService,
  ) {}

  findAll() {
    return this.repo.findAll();
  }

  async create(dto: CreateTestFixtureDto) {
    if (await this.repo.findByKey(dto.key)) {
      throw new ConflictException(ERROR_MESSAGES.TEST_FIXTURE_KEY_TAKEN);
    }
    return this.repo.create(dto);
  }

  async update(id: string, dto: UpdateTestFixtureDto) {
    if (dto.key) {
      const other = await this.repo.findByKey(dto.key);
      if (other && other.id !== id) throw new ConflictException(ERROR_MESSAGES.TEST_FIXTURE_KEY_TAKEN);
    }
    // A new resolver invalidates the value cached from the old one.
    const patch = dto.resolver !== undefined && dto.value === undefined ? { ...dto, value: null, resolvedAt: null } : dto;
    const row = await this.repo.update(id, patch);
    if (!row) throw new NotFoundException(ERROR_MESSAGES.TEST_FIXTURE_NOT_FOUND);
    return row;
  }

  async delete(id: string) {
    const row = await this.repo.delete(id);
    if (!row) throw new NotFoundException(ERROR_MESSAGES.TEST_FIXTURE_NOT_FOUND);
    return row;
  }

  /** "Resolve now" from the UI: refetches a resolver fixture (a fixed one is returned as is). */
  async resolve(id: string, callerToken?: string) {
    const fixture = await this.repo.findById(id);
    if (!fixture) throw new NotFoundException(ERROR_MESSAGES.TEST_FIXTURE_NOT_FOUND);
    if (!fixture.resolver) return fixture;
    try {
      return await this.resolveRow(fixture, callerToken);
    } catch (err) {
      throw new BadRequestException(
        `${ERROR_MESSAGES.TEST_FIXTURE_RESOLVE_FAILED}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Value of `{{fixture.<key>}}` for a run; resolves (and caches) it on first use. */
  async valueFor(key: string, callerToken?: string): Promise<string> {
    const fixture = await this.repo.findByKey(key);
    if (!fixture) throw new FixtureError(`Unknown fixture "${key}"`);
    if (fixture.value != null) return fixture.value;
    if (!fixture.resolver) throw new FixtureError(`Fixture "${key}" has no value`);
    const row = await this.resolveRow(fixture, callerToken);
    return row.value!;
  }

  private async resolveRow(fixture: TestFixtureRow, callerToken?: string) {
    const resolver = fixture.resolver as FixtureResolverDto;
    const token = await this.auth.tokenFor(resolver.authProfile, callerToken);
    const baseUrl = (process.env.GATEWAY_BASE_URL ?? 'http://localhost:8888').replace(/\/+$/, '');

    let res: Response;
    try {
      res = await fetch(`${baseUrl}${resolver.path}`, {
        method: 'GET',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
      });
    } catch (err) {
      throw new FixtureError(
        `Fixture "${fixture.key}": GET ${resolver.path} failed (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    if (!res.ok) throw new FixtureError(`Fixture "${fixture.key}": GET ${resolver.path} returned ${res.status}`);

    const body: unknown = await res.json().catch(() => undefined);
    const extracted = extractPath(body, resolver.extract);
    if (extracted === undefined || extracted === null) {
      throw new FixtureError(`Fixture "${fixture.key}": nothing at "${resolver.extract}" in GET ${resolver.path}`);
    }
    const value =
      typeof extracted === 'string' ? extracted : JSON.stringify(extracted);
    const row = await this.repo.update(fixture.id, { value, resolvedAt: new Date() });
    return row ?? { ...fixture, value };
  }
}
