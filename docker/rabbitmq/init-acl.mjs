// RabbitMQ ACL bootstrap. The same file is kept identical in tutor, gateway, user and third
// (docker/rabbitmq/init-acl.mjs). Creates one broker user per service and grants it only what that
// service uses:
//   configure: queues it declares (Nest asserts the target queue on connect, and its own queue)
//   read:      queues it consumes, plus amq.rabbitmq.reply-to (Nest's Direct Reply-To, for RPC replies)
//   write:     amq.default only. Nest publishes through the default exchange, and RabbitMQ checks write
//              on that exchange, not on the queue name. So this ACL cannot limit which queue a service
//              publishes to; limiting that needs a custom exchange per target (see report TS-01).
// Idempotent: re-running resets each service user's password and permissions from the environment.
// Runs once after the broker is healthy (compose service "rabbitmq-acl"), through the management API.

const env = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set`);
  return value;
};

const MGMT = (process.env.RABBITMQ_MGMT_URL ?? 'http://rabbitmq:15672').replace(/\/$/, '');
const ADMIN =
  'Basic ' + Buffer.from(`${env('RABBITMQ_USER')}:${env('RABBITMQ_PASSWORD')}`).toString('base64');

const REPLY = 'amq\\.rabbitmq\\.reply-to';
const DEFAULT_EXCHANGE = '^amq\\.default$';
const exact = (...names) => `^(${names.join('|')})$`;

const SERVICES = [
  {
    user: 'gateway_svc',
    passwordEnv: 'RABBITMQ_GATEWAY_PASSWORD',
    configure: exact('user_queue', 'tutor_queue', 'third_queue'),
    write: DEFAULT_EXCHANGE,
    read: exact(REPLY),
  },
  {
    user: 'user_svc',
    passwordEnv: 'RABBITMQ_USER_SERVICE_PASSWORD',
    configure: exact('user_queue', 'third_queue'),
    write: DEFAULT_EXCHANGE,
    read: exact('user_queue', REPLY),
  },
  {
    user: 'tutor_svc',
    passwordEnv: 'RABBITMQ_TUTOR_PASSWORD',
    configure: exact('tutor_queue', 'user_queue', 'third_queue'),
    write: DEFAULT_EXCHANGE,
    read: exact('tutor_queue', REPLY),
  },
  {
    user: 'third_svc',
    passwordEnv: 'RABBITMQ_THIRD_PASSWORD',
    // third declares its dead-letter exchange and DLQ and binds them (rmq-dead-letter.helper.ts).
    // Binding needs write on the queue and read on the exchange.
    configure: exact('third_queue', 'third_queue\\.dlx', 'third_queue\\.dlq'),
    write: exact('amq\\.default', 'third_queue\\.dlq'),
    read: exact('third_queue', 'third_queue\\.dlx', REPLY),
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method, path, body) {
  const res = await fetch(MGMT + path, {
    method,
    headers: { authorization: ADMIN, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${await res.text()}`);
}

async function waitForBroker() {
  for (let attempt = 1; attempt <= 60; attempt++) {
    try {
      await call('GET', '/api/whoami');
      return;
    } catch (error) {
      if (attempt === 60) throw error;
      await sleep(2000);
    }
  }
}

await waitForBroker();
for (const svc of SERVICES) {
  const password = env(svc.passwordEnv);
  await call('PUT', `/api/users/${svc.user}`, { password, tags: '' });
  await call('PUT', `/api/permissions/%2F/${svc.user}`, {
    configure: svc.configure,
    write: svc.write,
    read: svc.read,
  });
  console.log(`rabbitmq-acl: ${svc.user} granted`);
}
