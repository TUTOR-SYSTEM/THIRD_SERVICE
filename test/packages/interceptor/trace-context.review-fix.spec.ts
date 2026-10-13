import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { lastValueFrom, Observable, of } from 'rxjs';
import { TraceContextInterceptor } from 'src/packages/interceptor/trace-context.interceptor';
import { emitRequestLog } from '@packages/context/log-sink';

jest.mock('@packages/context/log-sink', () => ({ emitRequestLog: jest.fn() }));

const emit = emitRequestLog as jest.Mock;

function ctx(pattern: string, data: unknown): ExecutionContext {
  return {
    getType: () => 'rpc',
    switchToRpc: () => ({
      getData: () => data,
      getContext: () => ({ getPattern: () => pattern, getMessage: () => ({ properties: { headers: {} } }) }),
    }),
  } as unknown as ExecutionContext;
}

async function run(pattern: string, data: unknown, response: unknown = { ok: true }) {
  const next: CallHandler = { handle: () => of(response) };
  await lastValueFrom(new TraceContextInterceptor().intercept(ctx(pattern, data), next));
  return emit.mock.calls[emit.mock.calls.length - 1][0] as { requestBody?: string; responseBody?: string };
}

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz';

describe('TraceContextInterceptor review fixes', () => {
  beforeEach(() => {
    emit.mockReset();
    Logger.overrideLogger(false);
  });

  it.each(['redis.get', 'redis.set', 'health.redis', 'email.send', 'upload.file'])(
    'F-10 omits request/response previews for %s',
    async (pattern) => {
      const entry = await run(pattern, { key: 'session:u1', value: 'SECRET' }, 'SECRET-RESP');
      for (const body of [entry.requestBody, entry.responseBody]) {
        expect(body === undefined || body === null || body === '[omitted]').toBe(true);
      }
    },
  );

  it('still previews ordinary patterns', async () => {
    const entry = await run('user.find', { id: 1 });
    expect(entry.requestBody).toContain('"id":1');
  });

  it.each(['resetToken', 'value', 'secret', 'code', 'authorization', 'cookie', 'refreshToken', 'Authorization', 'RESETTOKEN'])(
    'F-11 redacts key %s case-insensitively',
    async (k) => {
      const entry = await run('user.x', { [k]: 'LEAKME', keep: 'ok' });
      expect(entry.requestBody).not.toContain('LEAKME');
      expect(entry.requestBody).toContain('ok');
    },
  );

  it('F-11 redacts JWT-shaped string values under innocuous keys', async () => {
    const entry = await run('user.x', { note: JWT, list: [JWT] }, { data: JWT });
    expect(entry.requestBody).not.toContain('eyJ');
    expect(entry.requestBody).toContain('[REDACTED]');
    expect(entry.responseBody).not.toContain('eyJ');
  });

  it('F-27 replaces buffer fields with a binary-size marker', async () => {
    const entry = await run('user.x', { buffer: Buffer.alloc(5000, 1), name: 'a' });
    expect(entry.requestBody).toContain('[binary 5000 bytes]');
    const e2 = await run('user.x', { buffer: 'x'.repeat(3000) });
    expect(e2.requestBody).toContain('[binary 3000 bytes]');
    const e3 = await run('user.x', { buffer: new Array(2000).fill(1) });
    expect(e3.requestBody).toContain('[binary 2000 bytes]');
  });

  it('F-27 truncates large arrays/strings before stringify', async () => {
    const stringify = jest.spyOn(JSON, 'stringify');
    await run('user.x', { items: Array.from({ length: 100000 }, (_, i) => i), s: 'z'.repeat(5_000_000) });
    const biggest = Math.max(...stringify.mock.calls.map(([v]) => (typeof v === 'string' ? v.length : 0)), 0);
    const sizes = stringify.mock.results.map((r) => (typeof r.value === 'string' ? r.value.length : 0));
    stringify.mockRestore();
    expect(Math.max(...sizes, biggest)).toBeLessThan(50_000);
    // the string passed INTO stringify must be bounded too (no full 5MB serialisation)
  });

  it('F-36 teardown unsubscribes the inner subscription', () => {
    let unsubscribed = false;
    const inner = new Observable(() => () => {
      unsubscribed = true;
    });
    const next: CallHandler = { handle: () => inner };
    const sub = new TraceContextInterceptor().intercept(ctx('user.x', {}), next).subscribe();
    sub.unsubscribe();
    expect(unsubscribed).toBe(true);
  });
});
