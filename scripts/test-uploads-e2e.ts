/**
 * End-to-end checks for the uploads module (HTTP routes under /upload) against a RUNNING service.
 *
 * Run:  bun scripts/test-uploads-e2e.ts
 *
 * Env:
 *   UPLOAD_BASE_URL   default http://localhost:4002  (service base URL)
 *   TEST_TOKEN_A      access token of an ADMIN/TUTOR/STUDENT user (required for authenticated cases)
 *   TEST_TOKEN_B      access token of a DIFFERENT user (optional; enables the ownership 403 case)
 *   TEST_TOKEN_PARENT access token of a PARENT user (optional; enables the role 403 case)
 *   RUN_QUOTA=1       also run the per-minute quota case (sends 31 uploads; off by default)
 *   REPORT_PATH       optional file path to also write the markdown report to
 *   SAVE_RESULTS=1    store PASS/FAIL cases in Postgres (test_scenarios + test_runs, service = 'third').
 *                     Uses POSTGRES_HOST/PORT/DB/USER/PASSWORD from .env. SKIP cases are not stored.
 *
 * Only objects created by this script are touched. Every created key is deleted at the end.
 * Exit code 1 when any case fails, so it can be used in CI.
 */
import sharp from 'sharp';
import postgres from 'postgres';

const BASE = (process.env.UPLOAD_BASE_URL ?? 'http://localhost:4002').replace(/\/+$/, '');
const TOKEN_A = process.env.TEST_TOKEN_A ?? '';
const TOKEN_B = process.env.TEST_TOKEN_B ?? '';
const TOKEN_PARENT = process.env.TEST_TOKEN_PARENT ?? '';
const RUN_QUOTA = process.env.RUN_QUOTA === '1';

type Result = {
  id: string;
  route: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  expected: string;
  actual: string;
  note?: string;
  ms: number;
};

const results: Result[] = [];
let lastMs = 0;
const createdKeys = new Set<string>();

type Resp = { status: number; body: any; text: string; headers: Headers };

async function call(
  method: string,
  path: string,
  opts: { token?: string; form?: FormData } = {},
): Promise<Resp> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, { method, headers, body: opts.form });
  const text = await res.text();
  lastMs = Date.now() - t0;
  let body: any = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON (download stream) */
  }
  // ResponseInterceptor wraps success bodies in { data }.
  const data = body && typeof body === 'object' && 'data' in body ? body.data : body;
  if (data && typeof data === 'object' && typeof data.key === 'string') createdKeys.add(data.key);
  if (Array.isArray(data))
    for (const d of data) if (d && typeof d.key === 'string') createdKeys.add(d.key);
  return { status: res.status, body: data, text, headers: res.headers };
}

function fileForm(field: string, name: string, bytes: Uint8Array | Buffer, type: string): FormData {
  const form = new FormData();
  form.append(field, new Blob([bytes], { type }), name);
  return form;
}

async function makePng(width = 64, height = 64): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
}

function record(
  id: string,
  route: string,
  name: string,
  expected: string,
  actual: string,
  ok: boolean | null,
  note?: string,
) {
  results.push({
    id,
    route,
    name,
    status: ok === null ? 'SKIP' : ok ? 'PASS' : 'FAIL',
    expected,
    actual,
    note,
    ms: lastMs,
  });
}

/** Expected status is a single code or a list of acceptable codes. */
function expectStatus(
  id: string,
  route: string,
  name: string,
  r: Resp,
  expected: number | number[],
  note?: string,
) {
  const list = Array.isArray(expected) ? expected : [expected];
  record(id, route, name, list.join(' or '), String(r.status), list.includes(r.status), note);
}

function skip(id: string, route: string, name: string, reason: string) {
  record(id, route, name, '-', '-', null, reason);
}

