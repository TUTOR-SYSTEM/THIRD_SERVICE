import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { DEFAULT_LANGUAGE, type RequestWithLanguage } from '@packages/guards/language.guard';
import { ERROR_TRANSLATIONS, translateMessage } from '../../data/i18n';
import { getRequestContext } from '@packages/context/request-context';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();

    const request = ctx.getRequest<RequestWithLanguage>();
    const response = ctx.getResponse<Response>();
    const lang = request.language ?? DEFAULT_LANGUAGE;

    // handle status code
    const status = exception.getStatus?.() || HttpStatus.INTERNAL_SERVER_ERROR;

    // handle response from exception
    const exceptionResponse = exception.getResponse?.() ?? null;

    // Which downstream service actually threw, if the RPC error payload carried one through
    const serviceName = (exceptionResponse as { serviceName?: string } | null)?.serviceName;

    let message = 'Internal server error';

    if (exceptionResponse === null) {
      message = exception.message || message;
    } else if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (typeof exceptionResponse === 'object') {
      const res = exceptionResponse as unknown;

      // handle validation error (array of strings)
      if (Array.isArray((res as { message: string[] }).message)) {
        message = (res as { message: string[] }).message
          .map((part) => translateMessage(ERROR_TRANSLATIONS, part, lang))
          .join(', ');
      } else {
        message = (res as { message: string }).message || exception.message || message;
      }
    }

    // localize the resolved message (codes → request language; plain text passes through)
    message = translateMessage(ERROR_TRANSLATIONS, message, lang);

    // localize each field-level validation error message (Zod codes → request language)
    const rawErrors = (exceptionResponse as { errors?: unknown[] } | null)?.errors;
    const errors = Array.isArray(rawErrors)
      ? rawErrors.map((item) => {
          if (item && typeof item === 'object' && 'message' in item) {
            const { message } = item;
            if (typeof message === 'string') {
              return { ...item, message: translateMessage(ERROR_TRANSLATIONS, message, lang) };
            }
          }
          return item;
        })
      : rawErrors;

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      errors,
      path: request.url,
      ...(status >= 500 &&
        (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') && {
          trace: exception.stack,
        }),
      timestamp: new Date().toISOString(),
      correlationId: getRequestContext()?.correlationId,
      ...(serviceName && { serviceName }),
    });
  }
}
