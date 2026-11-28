import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { TraceContextInterceptor } from 'src/packages/interceptor/trace-context.interceptor';

function ctx(pattern: string, data: unknown): ExecutionContext {
  return {
    getType: () => 'rpc',
    switchToRpc: () => ({
      getData: () => data,
      getContext: () => ({
        getPattern: () => pattern,
        getMessage: () => ({ properties: { headers: {} } }),
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('TraceContextInterceptor review fixes', () => {
  beforeEach(() => {
    Logger.overrideLogger(false);
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
