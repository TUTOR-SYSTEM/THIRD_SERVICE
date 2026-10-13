import { HttpException, InternalServerErrorException, Logger } from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import { RpcExceptionFilter } from '@packages/filters/rpc-exception.filter';
import { HttpExceptionFilter } from '@packages/filters/http-exception.filter';
import { ErrorInterceptor } from '@packages/interceptor/error.interceptor';

describe('RpcExceptionFilter (review-fix F-20)', () => {
  it('hides raw error messages (e.g. SQL) behind a generic message', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const err = new Error('Failed query: select * from users where email = $1 params: a@b.c');
    const out$ = new RpcExceptionFilter().catch(err, {} as any);
    await expect(lastValueFrom(out$)).rejects.toMatchObject({
      statusCode: 500,
      message: 'Internal server error',
    });
  });

  it('still relays HttpException messages', async () => {
    const out$ = new RpcExceptionFilter().catch(new HttpException('nope', 404), {} as any);
    await expect(lastValueFrom(out$)).rejects.toMatchObject({ statusCode: 404, message: 'nope' });
  });
});

describe('ErrorInterceptor (review-fix F-20)', () => {
  it('does not log SQL params of a Failed query', async () => {
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const err = new Error('Failed query: select * from users where email = $1\nparams: secret@x.com');
    await lastValueFrom(
      new ErrorInterceptor().intercept({} as any, { handle: () => throwError(() => err) }),
    ).catch(() => undefined);
    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain('secret@x.com');
  });

  it('still maps to InternalServerError', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(
      lastValueFrom(
        new ErrorInterceptor().intercept({} as any, {
          handle: () => throwError(() => new Error('Failed query: x\nparams: y')),
        }),
      ),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    void of;
  });
});

// F-31
describe('HttpExceptionFilter trace (review-fix F-31)', () => {
  const orig = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = orig;
  });
  const run = () => {
    let body: any;
    const response = { status: () => ({ json: (b: any) => (body = b) }) };
    const host = {
      switchToHttp: () => ({ getRequest: () => ({ url: '/x', language: 'en' }), getResponse: () => response }),
    };
    new HttpExceptionFilter().catch(new InternalServerErrorException('boom'), host as any);
    return body;
  };

  it.each(['staging', 'production', undefined])('omits trace when NODE_ENV=%s', (env) => {
    if (env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env;
    expect(run().trace).toBeUndefined();
  });

  it.each(['development', 'test'])('includes trace when NODE_ENV=%s', (env) => {
    process.env.NODE_ENV = env;
    expect(run().trace).toEqual(expect.any(String));
  });
});
