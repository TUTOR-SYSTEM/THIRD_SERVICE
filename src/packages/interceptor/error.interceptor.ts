import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { sanitizeLogMessage } from '../helpers/sanitize-log.helper';
import { catchError, Observable, throwError } from 'rxjs';

@Injectable()
export class ErrorInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ErrorInterceptor.name);

  private resolveClientMessage(error: unknown): string {
    if (typeof error === 'object' && error !== null) {
      const e = error as Record<string, unknown>;
      const pgCode = (e.code ?? (e.cause as Record<string, unknown> | undefined)?.code) as
        string | undefined;
      switch (pgCode) {
        case '23503':
          return 'Referenced record not found (foreign key violation)';
        case '23505':
          return 'Record already exists (duplicate value)';
        case '23502':
          return 'Required field is missing (not-null violation)';
        case '23514':
          return 'Value violates check constraint';
      }
    }
    const message = error instanceof Error ? error.message : 'Internal server error';
    return message.startsWith('Failed query:') ? 'Database error' : message;
  }

  /**
   * Client-caused Postgres constraint violations are 400/409, not 500: a bad FK reference or
   * missing required field is the caller's input problem. Returns undefined for anything else.
   */
  private mapConstraintToHttp(error: unknown): HttpException | undefined {
    const pgCode = this.pgCodeOf(error);
    const message = this.resolveClientMessage(error);
    switch (pgCode) {
      case '23503':
      case '23502':
      case '23514':
        return new BadRequestException(message);
      case '23505':
        return new ConflictException(message);
      default:
        return undefined;
    }
  }

  private pgCodeOf(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const e = error as Record<string, unknown>;
    return (e.code ?? (e.cause as Record<string, unknown> | undefined)?.code) as string | undefined;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        if (error instanceof HttpException) {
          return throwError(() => error);
        }

        const mapped = this.mapConstraintToHttp(error);
        if (mapped) {
          return throwError(() => mapped);
        }

        const isError = error instanceof Error;
        const originalMessage = isError
          ? sanitizeLogMessage(error.message)
          : 'Internal server error';
        const originalStack = isError ? error.stack : undefined;

        this.logger.error(originalMessage, originalStack);

        const clientMessage = this.resolveClientMessage(error);
        const exception = new InternalServerErrorException(clientMessage);
        if (originalStack) exception.stack = originalStack;

        return throwError(() => exception);
      }),
    );
  }
}
