#!/usr/bin/env node
// Stop hook: after every Claude answer, show the user a short Jev report for that prompt:
// how many times Jev was called, which models Jev picked, and which models actually ran.
// Output is a `systemMessage` (shown to the user, not added to Claude's context). Never blocks.
// Disable with JEV_GATE=off.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

if (process.env.JEV_GATE === 'off') process.exit(0);

let raw = '';
for await (const c of process.stdin) raw += c;
let input = {};
try { input = JSON.parse(raw || '{}'); } catch { process.exit(0); }
if (input.stop_hook_active) process.exit(0);

const LOG = join(homedir(), '.local/state/jev-router/gate.jsonl');
if (!existsSync(LOG)) process.exit(0);
const sid = String(input.session_id || '').replace(/[^\w-]/g, '');
const rows = readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((r) => r && r.session === sid && r.turn);
if (!rows.length) process.exit(0);

const turn = rows.reduce((t, r) => (r.turn > t ? r.turn : t), '');
const g = rows.filter((r) => r.turn === turn);
const jev = g.filter((r) => r.jev);
const count = (arr, f) => arr.reduce((o, x) => { const k = f(x); if (k) o[k] = (o[k] || 0) + 1; return o; }, {});
const fmt = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(', ') || '—';
const short = (m) => m.replace(/^claude-/, '');

const byMode = count(jev, (r) => r.mode);
const ms = jev.reduce((s, r) => s + (r.ms || 0), 0);
const picked = count(g.filter((r) => (r.mode === 'prompt' || r.mode === 'agent') && r.model), (r) => r.model);
const overrides = g.filter((r) => r.mode === 'agent' && r.changed).length;
const asks = g.filter((r) => r.escalate).length;

function models(file, from) {
  const c = {};
  try {
    for (const l of readFileSync(file, 'utf8').split('\n')) {
      if (!l) continue;
      const e = JSON.parse(l);
      if (e.type !== 'assistant' || !e.message?.model || e.message.model === '<synthetic>') continue;
      if (from && e.timestamp < from) continue;
      c[short(e.message.model)] = (c[short(e.message.model)] || 0) + 1;
    }
  } catch {}
  return c;
}
const tr = input.transcript_path || g.find((r) => r.transcript)?.transcript;
const parts = [];
const total = {};
const add = (c) => { for (const [k, v] of Object.entries(c)) total[k] = (total[k] || 0) + v; };
if (tr) {
  const m = models(tr, turn); add(m);
  parts.push(`main: ${fmt(m)}`);
  const dir = join(tr.replace(/\.jsonl$/, ''), 'subagents');
  try {
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
      const file = join(dir, f);
      const first = readFileSync(file, 'utf8').split('\n').find(Boolean);
      if (!first || JSON.parse(first).timestamp < turn) continue;
      let type = 'subagent';
      try { type = JSON.parse(readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')).agentType || type; } catch {}
      const sm = models(file); add(sm);
      parts.push(`${type}: ${fmt(sm)}`);
    }
  } catch {}
}

const lines = [
  `Jev report: ${jev.length} lần gọi Jev (prompt ${byMode.prompt || 0}, agent ${byMode.agent || 0}, tool ${byMode.tool || 0}) · ${(ms / 1000).toFixed(1)}s`,
  `Jev chọn model: ${fmt(picked)}` + (overrides ? ` · ghi đè agent/model: ${overrides}` : '') + (asks ? ` · cảnh báo rủi ro: ${asks}` : ''),
  `Model đã chạy (số lượt trả lời): ${fmt(total)}` + (parts.length ? `  [${parts.join(' | ')}]` : ''),
];
process.stdout.write(JSON.stringify({ systemMessage: lines.join('\n') }));
process.exit(0);
