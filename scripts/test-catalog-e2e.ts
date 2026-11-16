/**
 * Probes every HTTP route and RPC pattern listed in the gateway's API route catalog
 * (GET /api-routes/catalog) against the RUNNING services, then reports.
 *
 * Run:  TEST_TOKEN_A=<admin access token> bun scripts/test-catalog-e2e.ts
 *
 * Phases
 *   1. HTTP unauth  every route, no token: JWT routes must answer 401; Public routes must not.
 *   2. HTTP authed  every route with an ADMIN token and a harmless probe (GET as is, POST/PUT/PATCH
 *                   with `{}`, DELETE only when it has a path param, random UUIDs). Fails on 5xx, on
 *                   "Cannot <METHOD> /path" (catalog drift: route not live) and on an unexpected 401.
 *   3. RPC          every MessagePattern straight onto its RabbitMQ queue with `{}`: any reply passes
 *                   unless its statusCode is >= 500; no reply within RPC_TIMEOUT_MS = no responder.
 *   4. FLOW         each authed HTTP probe carries an x-correlation-id; afterwards request_logs is read
 *                   and every route must have logged at least one row. Hops (service/type) are listed.
 *
 * Safety: side-effect routes/patterns (logout, password, email, run/generate, redis writes, ...) are
 * SKIPPED, DELETE without a path param is SKIPPED, nothing here creates real data (bodies are `{}`).
 *
 * Env
 *   TEST_TOKEN_A        ADMIN access token (required)
 *   GATEWAY_URL         default http://localhost:8888 (catalog source and `gateway` routes)
 *   USER_URL / THIRD_URL / TUTOR_URL   default http://localhost:4001 / 4002 / 4003
 *   RABBITMQ_URL        from .env
 *   RPC_TIMEOUT_MS      default 8000
 *   CONCURRENCY         default 4 (gateway rate-limits; 429s are retried once)
 *   ONLY                optional regexp on the catalog key, e.g. ONLY='^third\|'
 *   SAVE_RESULTS=1      store HTTP/RPC rows in test_scenarios + test_runs (service = catalog service)
 *   REPORT_PATH         also write the markdown report to this file
 *   REPORT_JSON         also write every case (all rows) as JSON to this file
 * Exit code 1 when any case fails.
 */
import * as amqp from 'amqplib';
import postgres from 'postgres';

const GATEWAY = (process.env.GATEWAY_URL ?? 'http://localhost:8888').replace(/\/+$/, '');
const BASES: Record<string, string> = {
  gateway: GATEWAY,
  user: process.env.USER_URL ?? 'http://localhost:4001',
  third: process.env.THIRD_URL ?? 'http://localhost:4002',
  tutor: process.env.TUTOR_URL ?? 'http://localhost:4003',
};
const TOKEN = process.env.TEST_TOKEN_A ?? '';
const RPC_TIMEOUT = Number(process.env.RPC_TIMEOUT_MS ?? 8000);
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const QUEUES: Record<string, string> = {
  user: process.env.USER_QUEUE ?? 'user_queue',
  tutor: process.env.TUTOR_QUEUE ?? 'tutor_queue',
  third: process.env.THIRD_QUEUE ?? 'third_queue',
};

type Item = {
  key: string;
  svc: string;
  type: string;
  method: string;
  path: string;
  auth?: string;
  q?: string;
  handler?: string;
};
type Row = {
  phase: 'HTTP-unauth' | 'HTTP-authed' | 'RPC' | 'FLOW';
  svc: string;
  type: string;
  method: string;
  path: string;
  key: string;
  expected: string;
  actual: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  ms: number;
  note?: string;
  correlationId?: string;
};
const rows: Row[] = [];

/** Routes/patterns whose probe could change state or fire an external side effect. */
const SIDE_EFFECT =
  /logout|revoke|password|forgot|reset|refresh|oauth|google|facebook|email\.|send|testscenario\.(run|generate)|\/run\b|generate|bulk|redis\.(set|del|getdel|incr)|ai\.chat|upload\.|import|seed/i;