async function main() {
  const png = await makePng();
  const jpgLike = Buffer.from('not really an image');

  // ---------- Unauthenticated / role gates ----------
  {
    const r = await call('POST', '/upload/upload', {
      form: fileForm('file', 'a.png', png, 'image/png'),
    });
    expectStatus(
      'U-01',
      'POST /upload/upload',
      'no token -> must be refused (401/403), never 201',
      r,
      [401, 403],
      'route is JWT-guarded (upload controller is not @Public)',
    );
  }

  {
    // Key is only an object we created; if the route is open, we clean it up at the end.
    const up = await call('POST', '/upload/upload', {
      token: TOKEN_A,
      form: fileForm('file', 'del-probe.png', png, 'image/png'),
    });
    if (up.status === 201) {
      const key = up.body.key as string;
      const r = await call('DELETE', `/upload/delete/${encodeURIComponent(key)}`);
      expectStatus(
        'U-02',
        'DELETE /upload/delete/:key',
        'delete with no token -> must be refused (401/403)',
        r,
        [401, 403],
        'delete is JWT-guarded',
      );
    } else {
      skip(
        'U-02',
        'DELETE /upload/delete/:key',
        'delete with no token',
        `setup upload failed (${up.status})`,
      );
    }
  }

  if (!TOKEN_A) {
    skip('A-*', 'authenticated routes', 'all authenticated cases', 'TEST_TOKEN_A not set');
  } else {
    await runAuthenticated(png, jpgLike);
  }

  if (TOKEN_B && TOKEN_A) {
    await runOwnership(png);
  } else {
    skip('O-01', 'GET /upload/download', 'other user cannot download', 'TEST_TOKEN_B not set');
  }

  if (TOKEN_PARENT) {
    const r = await call('POST', '/upload/upload', {
      token: TOKEN_PARENT,
      form: fileForm('file', 'p.png', png, 'image/png'),
    });
    expectStatus('R-01', 'POST /upload/upload', 'PARENT role -> 403', r, 403);
  } else {
    skip('R-01', 'POST /upload/upload', 'PARENT role -> 403', 'TEST_TOKEN_PARENT not set');
  }

  // ---------- Cleanup ----------
  for (const key of createdKeys) {
    await call('DELETE', `/upload/delete/${encodeURIComponent(key)}`, {
      token: TOKEN_A || undefined,
    });
  }

  if (process.env.SAVE_RESULTS === '1') await persistResults();
  report();
}

