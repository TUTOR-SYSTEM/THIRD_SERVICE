import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { RmqContext } from '@nestjs/microservices';
import { Observable, catchError, tap, throwError } from 'rxjs';

interface AckableChannel {
  ack(message: Record<string, unknown>): void;
  nack(message: Record<string, unknown>, allUpTo: boolean, requeue: boolean): void;
}

/**
 * Manual RabbitMQ acknowledgement for `third_queue`.
 *
 * `main.ts` consumes with `noAck: false`. Nest's RMQ server never acks a successful handler on its
 * own (it only nacks unhandled patterns), so this interceptor owns the ack:
 * - handler completed (RPC reply emitted, or event handled) → `ack`, after the reply is published;
 * - handler threw → `nack(requeue=false)`: the message is dropped rather than redelivered in a
 *   tight loop (there is no DLX configured yet), and the error still goes to the RPC caller.
 *
 * Consequence: a process crash between delivery and ack redelivers the message (at-least-once), so
 * side-effecting handlers (email, upload, log.create) can run twice. Every ack/nack is attempted
 * exactly once; a failure to ack is logged, never thrown into the handler.
 */
@Injectable()
export class RmqAckInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RmqAckInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') {
      return next.handle();
    }
    const rmq = context.switchToRpc().getContext<RmqContext>();
    // amqplib channel (typed loosely by Nest); only ack/nack are used here.
    const channel = rmq.getChannelRef() as AckableChannel;
    const message = rmq.getMessage() as Record<string, unknown>;
    const pattern = rmq.getPattern();

    return next.handle().pipe(
      tap({
        complete: () => this.safe(() => channel.ack(message), 'ack', pattern),
      }),
      catchError((err: unknown) => {
        this.safe(() => channel.nack(message, false, false), 'nack', pattern);
        return throwError(() => err);
      }),
    );
  }

  private safe(action: () => void, label: 'ack' | 'nack', pattern: string): void {
    try {
      action();
    } catch (err) {
      this.logger.error(`RMQ ${label} failed for "${pattern}": ${(err as Error).message}`);
    }
  }
}
