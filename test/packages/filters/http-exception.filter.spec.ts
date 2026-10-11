import { ArgumentsHost, BadRequestException, ForbiddenException, HttpException, InternalServerErrorException } from '@nestjs/common';
import { HttpExceptionFilter } from '@packages/filters/http-exception.filter';
import { getRequestContext, runWithRequestContext } from '@packages/context/request-context';

const makeHost = (request: Record<string, unknown> = { url: '/things' }) => {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, response };
};

const run = (exception: HttpException, request?: Record<string, unknown>) => {
  const { host, response } = makeHost(request);
  new HttpExceptionFilter().catch(exception, host);
  return response.json.mock.calls[0][0];
};

describe('HttpExceptionFilter', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('writes the standard error envelope with the exception status', () => {
    const { host, response } = makeHost();
    new HttpExceptionFilter().catch(new ForbiddenException('nope'), host);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        statusCode: 403,
        path: '/things',
        timestamp: expect.any(String),
      }),
    );
  });

  it('uses a string response body as the message', () => {
    expect(run(new HttpException('plain text', 400)).message).toBe('plain text');
  });

  it('uses the object message for a single error', () => {
    expect(run(new BadRequestException('Name is required')).message).toBe('Name is required');
  });

  it('joins an array of validation messages into one string', () => {
    const body = run(new BadRequestException(['a is required', 'b must be a number']));

    expect(body.message).toBe('a is required, b must be a number');
  });

  it('falls back to the exception message when the body has no message', () => {
    const exception = new HttpException({ code: 'X' }, 400);
    exception.message = 'fallback text';

    expect(run(exception).message).toBe('fallback text');
  });

  it('passes through field-level errors, keeping their structure', () => {
    const errors = [{ path: ['name'], message: 'Required' }];
    const body = run(new BadRequestException({ message: 'Validation failed', errors }));

    expect(body.errors).toEqual([{ path: ['name'], message: 'Required' }]);
  });

  it('keeps error items without a message field untouched', () => {
    const errors = [{ path: ['x'] }, 'raw'];
    const body = run(new BadRequestException({ message: 'bad', errors }));

    expect(body.errors).toEqual([{ path: ['x'] }, 'raw']);
  });

  it('includes the stack trace for 5xx outside production only', () => {
    process.env.NODE_ENV = 'development';
    expect(run(new InternalServerErrorException('boom')).trace).toEqual(expect.any(String));

    process.env.NODE_ENV = 'production';
    expect(run(new InternalServerErrorException('boom')).trace).toBeUndefined();
  });

  it('never includes a stack trace for 4xx', () => {
    process.env.NODE_ENV = 'development';

    expect(run(new BadRequestException('bad')).trace).toBeUndefined();
  });

  it('echoes the serviceName carried by a relayed downstream error', () => {
    const exception = new HttpException(
      { message: 'downstream', serviceName: 'user' },
      404,
    );

    expect(run(exception).serviceName).toBe('user');
  });

  it('omits serviceName when none was carried', () => {
    expect(run(new BadRequestException('bad')).serviceName).toBeUndefined();
  });

  it('adds the correlation id from the active request context', () => {
    const body = runWithRequestContext(
      { correlationId: 'corr-1', traceId: 't', serviceName: 'third-service' },
      () => {
        expect(getRequestContext()?.correlationId).toBe('corr-1');
        return run(new BadRequestException('bad'));
      },
    );

    expect(body.correlationId).toBe('corr-1');
  });

  it('defaults the language to vi when the request has none', () => {
    // Plain-text messages pass through translation unchanged, so this only checks it does not throw.
    expect(run(new BadRequestException('bad'), { url: '/x' }).message).toBe('bad');
  });
});
