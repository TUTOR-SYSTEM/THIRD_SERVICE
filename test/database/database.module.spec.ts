import { ConfigService } from '@nestjs/config';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { DATABASE_ENVS, DatabaseModule, DRIZZLE } from 'src/database/database.module';

const postgresMock = jest.fn();
const drizzleMock = jest.fn((client: unknown, config: unknown) => ({ client, config }));

jest.mock('postgres', () => ({
  __esModule: true,
  default: (...args: unknown[]) => postgresMock(...args),
}));
jest.mock('drizzle-orm/postgres-js', () => ({
  drizzle: (...args: unknown[]) => drizzleMock(...args),
}));

const factory = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, DatabaseModule).find(
  (p: { provide?: string }) => p.provide === DRIZZLE,
).useFactory as (config: ConfigService) => Promise<unknown>;

const configWith = (values: Record<string, string | undefined>) =>
  ({
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (!values[key]) throw new Error(`missing ${key}`);
      return values[key];
    },
  }) as unknown as ConfigService;

const fullPgEnv = {
  POSTGRES_HOST: 'db.local',
  POSTGRES_PORT: '5432',
  POSTGRES_DB: 'third',
  POSTGRES_USER: 'svc',
  POSTGRES_PASSWORD: 'p@ss/word',
};

/** A postgres.js client stand-in: a tagged template that resolves or rejects. */
const clientThat = (ok: boolean) =>
  jest.fn(() =>
    ok ? Promise.resolve([{ '?column?': 1 }]) : Promise.reject(new Error('ECONNREFUSED')),
  );

describe('DatabaseModule drizzle factory', () => {
  beforeEach(() => {
    postgresMock.mockReset();
    drizzleMock.mockClear();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('connects with DATABASE_URL when it is set', async () => {
    postgresMock.mockReturnValue(clientThat(true));
    await factory(configWith({ DATABASE_URL: 'postgres://u:p@host:5433/db' }));

    expect(postgresMock).toHaveBeenCalledWith('postgres://u:p@host:5433/db');
  });

  it('builds the connection string from POSTGRES_* and URL-encodes the password', async () => {
    postgresMock.mockReturnValue(clientThat(true));
    await factory(configWith(fullPgEnv));

    expect(postgresMock).toHaveBeenCalledWith('postgres://svc:p%40ss%2Fword@db.local:5432/third');
  });

  it('strips the esModuleInterop `default` key before handing the schema to drizzle', async () => {
    postgresMock.mockReturnValue(clientThat(true));
    await factory(configWith({ DATABASE_URL: 'postgres://u:p@h/db' }));

    const { schema } = drizzleMock.mock.calls[0][1] as { schema: Record<string, unknown> };
    expect(schema).not.toHaveProperty('default');
    expect(schema).toHaveProperty('users');
  });

  it('fails fast listing every missing POSTGRES_* variable when DATABASE_URL is absent', async () => {
    await expect(factory(configWith({ POSTGRES_HOST: 'h' }))).rejects.toThrow(
      /Missing required environment variables/,
    );
    expect(postgresMock).not.toHaveBeenCalled();
    for (const env of DATABASE_ENVS.filter((e) => e !== 'POSTGRES_HOST')) {
      await expect(factory(configWith({ POSTGRES_HOST: 'h' }))).rejects.toThrow(`- ${env}`);
    }
  });

  it('retries a failed connection and succeeds on a later attempt', async () => {
    jest.useFakeTimers();
    try {
      const client = jest
        .fn()
        .mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')))
        .mockImplementation(() => Promise.resolve([]));
      postgresMock.mockReturnValue(client);

      const pending = factory(configWith({ DATABASE_URL: 'postgres://u:p@h/db' }));
      await jest.advanceTimersByTimeAsync(2000);
      const db = await pending;

      expect(client).toHaveBeenCalledTimes(2);
      expect(db).toEqual({ client, config: { schema: expect.any(Object) } });
    } finally {
      jest.useRealTimers();
    }
  });

  it('throws "PostgreSQL connect failed" after three failed attempts', async () => {
    jest.useFakeTimers();
    try {
      postgresMock.mockReturnValue(clientThat(false));
      const pending = factory(configWith({ DATABASE_URL: 'postgres://u:p@h/db' }));
      const assertion = expect(pending).rejects.toThrow('PostgreSQL connect failed');
      await jest.advanceTimersByTimeAsync(4000);
      await assertion;
      expect(postgresMock.mock.results[0].value).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });
});
