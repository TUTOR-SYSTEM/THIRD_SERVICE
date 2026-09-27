import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { throwError } from 'rxjs';

const SERVICE_NAME = 'third-service';

export interface RpcErrorPayload {
  statusCode: number;
  message: string | string[];
  errors?: unknown;
  /** Which service actually threw — preserved as-is when relaying another service's error. */
  serviceName: string;
}

/**
 * Registered as a *microservice-scoped* global filter in `main.ts`
 * (`rmqMicroservice.useGlobalFilters(...)`) — every
 * `@MessagePattern` handler gets it automatically, no per-controller
 * `@UseFilters(RpcExceptionFilter)` needed. It is never passed to `app.useGlobalFilters()` on the
 * main HTTP `app`, so the HTTP side keeps using `HttpExceptionFilter` untouched (this filter reads
 * an RPC context, not an Express `Response`). The gateway's `ClientProxy` has no
 * notion of `HttpException`; this normalizes whatever a message-pattern handler throws into a
 * plain, JSON-serializable error object the gateway's `RmqProducer.send` helper can
 * turn back into the right `HttpException`.
 */
@Catch()
export class RpcExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, _host: ArgumentsHost) {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] })?.message ?? exception.message);
      const errors =
        typeof response === 'object' ? (response as { errors?: unknown }).errors : undefined;
      // If this exception is `RmqProducer.send()` rethrowing another service's error, its
      // response body already carries the origin's `serviceName` — preserve it instead of
      // overwriting with our own.
      const serviceName =
        typeof response === 'object'
          ? ((response as { serviceName?: string }).serviceName ?? SERVICE_NAME)
          : SERVICE_NAME;

      return throwError(
        () => ({ statusCode: status, message, errors, serviceName }) satisfies RpcErrorPayload,
      );
    }

    const message = exception instanceof Error ? exception.message : 'Internal server error';
    return throwError(
      () =>
        ({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message,
          serviceName: SERVICE_NAME,
        }) satisfies RpcErrorPayload,
    );
  }
}
