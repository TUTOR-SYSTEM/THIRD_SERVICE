import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { LoggerInterceptor } from 'src/packages/interceptor/logger.interceptor';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123_-xyz';

function ctx(url: string, body: unknown = {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url, body }),
      getResponse: () => ({ statusCode: 200 }),
    }),
  } as unknown as ExecutionContext;
}

async function run(url: string, data: unknown, body?: unknown) {
  const lines: string[] = [];
  jest.spyOn(Logger.prototype, 'log').mockImplementation((m: unknown) => void lines.push(String(m)));
  await lastValueFrom(new LoggerInterceptor().intercept(ctx(url, body), { handle: () => of(data) } as CallHandler));
  return lines.join('\n');
}

describe('LoggerInterceptor review fixes (F-19)', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each(['/redis?key=session:u1', '/upload/download?key=a/b', '/logs?search=x'])(
    'does not log response data for %s',
    async (url) => {
      const out = await run(url, { secret: 'LEAKME-DATA' });
      expect(out).not.toContain('LEAKME-DATA');
    },
  );

  it('strips the query string from logged URLs', async () => {
    const out = await run('/redis?key=session:u1&token=abc', { a: 1 });
    expect(out).not.toContain('session:u1');
    expect(out).not.toContain('token=abc');
    expect(out).not.toContain('?');
  });

  it('still logs response data for ordinary routes', async () => {
    const out = await run('/health', { a: 'visible' });
    expect(out).toContain('visible');
  });

  it('redacts JWT-shaped values in request and response logs', async () => {
    const out = await run('/health', { t: JWT }, { x: JWT });
    expect(out).not.toContain('eyJ');
    expect(out).toContain('[REDACTED]');
  });
});