async function runAuthenticated(png: Buffer, jpgLike: Buffer) {
  const A = TOKEN_A;

  // Single upload: happy path
  let uploadedKey = '';
  {
    const r = await call('POST', '/upload/upload', {
      token: A,
      form: fileForm('file', 'photo.png', png, 'image/png'),
    });
    const ok = r.status === 201 && typeof r.body?.key === 'string';
    if (ok) uploadedKey = r.body.key;
    record(
      'A-01',
      'POST /upload/upload',
      'valid PNG -> 201 with url/key/size/mimetype',
      '201 + body',
      String(r.status),
      ok &&
        /^uploads\/.+\.jpg$/.test(r.body.key) &&
        r.body.mimetype === 'image/jpeg' &&
        typeof r.body.url === 'string',
      ok ? `key=${r.body.key}` : r.text.slice(0, 200),
    );
  }

  {
    const r = await call('POST', '/upload/upload', { token: A, form: new FormData() });
    expectStatus('A-02', 'POST /upload/upload', 'no file field -> 400', r, 400);
  }

  {
    const r = await call('POST', '/upload/upload', {
      token: A,
      form: fileForm('file', 'run.exe', Buffer.from('MZ'), 'application/octet-stream'),
    });
    expectStatus('A-03', 'POST /upload/upload', 'disallowed extension (.exe) -> 400', r, 400);
  }

  {
    const r = await call('POST', '/upload/upload', {
      token: A,
      form: fileForm('file', 'page.html', Buffer.from('<b>x</b>'), 'text/html'),
    });
    expectStatus('A-04', 'POST /upload/upload', 'blocked mimetype text/html -> 400', r, 400);
  }

  {
    const r = await call('POST', '/upload/upload', {
      token: A,
      form: fileForm('file', 'broken.png', jpgLike, 'image/png'),
    });
    expectStatus('A-05', 'POST /upload/upload', 'corrupt image bytes -> 400 Invalid image', r, 400);
  }

  {
    const r = await call('POST', '/upload/upload', {
      token: A,
      form: fileForm('file', 'empty.png', Buffer.alloc(0), 'image/png'),
    });
    expectStatus('A-06', 'POST /upload/upload', 'empty file -> 400', r, 400);
  }

  {
    const big = Buffer.alloc(11 * 1024 * 1024, 1);
    const r = await call('POST', '/upload/upload', {
      token: A,
      form: fileForm('file', 'big.txt', big, 'text/plain'),
    });
    expectStatus('A-07', 'POST /upload/upload', 'over 10MB -> 400/413', r, [400, 413]);
  }

  {
    const txt = Buffer.from('hello uploads');
    const r = await call('POST', '/upload/upload', {
      token: A,
      form: fileForm('file', 'notes.txt', txt, 'text/plain'),
    });
    const ok =
      r.status === 201 && r.body?.mimetype === 'text/plain' && /\.txt$/.test(r.body?.key ?? '');
    record(
      'A-08',
      'POST /upload/upload',
      'document .txt -> 201, stored as text/plain',
      '201 + text/plain',
      String(r.status),
      ok,
    );
  }

  // Multiple
  {
    const r = await call('POST', '/upload/uploadMultiple', {
      token: A,
      form: (() => {
        const f = new FormData();
        f.append('files', new Blob([png], { type: 'image/png' }), 'a.png');
        f.append('files', new Blob([png], { type: 'image/png' }), 'b.png');
        return f;
      })(),
    });
    const ok = r.status === 201 && Array.isArray(r.body) && r.body.length === 2;
    record(
      'M-01',
      'POST /upload/uploadMultiple',
      '2 valid files -> 201 array of 2',
      '201 + 2 items',
      String(r.status),
      ok,
    );
  }

  {
    const f = new FormData();
    for (let i = 0; i < 6; i++)
      f.append('files', new Blob([png], { type: 'image/png' }), `${i}.png`);
    const r = await call('POST', '/upload/uploadMultiple', { token: A, form: f });
    expectStatus(
      'M-02',
      'POST /upload/uploadMultiple',
      'more than 5 files -> 400/413',
      r,
      [400, 413],
    );
  }

  {
    const f = new FormData();
    f.append('files', new Blob([png], { type: 'image/png' }), 'ok.png');
    f.append('files', new Blob([jpgLike], { type: 'image/png' }), 'bad.png');
    const r = await call('POST', '/upload/uploadMultiple', { token: A, form: f });
    expectStatus(
      'M-03',
      'POST /upload/uploadMultiple',
      'one corrupt file -> whole request 400',
      r,
      400,
    );
  }

  // Download
  if (uploadedKey) {
    const r = await call('GET', `/upload/download?key=${encodeURIComponent(uploadedKey)}`, {
      token: A,
    });
    const ok =
      r.status === 200 &&
      (r.headers.get('content-type') ?? '').startsWith('image/jpeg') &&
      (r.headers.get('content-disposition') ?? '').startsWith('attachment') &&
      r.headers.get('x-content-type-options') === 'nosniff';
    record(
      'D-01',
      'GET /upload/download',
      'owner downloads own file -> 200 attachment, nosniff',
      '200 + headers',
      String(r.status),
      ok,
    );
  } else {
    skip('D-01', 'GET /upload/download', 'owner downloads own file', 'A-01 did not produce a key');
  }

  {
    const r = await call('GET', '/upload/download', { token: A });
    expectStatus('D-02', 'GET /upload/download', 'missing key param -> 400', r, 400);
  }

  {
    const r = await call(
      'GET',
      `/upload/download?key=${encodeURIComponent(`uploads/${crypto.randomUUID()}.jpg`)}`,
      { token: A },
    );
    expectStatus('D-03', 'GET /upload/download', 'unknown key -> 404', r, 404);
  }

  {
    const r = await call(
      'GET',
      `/upload/download?key=${encodeURIComponent('uploads/../secret.txt')}`,
      { token: A },
    );
    expectStatus('D-04', 'GET /upload/download', 'path traversal -> 400', r, 400);
  }

  {
    const r = await call('GET', `/upload/download?key=${encodeURIComponent('other/x.txt')}`, {
      token: A,
    });
    expectStatus('D-05', 'GET /upload/download', 'key outside uploads/ -> 400', r, 400);
  }

  // Delete
  {
    const r = await call('DELETE', `/upload/delete/${encodeURIComponent('uploads/../etc.txt')}`, {
      token: A,
    });
    expectStatus('X-01', 'DELETE /upload/delete/:key', 'traversal key -> 400', r, 400);
  }

  if (uploadedKey) {
    const del = await call('DELETE', `/upload/delete/${encodeURIComponent(uploadedKey)}`, {
      token: A,
    });
    expectStatus('X-02', 'DELETE /upload/delete/:key', 'delete own file -> 200', del, [200]);
    const after = await call('GET', `/upload/download?key=${encodeURIComponent(uploadedKey)}`, {
      token: A,
    });
    expectStatus('X-03', 'GET /upload/download', 'file gone after delete -> 404', after, 404);
    createdKeys.delete(uploadedKey);
  } else {
    skip('X-02', 'DELETE /upload/delete/:key', 'delete own file', 'A-01 did not produce a key');
  }

  if (RUN_QUOTA) {
    let last = 0;
    for (let i = 0; i < 31; i++) {
      const r = await call('POST', '/upload/upload', {
        token: A,
        form: fileForm('file', `q${i}.txt`, Buffer.from('q'), 'text/plain'),
      });
      last = r.status;
      if (r.status === 429) break;
    }
    record(
      'Q-01',
      'POST /upload/upload',
      '31st upload in one minute -> 429',
      '429',
      String(last),
      last === 429,
      'needs Redis; fails open without it',
    );
  } else {
    skip(
      'Q-01',
      'POST /upload/upload',
      'per-minute quota -> 429',
      'set RUN_QUOTA=1 to run (31 uploads)',
    );
  }
}

