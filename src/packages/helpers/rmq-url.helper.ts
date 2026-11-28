/**
 * Builds the AMQP connection URL.
 *
 * `RABBITMQ_URL` wins when set. Otherwise the URL is assembled from discrete variables so a host
 * that only exposes the parts (Railway, compose) still connects:
 *   RABBITMQ_HOST (required), RABBITMQ_PORT (5672), RABBITMQ_USER | RABBITMQ_DEFAULT_USER,
 *   RABBITMQ_PASSWORD | RABBITMQ_DEFAULT_PASS, RABBITMQ_VHOST ("/"), RABBITMQ_TLS ("true" -> amqps).
 * Returns undefined when neither a URL nor a host is configured.
 */
export function resolveRabbitMqUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = env[key]?.trim();
      if (value) return value;
    }
    return undefined;
  };

  const url = pick('RABBITMQ_URL');
  if (url) return url;

  const host = pick('RABBITMQ_HOST', 'RABBITMQ_HOSTNAME');
  if (!host) return undefined;

  const protocol = pick('RABBITMQ_TLS')?.toLowerCase() === 'true' ? 'amqps' : 'amqp';
  const port = pick('RABBITMQ_PORT') ?? (protocol === 'amqps' ? '5671' : '5672');
  const user = pick('RABBITMQ_USER', 'RABBITMQ_USERNAME', 'RABBITMQ_DEFAULT_USER');
  const password = pick('RABBITMQ_PASSWORD', 'RABBITMQ_PASS', 'RABBITMQ_DEFAULT_PASS');
  const vhost = pick('RABBITMQ_VHOST');

  const auth = user
    ? `${encodeURIComponent(user)}${password ? ':' + encodeURIComponent(password) : ''}@`
    : '';
  const path = vhost && vhost !== '/' ? `/${encodeURIComponent(vhost.replace(/^\//, ''))}` : '';
  return `${protocol}://${auth}${host}:${port}${path}`;
}
