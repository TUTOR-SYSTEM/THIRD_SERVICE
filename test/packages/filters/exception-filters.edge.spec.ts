import { ArgumentsHost, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { Observable } from 'rxjs';
import { HttpExceptionFilter } from '@packages/filters/http-exception.filter';
import { RpcExceptionFilter } from '@packages/filters/rpc-exception.filter';

const makeHost = (request: Record<string, unknown> = { url: '/x' }) => {
  const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ArgumentsHost;
  return { host, response };
};

/** The RPC filter returns an observable that errors with the payload; capture that payload. */
const rpcPayload = (exception: unknown): Promise<Record<string, unknown>> =>
  new Promise((resolve) => {
    (new RpcExceptionFilter().catch(exception, {} as ArgumentsHost) as Observable<never>).subscribe({
      error: (payload: Record<string, unknown>) => resolve(payload),
    });
  });

describe('HttpExceptionFilter — no response body', () => {
  it('uses the exception message when getResponse() returns null', () => {
    const exception = { getStatus: () => 500, getResponse: () => null, message: 'kaboom', stack: 's' };
    const { host, response } = makeHost();
    new HttpExceptionFilter().catch(exception as unknown as HttpException, host);
    expect(response.json.mock.calls[0][0].message).toBe('kaboom');
  });
});

describe('RpcExceptionFilter — response shapes', () => {
  it('uses a string response body as the message and leaves errors undefined', async () => {
    const payload = await rpcPayload(new HttpException('plain text', HttpStatus.BAD_REQUEST));
    expect(payload).toMatchObject({ statusCode: 400, message: 'plain text', errors: undefined });
  });

  it('keeps the serviceName of a relayed downstream error', async () => {
    const payload = await rpcPayload(new BadRequestException({ message: 'bad', serviceName: 'user' }));
    expect(payload).toMatchObject({ serviceName: 'user' });
  });

  it('tags its own service name when the error carries none', async () => {
    const payload = await rpcPayload(new BadRequestException('bad'));
    expect(payload).toMatchObject({ serviceName: 'third-service' });
  });

  it('falls back to the Error message for a non-HTTP error', async () => {
    const payload = await rpcPayload(new Error('oops'));
    expect(payload).toMatchObject({ statusCode: 500, message: 'oops', serviceName: 'third-service' });
  });

  it('answers 500 with a generic message for a thrown non-Error value', async () => {
    const payload = await rpcPayload('weird');
    expect(payload).toMatchObject({ statusCode: 500, message: 'Internal server error' });
  });
});

describe('HttpExceptionFilter — fallback chains', () => {
  it('answers 500 when the exception has no getStatus method', () => {
    const exception = { getResponse: () => 'x', message: 'x' };
    const { host, response } = makeHost();
    new HttpExceptionFilter().catch(exception as unknown as HttpException, host);
    expect(response.status).toHaveBeenCalledWith(500);
  });

  it('uses the generic message when a null body also has an empty exception message', () => {
    const exception = { getStatus: () => 500, getResponse: () => null, message: '', stack: 's' };
    const { host, response } = makeHost();
    new HttpExceptionFilter().catch(exception as unknown as HttpException, host);
    expect(response.json.mock.calls[0][0].message).toBe('Internal server error');
  });

  it('uses the generic message when an object body and the exception both lack a message', () => {
    const exception = { getStatus: () => 400, getResponse: () => ({ code: 'X' }), message: '' };
    const { host, response } = makeHost();
    new HttpExceptionFilter().catch(exception as unknown as HttpException, host);
    expect(response.json.mock.calls[0][0].message).toBe('Internal server error');
  });
});

describe('RpcExceptionFilter — message fallback', () => {
  it('uses the exception message when an object body carries no message', async () => {
    const exception = new HttpException({ code: 'X' }, HttpStatus.BAD_REQUEST);
    const payload = await rpcPayload(exception);
    expect(payload).toMatchObject({ message: exception.message });
  });
});