const UUID = () => crypto.randomUUID();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fillPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)\??/g, (_m, name: string) =>
    /id$/i.test(name) ? UUID() : 'x',
  );
}

async function pool<T>(list: T[], fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (i < list.length) await fn(list[i++]);
    }),
  );
}

type Http = { status: number; text: string; ms: number };
async function http(method: string, url: string, token?: string, corr?: string): Promise<Http> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (corr) headers['x-correlation-id'] = corr;
  const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
  if (hasBody) headers['content-type'] = 'application/json';
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: hasBody ? '{}' : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      if (res.status === 429 && attempt === 0) {
        await sleep(1500);
        continue;
      }
      return { status: res.status, text, ms: Date.now() - t0 };
    } catch (e) {
      return { status: 0, text: String((e as Error).message), ms: Date.now() - t0 };
    }
  }
  return { status: 429, text: 'throttled', ms: 0 };
}

const routeMissing = (r: Http) =>
  r.status === 404 && /Cannot (GET|POST|PUT|PATCH|DELETE) /.test(r.text);

function add(r: Row) {
  rows.push(r);
}

async function fetchCatalog(): Promise<Item[]> {
  const r = await fetch(`${GATEWAY}/api-routes/catalog`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  if (r.status !== 200) throw new Error(`catalog ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const body = (await r.json()) as { data: { items: any[]; scanId: string; scannedAt: string } };
  console.log(
    `Catalog scan ${body.data.scanId} (${body.data.scannedAt}): ${body.data.items.length} items`,
  );
  return body.data.items
    .filter((i) => ['HTTP', 'RPC'].includes(i.type))
    .map((i) => ({
      key: i.key,
      svc: i.svc,
      type: i.type,
      method: i.method,
      path: i.path,
      auth: i.auth,
      q: i.q,
      handler: i.handler,
    }))
    .filter((i) => !ONLY || ONLY.test(i.key));
}

// ---------- HTTP ----------
async function probeHttp(it: Item) {
  const base = BASES[it.svc];
  const label = { svc: it.svc, type: 'HTTP', method: it.method, path: it.path, key: it.key };
  if (!base)
    return add({
      ...label,
      phase: 'HTTP-authed',
      expected: '-',
      actual: '-',
      status: 'SKIP',
      ms: 0,
      note: 'no base URL',
    });
  if (SIDE_EFFECT.test(it.path) || /OAuth/i.test(it.auth ?? '') || /\/kafka\/.*error$/.test(it.path)) {
    add({
      ...label,
      phase: 'HTTP-authed',
      expected: '-',
      actual: '-',
      status: 'SKIP',
      ms: 0,
      note: 'side-effect denylist',
    });
    return;
  }
  if (it.method === 'DELETE' && !/:/.test(it.path)) {
    add({
      ...label,
      phase: 'HTTP-authed',
      expected: '-',
      actual: '-',
      status: 'SKIP',
      ms: 0,
      note: 'DELETE without path param',
    });
    return;
  }
  const url = `${base}${fillPath(it.path)}`;
  const jwt = /JWT/.test(it.auth ?? '');

  // 1. unauthenticated
  const u = await http(it.method, url);
  if (jwt) {
    add({
      ...label,
      phase: 'HTTP-unauth',
      expected: '401',
      actual: String(u.status),
      ms: u.ms,
      status: u.status === 401 ? 'PASS' : 'FAIL',
      note: u.status === 401 ? undefined : u.text.slice(0, 120),
    });
  } else {
    const bad = u.status === 401 || u.status >= 500 || u.status === 0 || routeMissing(u);
    add({
      ...label,
      phase: 'HTTP-unauth',
      expected: 'not 401/5xx',
      actual: String(u.status),
      ms: u.ms,
      status: bad ? 'FAIL' : 'PASS',
      note: bad ? u.text.slice(0, 120) : undefined,
    });
  }

  // 2. authenticated (ADMIN)
  const corr = `catalog-e2e-${UUID()}`;
  const a = await http(it.method, url, TOKEN, corr);
  const roles = /roles ([A-Z, ]+)/.exec(it.auth ?? '')?.[1] ?? '';
  const adminAllowed = !roles || /ADMIN/.test(roles);
  let status: Row['status'] = 'PASS';
  let note: string | undefined;
  if (a.status === 0) ((status = 'FAIL'), (note = `no response: ${a.text}`));
  else if (routeMissing(a)) ((status = 'FAIL'), (note = 'DRIFT: route in catalog but not live'));
  else if (a.status >= 500) ((status = 'FAIL'), (note = a.text.slice(0, 160)));
  else if (a.status === 401) ((status = 'FAIL'), (note = 'token rejected'));
  else if (a.status === 403 && adminAllowed && !/:/.test(it.path))
    ((status = 'FAIL'), (note = 'ADMIN got 403 on a route that allows ADMIN'));
  else if (a.status === 403 && adminAllowed) note = 'ownership/membership check on a random id (expected 403)';
  else if (a.status === 403 && !adminAllowed) note = `roles ${roles.trim()} only (expected 403)`;
  add({
    ...label,
    phase: 'HTTP-authed',
    expected: '2xx/4xx, not 5xx',
    actual: String(a.status),
    ms: a.ms,
    status,
    note,
    correlationId: corr,
  });
}

// ---------- RPC ----------
type Rpc = {
  send(
    queue: string,
    pattern: string,
    data: unknown,
  ): Promise<{ ms: number; reply?: any; timeout?: boolean }>;
  close(): Promise<void>;
};
async function rpcClient(): Promise<Rpc> {
  const url = process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
  const conn: any = await amqp.connect(url);
  const ch: any = await conn.createChannel();
  const replyQ = (await ch.assertQueue('', { exclusive: true, autoDelete: true })).queue as string;
  const waiting = new Map<string, (m: any) => void>();
  await ch.consume(
    replyQ,
    (msg: any) => {
      if (!msg) return;
      const cb = waiting.get(msg.properties.correlationId);
      if (cb) cb(JSON.parse(msg.content.toString()));
    },
    { noAck: true },
  );
  return {
    async send(queue, pattern, data) {
      const id = UUID();
      const t0 = Date.now();
      const p = new Promise<any>((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          resolve({ timeout: true });
        }, RPC_TIMEOUT);
        waiting.set(id, (m) => {
          clearTimeout(timer);
          waiting.delete(id);
          resolve({ reply: m });
        });
      });
      ch.sendToQueue(queue, Buffer.from(JSON.stringify({ pattern, data, id })), {
        correlationId: id,
        replyTo: replyQ,
        headers: { 'x-correlation-id': `catalog-e2e-${id}` },
      });
      const r = await p;
      return { ms: Date.now() - t0, ...r };
    },
    async close() {
      await ch.close();
      await conn.close();
    },
  };
}

async function probeRpc(rpc: Rpc, it: Item) {
  const queue = QUEUES[it.svc];
  const label = {
    svc: it.svc,
    type: 'RPC',
    method: 'MSG',
    path: it.path,
    key: it.key,
    phase: 'RPC' as const,
  };
  if (!queue || SIDE_EFFECT.test(it.path)) {
    return add({
      ...label,
      expected: '-',
      actual: '-',
      status: 'SKIP',
      ms: 0,
      note: queue ? 'side-effect denylist' : 'no queue',
    });
  }
  const r = await rpc.send(queue, it.path, {});
  if (r.timeout) {
    return add({
      ...label,
      expected: 'reply',
      actual: 'timeout',
      status: 'FAIL',
      ms: r.ms,
      note: `no reply in ${RPC_TIMEOUT}ms (no responder, or handler hangs)`,
    });
  }
  const err = r.reply?.err;
  const code = Number(err?.statusCode ?? err?.status ?? 0);
  const errText = String(err?.message ?? (err ? JSON.stringify(err) : ''));
  if (err && /no matching message handler/i.test(errText)) {
    return add({
      ...label,
      expected: 'handler',
      actual: 'no handler',
      status: 'FAIL',
      ms: r.ms,
      note: 'DRIFT-RPC: pattern in catalog but the service has no @MessagePattern for it',
    });
  }
  if (err && code >= 500) {
    return add({
      ...label,
      expected: 'reply < 500',
      actual: String(code),
      status: 'FAIL',
      ms: r.ms,
      note: String(err.message ?? JSON.stringify(err)).slice(0, 160),
    });
  }
  add({
    ...label,
    expected: 'reply < 500',
    actual: err ? String(code || 'err') : 'ok',
    status: 'PASS',
    ms: r.ms,
  });
}

// ---------- FLOW (request_logs) ----------
function pgClient() {
  return postgres({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB,
    username: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    max: 1,
  });
}

async function flowFromLogs() {
  const authed = rows.filter(
    (r) =>
      r.phase === 'HTTP-authed' &&
      r.correlationId &&
      r.status !== 'SKIP' &&
      !r.note?.startsWith('DRIFT'),
  );
  if (authed.length === 0) return;
  await sleep(4000); // request logs are written asynchronously
  const sql = pgClient();
  try {
    const ids = authed.map((r) => r.correlationId as string);
    const logs = await sql<{ correlation_id: string; service_name: string; type: string }[]>`
      select distinct correlation_id, service_name, type::text as type
      from request_logs where correlation_id in ${sql(ids)}`;
    const hops = new Map<string, string[]>();
    for (const l of logs)
      hops.set(l.correlation_id, [
        ...(hops.get(l.correlation_id) ?? []),
        `${l.service_name}/${l.type}`,
      ]);
    for (const r of authed) {
      const h = hops.get(r.correlationId as string) ?? [];
      add({
        phase: 'FLOW',
        svc: r.svc,
        type: r.type,
        method: r.method,
        path: r.path,
        key: r.key,
        expected: '>= 1 request_logs row',
        actual: `${h.length} row(s)`,
        ms: 0,
        status: h.length > 0 ? 'PASS' : 'FAIL',
        note: h.length
          ? `hops: ${h.sort().join(', ')}`
          : 'no request_logs row for this correlation id',
      });
    }
  } finally {
    await sql.end();
  }
}

async function persist() {
  const sql = pgClient();
  const correlationId = `catalog-e2e-${UUID()}`;
  let saved = 0;
  try {
    for (const r of rows) {
      if (r.status === 'SKIP' || r.phase === 'FLOW') continue;
      const expected = r.phase === 'HTTP-unauth' && r.expected === '401' ? 401 : 200;
      const actual = Number(r.actual);
      const name = `${r.phase} ${r.key}`.slice(0, 200);
      let sc = await sql<
        { id: string }[]
      >`select id from test_scenarios where service = ${r.svc} and method = ${r.method} and path = ${r.path} and name = ${name} limit 1`;
      if (sc.length === 0) {
        const cat = expected === 401 ? 'auth' : 'valid';
        sc = await sql<
          { id: string }[]
        >`insert into test_scenarios (service, method, path, name, description, expected_status, category, auth_profile)
          values (${r.svc}, ${r.method}, ${r.path}, ${name}, ${r.expected}, ${expected}, ${cat}::test_scenario_category, ${r.phase === 'HTTP-unauth' ? 'none' : 'caller'}::test_auth_profile) returning id`;
      }
      await sql`insert into test_runs (scenario_id, correlation_id, actual_status, expected_status, passed, duration_ms, error_message, request_path)
        values (${sc[0].id}, ${correlationId}, ${Number.isFinite(actual) ? actual : null}, ${expected}, ${r.status === 'PASS'}, ${Math.round(r.ms)}, ${r.status === 'PASS' ? null : (r.note ?? r.actual)}, ${r.path})`;
      saved++;
    }
    console.log(`\nSaved ${saved} runs to test_runs (correlation_id=${correlationId})`);
  } finally {
    await sql.end();
  }
}

// ---------- report ----------
function report(): number {
  const count = (f: (r: Row) => boolean) => rows.filter(f).length;
  const L: string[] = [];
  const fail = count((r) => r.status === 'FAIL');
  L.push('# Catalog E2E report', '');
  L.push(
    `Total: ${rows.length} | PASS: ${count((r) => r.status === 'PASS')} | FAIL: ${fail} | SKIP: ${count((r) => r.status === 'SKIP')}`,
    '',
  );
  L.push(
    '## Summary by phase and service',
    '',
    '| Phase | Service | PASS | FAIL | SKIP |',
    '|---|---|---|---|---|',
  );
  const groups = new Map<string, Row[]>();
  for (const r of rows)
    groups.set(`${r.phase}|${r.svc}`, [...(groups.get(`${r.phase}|${r.svc}`) ?? []), r]);
  for (const [k, g] of [...groups].sort()) {
    const [phase, svc] = k.split('|');
    L.push(
      `| ${phase} | ${svc} | ${g.filter((r) => r.status === 'PASS').length} | ${g.filter((r) => r.status === 'FAIL').length} | ${g.filter((r) => r.status === 'SKIP').length} |`,
    );
  }
  const drift = rows.filter((r) => r.note?.startsWith('DRIFT') && r.phase === 'HTTP-authed');
  const noHandler = rows.filter((r) => r.note?.startsWith('DRIFT-RPC'));
  const timeouts = rows.filter((r) => r.phase === 'RPC' && r.actual === 'timeout');
  L.push(
    '',
    `Catalog drift (route listed but not live): ${drift.length} | RPC patterns without handler: ${noHandler.length} | RPC patterns without reply: ${timeouts.length}`,
    '',
  );
  if (drift.length) {
    L.push('## Catalog drift: routes in the catalog that are not live', '');
    for (const r of drift) L.push(`- ${r.svc} ${r.method} ${r.path}`);
    L.push('');
  }
  L.push(
    '## Failures',
    '',
    '| Phase | Service | Method | Path | Expected | Actual | Note |',
    '|---|---|---|---|---|---|---|',
  );
  for (const r of rows.filter((x) => x.status === 'FAIL')) {
    L.push(
      `| ${r.phase} | ${r.svc} | ${r.method} | ${r.path} | ${r.expected} | ${r.actual} | ${(r.note ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ')} |`,
    );
  }
  const text = L.join('\n');
  console.log(text);
  if (process.env.REPORT_PATH) void Bun.write(process.env.REPORT_PATH, text + '\n');
  if (process.env.REPORT_JSON) void Bun.write(process.env.REPORT_JSON, JSON.stringify(rows, null, 2));
  return fail;
}

async function main() {
  if (!TOKEN) throw new Error('TEST_TOKEN_A (ADMIN access token) is required');
  const items = await fetchCatalog();
  const httpItems = items.filter((i) => i.type === 'HTTP');
  const rpcItems = items.filter((i) => i.type === 'RPC');
  console.log(`Probing ${httpItems.length} HTTP routes and ${rpcItems.length} RPC patterns...`);

  await pool(httpItems, probeHttp);

  const rpc = await rpcClient();
  try {
    await pool(rpcItems, (it) => probeRpc(rpc, it));
  } finally {
    await rpc.close();
  }

  await flowFromLogs();
  if (process.env.SAVE_RESULTS === '1') await persist();
  process.exit(report() > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Script crashed:', e);
  process.exit(2);
});
