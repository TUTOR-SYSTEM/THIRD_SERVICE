import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { ResponseInterceptor } from '@packages/interceptor/response.interceptor';
import { SUCCESS_TRANSLATIONS, translateMessage } from '../../../src/data/i18n';

const setup = (opts: {
  metadata?: { message?: string };
  statusCode?: number;
  lang?: string;
}) => {
  const request = { method: 'GET', url: '/things', language: opts.lang };
  const response = { statusCode: opts.statusCode };
  const ctx = {
    getHandler: () => 'handler',
    getClass: () => 'class',
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(opts.metadata) };
  const interceptor = new ResponseInterceptor(reflector as unknown as Reflector);
  const next: CallHandler = { handle: () => of({ id: 1 }) };
  return { interceptor, ctx, next, reflector };
};

describe('ResponseInterceptor', () => {
  it('wraps the handler result in the standard success envelope', async () => {
    const { interceptor, ctx, next } = setup({
      metadata: { message: 'Created' },
      statusCode: 201,
      lang: 'en',
    });

    const body = await lastValueFrom(interceptor.intercept(ctx, next));

    expect(body).toEqual({
      statusCode: 201,
      message: translateMessage(SUCCESS_TRANSLATIONS, 'Created', 'en'),
      data: { id: 1 },
      timestamp: expect.any(Date),
      method: 'GET',
      path: '/things',
    });
  });

  it('defaults the status code to 200 when the response has none', async () => {
    const { interceptor, ctx, next } = setup({ statusCode: undefined, lang: 'en' });

    const body = await lastValueFrom(interceptor.intercept(ctx, next));

    expect(body.statusCode).toBe(200);
  });

  it('falls back to the SUCCESS message when no @ApiResponse metadata is set', async () => {
    const { interceptor, ctx, next } = setup({ metadata: undefined, lang: 'en' });

    const body = await lastValueFrom(interceptor.intercept(ctx, next));

    expect(body.message).toBe(translateMessage(SUCCESS_TRANSLATIONS, 'SUCCESS', 'en'));
  });

  it('reads the metadata from the handler first, then the class', () => {
    const { interceptor, ctx, next, reflector } = setup({ metadata: undefined });

    interceptor.intercept(ctx, next);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(expect.any(String), [
      'handler',
      'class',
    ]);
  });

  it('uses the default language when the request has none', async () => {
    const { interceptor, ctx, next } = setup({ metadata: { message: 'Created' } });

    const body = await lastValueFrom(interceptor.intercept(ctx, next));

    expect(body.message).toBe(translateMessage(SUCCESS_TRANSLATIONS, 'Created', 'vi'));
  });
});
