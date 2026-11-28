import { connect } from 'amqplib';
import {
  assertDeadLetterTopology,
  deadLetterNames,
  deadLetterPolicyCommand,
} from '@packages/helpers/rmq-dead-letter.helper';

jest.mock('amqplib', () => ({ connect: jest.fn() }));

describe('rmq dead-letter helper (report F-14)', () => {
  const channel = {
    assertExchange: jest.fn().mockResolvedValue({}),
    assertQueue: jest.fn().mockResolvedValue({}),
    bindQueue: jest.fn().mockResolvedValue({}),
    close: jest.fn().mockResolvedValue(undefined),
  };
  const connection = {
    createChannel: jest.fn().mockResolvedValue(channel),
    close: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (connect as unknown as jest.Mock).mockResolvedValue(connection);
  });

  it('derives the DLX, DLQ and routing key from the work queue name', () => {
    expect(deadLetterNames('third_queue')).toEqual({
      exchange: 'third_queue.dlx',
      queue: 'third_queue.dlq',
      routingKey: 'third_queue.dlq',
    });
  });

  it('declares a durable direct exchange, a durable DLQ and binds them', async () => {
    const names = await assertDeadLetterTopology('amqp://x', 'third_queue');
    expect(connect).toHaveBeenCalledWith('amqp://x');
    expect(channel.assertExchange).toHaveBeenCalledWith('third_queue.dlx', 'direct', {
      durable: true,
    });
    expect(channel.assertQueue).toHaveBeenCalledWith('third_queue.dlq', { durable: true });
    expect(channel.bindQueue).toHaveBeenCalledWith(
      'third_queue.dlq',
      'third_queue.dlx',
      'third_queue.dlq',
    );
    expect(names.queue).toBe('third_queue.dlq');
    expect(connection.close).toHaveBeenCalled();
  });

  it('never declares or alters the work queue itself', async () => {
    await assertDeadLetterTopology('amqp://x', 'third_queue');
    const declared = channel.assertQueue.mock.calls.map((c) => c[0]);
    expect(declared).not.toContain('third_queue');
  });

  it('closes the connection even when a declaration fails', async () => {
    channel.assertExchange.mockRejectedValueOnce(new Error('denied'));
    await expect(assertDeadLetterTopology('amqp://x', 'third_queue')).rejects.toThrow('denied');
    expect(connection.close).toHaveBeenCalled();
  });

  it('builds the broker policy command for the work queue', () => {
    expect(deadLetterPolicyCommand('third_queue')).toBe(
      'rabbitmqctl set_policy third-dlx "^third_queue$" \'{"dead-letter-exchange":"third_queue.dlx","dead-letter-routing-key":"third_queue.dlq"}\' --apply-to queues',
    );
  });
});
