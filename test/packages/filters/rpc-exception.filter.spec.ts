import { ArgumentsHost, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { RpcExceptionFilter, RpcErrorPayload } from '@packages/filters/rpc-exception.filter';

const host = {} as ArgumentsHost;

const toPayload = (exception: unknown): Promise<RpcErrorPayload> =>
  new Promise((resolve, reject) => {
    new RpcExceptionFilter().catch(exception, host).subscribe({
      next: () => reject(new Error('expected an error observable')),
      error: resolve,
    });
  });

describe('RpcExceptionFilter', () => {
  it('maps an HttpException to a serializable payload with its status and message', async () => {
    const payload = await toPayload(new BadRequestException('Name is required'));

    expect(payload).toEqual({
      statusCode: 400,
      message: 'Name is required',
      errors: undefined,
      serviceName: 'third-service',
    });
  });

  it('keeps an array of validation messages and field errors', async () => {
    const errors = [{ path: ['x'], message: 'bad' }];
    const payload = await toPayload(
      new BadRequestException({ message: ['x is bad'], errors }),
    );

    expect(payload.message).toEqual(['x is bad']);
    expect(payload.errors).toEqual(errors);
  });

  it('uses the exception message when the response body is a plain string', async () => {
    const payload = await toPayload(new HttpException('plain', HttpStatus.CONFLICT));

    expect(payload.statusCode).toBe(409);
    expect(payload.message).toBe('plain');
  });

  it('preserves the origin serviceName when relaying another service error', async () => {
    const payload = await toPayload(
      new HttpException({ message: 'not found', serviceName: 'user' }, 404),
    );

    expect(payload.serviceName).toBe('user');
  });

  it('wraps a non-HTTP Error as a 500 with a generic message', async () => {
    const payload = await toPayload(new Error('db exploded'));

    expect(payload).toEqual({
      statusCode: 500,
      message: 'Internal server error',
      serviceName: 'third-service',
    });
  });

  it('uses a generic message for non-Error throwables', async () => {
    const payload = await toPayload('weird');

    expect(payload).toEqual({
      statusCode: 500,
      message: 'Internal server error',
      serviceName: 'third-service',
    });
  });
});
