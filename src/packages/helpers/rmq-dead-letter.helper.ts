import { connect } from 'amqplib';

/**
 * Dead-letter topology for the third-service work queue (report F-14).
 *
 * A message the handler rejects is nacked with `requeue=false`. Without a dead-letter exchange
 * RabbitMQ discards it. With one, the broker routes it to the DLQ so it can be inspected and
 * replayed.
 *
 * This helper only declares the exchange, the DLQ and their binding. It does not change
 * `third_queue`'s arguments: gateway, user and tutor declare that queue with `{ durable: true }`
 * as clients, so adding arguments would make their connections fail with PRECONDITION_FAILED.
 * The broker-side link is a policy instead (set once, see `deadLetterPolicyCommand`).
 */
export interface DeadLetterNames {
  exchange: string;
  queue: string;
  routingKey: string;
}

export function deadLetterNames(queue: string): DeadLetterNames {
  return {
    exchange: `${queue}.dlx`,
    queue: `${queue}.dlq`,
    routingKey: `${queue}.dlq`,
  };
}

/** The one-time `rabbitmqctl` command that routes rejected messages of `queue` to the DLX. */
export function deadLetterPolicyCommand(queue: string): string {
  const names = deadLetterNames(queue);
  const definition = JSON.stringify({
    'dead-letter-exchange': names.exchange,
    'dead-letter-routing-key': names.routingKey,
  });
  return `rabbitmqctl set_policy third-dlx "^${queue}$" '${definition}' --apply-to queues`;
}

/** Declares the DLX, the DLQ and the binding. Idempotent: safe on every boot. */
export async function assertDeadLetterTopology(
  url: string,
  queue: string,
): Promise<DeadLetterNames> {
  const names = deadLetterNames(queue);
  const connection = await connect(url);
  try {
    const channel = await connection.createChannel();
    await channel.assertExchange(names.exchange, 'direct', { durable: true });
    await channel.assertQueue(names.queue, { durable: true });
    await channel.bindQueue(names.queue, names.exchange, names.routingKey);
    await channel.close();
  } finally {
    await connection.close();
  }
  return names;
}
