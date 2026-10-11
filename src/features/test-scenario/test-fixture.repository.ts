import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../database/database.module';
import { testFixtures } from '../../database/schema';
import type { CreateTestFixtureDto, UpdateTestFixtureDto } from '@packages/entities/test-scenario';

export type TestFixtureRow = typeof testFixtures.$inferSelect;

@Injectable()
export class TestFixtureRepository {
  constructor(
    @Inject(DRIZZLE)
    private readonly db: ReturnType<typeof drizzle>,
  ) {}

  findAll() {
    return this.db.select().from(testFixtures).orderBy(asc(testFixtures.key));
  }

  async findById(id: string): Promise<TestFixtureRow | null> {
    const [row] = await this.db.select().from(testFixtures).where(eq(testFixtures.id, id));
    return row ?? null;
  }

  async findByKey(key: string): Promise<TestFixtureRow | null> {
    const [row] = await this.db.select().from(testFixtures).where(eq(testFixtures.key, key));
    return row ?? null;
  }

  async create(data: CreateTestFixtureDto) {
    const [row] = await this.db.insert(testFixtures).values(data).returning();
    return row;
  }

  async update(id: string, data: UpdateTestFixtureDto & { resolvedAt?: Date | null }) {
    const [row] = await this.db
      .update(testFixtures)
      .set(data)
      .where(eq(testFixtures.id, id))
      .returning();
    return row ?? null;
  }

  async delete(id: string) {
    const [row] = await this.db.delete(testFixtures).where(eq(testFixtures.id, id)).returning();
    return row ?? null;
  }
}
