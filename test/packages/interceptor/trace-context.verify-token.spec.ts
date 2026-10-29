import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
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

async function run(pattern: string, data: unknown) {
  const next: CallHandler = { handle: () => of({ ok: true }) };
  await lastValueFrom(new TraceContextInterceptor().intercept(ctx(pattern, data), next));
  return emit.mock.calls[emit.mock.calls.length - 1][0] as { requestBody?: string };
}

const TOKEN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('TraceContextInterceptor redacts verifyToken', () => {
  beforeEach(() => {
    emit.mockReset();
    Logger.overrideLogger(false);
  });

  it.each(['verifyToken', 'VERIFYTOKEN', 'verifytoken'])(
    'masks the %s key on a non-email pattern while keeping sibling fields',
    async (key) => {
      const entry = await run('user.verify', { [key]: TOKEN, keep: 'ok' });
      expect(entry.requestBody).not.toContain(TOKEN);
      expect(entry.requestBody).toContain('[REDACTED]');
      expect(entry.requestBody).toContain('"keep":"ok"');
    },
  );

  it('masks verifyToken nested inside an object payload', async () => {
    const entry = await run('user.verify', { user: { id: 1, verifyToken: TOKEN } });
    expect(entry.requestBody).not.toContain(TOKEN);
    expect(entry.requestBody).toContain('"id":1');
  });

  it('never previews the email.sendVerifyEmail payload at all', async () => {
    const entry = await run('email.sendVerifyEmail', { to: 'a@b.c', verifyToken: TOKEN });
    expect(entry.requestBody === undefined || entry.requestBody === '[omitted]').toBe(true);
    expect(JSON.stringify(entry)).not.toContain(TOKEN);
  });
});