async function runOwnership(png: Buffer) {
  // A uploads a file; B must not be able to download it (non-admin B).
  const up = await call('POST', '/upload/upload', {
    token: TOKEN_A,
    form: fileForm('file', 'owned.png', png, 'image/png'),
  });
  if (up.status !== 201) {
    skip(
      'O-01',
      'GET /upload/download',
      'other user cannot download',
      `owner upload failed (${up.status})`,
    );
    return;
  }
  const r = await call('GET', `/upload/download?key=${encodeURIComponent(up.body.key)}`, {
    token: TOKEN_B,
  });
  expectStatus('O-01', 'GET /upload/download', 'other user cannot download -> 403', r, 403);
}

const CATEGORY_BY_STATUS = (status: number): string => {
  if (status >= 200 && status < 300) return 'valid';
  if (status === 401 || status === 403) return 'auth';
  if (status === 400 || status === 413) return 'validation';
  if (status === 404) return 'not_found';
  return 'domain';
};

async function persistResults(): Promise<void> {
  const sql = postgres({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB,
    username: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    max: 1,
  });
  const correlationId = `uploads-e2e-${crypto.randomUUID()}`;
  let saved = 0;
  try {
    for (const r of results) {
      if (r.status === 'SKIP') continue;
      const [method, ...rest] = r.route.split(' ');
      const path = rest.join(' ');
      // expected is e.g. "400", "400 or 413", "201 + body": keep the first HTTP status code.
      const expectedStatus = Number(r.expected.match(/\d{3}/)?.[0]);
      const actualStatus = Number(r.actual);
      const hasActual = Number.isFinite(actualStatus);
      const passed = r.status === 'PASS';
      const name = `${r.id} ${r.name}`.slice(0, 200);
      const authProfile = r.id.startsWith('U-') ? 'none' : 'caller';
      const category = CATEGORY_BY_STATUS(expectedStatus);

      let scenario = await sql<{ id: string }[]>`
        select id from test_scenarios
        where service = 'third' and method = ${method} and path = ${path} and name = ${name}
        limit 1`;
      if (scenario.length === 0) {
        scenario = await sql<{ id: string }[]>`
          insert into test_scenarios
            (service, method, path, name, description, expected_status, category, auth_profile)
          values ('third', ${method}, ${path}, ${name}, ${r.note ?? null}, ${expectedStatus},
            ${category}::test_scenario_category, ${authProfile}::test_auth_profile)
          returning id`;
      }

      await sql`
        insert into test_runs
          (scenario_id, correlation_id, actual_status, expected_status, passed, duration_ms,
           error_message, request_path)
        values (${scenario[0].id}, ${correlationId}, ${hasActual ? actualStatus : null},
          ${expectedStatus}, ${passed}, ${Math.round(r.ms)}, ${passed ? null : (r.note ?? r.actual)},
          ${path})`;
      saved++;
    }
    console.log(`\nSaved ${saved} runs to test_runs (correlation_id=${correlationId})`);
  } finally {
    await sql.end();
  }
}

function report() {
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;

  const lines: string[] = [];
  lines.push(`# Uploads E2E report`);
  lines.push('');
  lines.push(`Base URL: ${BASE}`);
  lines.push(`Total: ${results.length} | PASS: ${pass} | FAIL: ${fail} | SKIP: ${skipped}`);
  lines.push('');
  lines.push('| ID | Route | Case | Expected | Actual | Result | Note |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of results) {
    lines.push(
      `| ${r.id} | ${r.route} | ${r.name} | ${r.expected} | ${r.actual} | ${r.status} | ${(r.note ?? '').replace(/\|/g, '/')} |`,
    );
  }
  const text = lines.join('\n');
  console.log(text);

  if (process.env.REPORT_PATH) {
    void Bun.write(process.env.REPORT_PATH, text + '\n');
    console.log(`\nReport written to ${process.env.REPORT_PATH}`);
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Script crashed:', err);
  process.exit(2);
});
