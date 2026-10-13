import { throwError, of, lastValueFrom } from 'rxjs';
import { RmqAckInterceptor } from '../../../src/packages/interceptor/rmq-ack.interceptor';

/** Regression for TRD3-06: the queue is consumed with noAck:false, so acks must be explicit. */
describe('RmqAckInterceptor (TRD3-06)', () => {
  const message = { content: Buffer.from('{}'), properties: {} };
  let channel: { ack: jest.Mock; nack: jest.Mock };

  const ctx = (type = 'rpc') =>
    ({
      getType: () => type,
      switchToRpc: () => ({
        getContext: () => ({
          getChannelRef: () => channel,
          getMessage: () => message,
          getPattern: () => 'redis.get',
        }),
      }),
    }) as never;

  beforeEach(() => {
    channel = { ack: jest.fn(), nack: jest.fn() };
  });

  it('acks the message only after the handler completes', async () => {
    const interceptor = new RmqAckInterceptor();
    const result = await lastValueFrom(
      interceptor.intercept(ctx(), { handle: () => of({ ok: true }) }),
    );

    expect(result).toEqual({ ok: true });
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('nacks without requeue and rethrows when the handler fails', async () => {
    const interceptor = new RmqAckInterceptor();
    const boom = new Error('boom');

    await expect(
      lastValueFrom(interceptor.intercept(ctx(), { handle: () => throwError(() => boom) })),
    ).rejects.toBe(boom);

    expect(channel.nack).toHaveBeenCalledWith(message, false, false);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('does not throw into the handler when ack itself fails', async () => {
    channel.ack.mockImplementation(() => {
      throw new Error('channel closed');
    });
    const interceptor = new RmqAckInterceptor();

    await expect(
      lastValueFrom(interceptor.intercept(ctx(), { handle: () => of('done') })),
    ).resolves.toBe('done');
  });

  it('leaves non-RPC contexts untouched', async () => {
    const interceptor = new RmqAckInterceptor();
    await lastValueFrom(interceptor.intercept(ctx('http'), { handle: () => of(1) }));
    expect(channel.ack).not.toHaveBeenCalled();
  });
});
