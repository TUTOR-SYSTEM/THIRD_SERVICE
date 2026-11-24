import { InternalServerErrorException } from '@nestjs/common';
import { lastValueFrom, throwError } from 'rxjs';
import { ErrorInterceptor } from '@packages/interceptor/error.interceptor';

describe('ErrorInterceptor does not leak internals', () => {
  it('replaces a raw error message with a generic 500', async () => {
    const interceptor = new ErrorInterceptor();
    const next = {
      handle: () => throwError(() => new Error('connect ECONNREFUSED 10.0.0.5:6379')),
    };
    const err = await lastValueFrom(interceptor.intercept({} as never, next as never)).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(InternalServerErrorException);
    expect((err as Error).message).toBe('Internal server error');
  });
});
