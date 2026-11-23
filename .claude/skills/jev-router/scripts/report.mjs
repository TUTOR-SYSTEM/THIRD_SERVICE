#!/usr/bin/env node
// Per-prompt report of what Jev did: how many Jev calls, which agent/model it picked, and which models
// actually ran (read from the Claude Code transcripts).
//
//   node .claude/skills/jev-router/scripts/report.mjs            # the latest prompt of this repo
//   node .claude/skills/jev-router/scripts/report.mjs --last 3   # the latest 3 prompts
//   node .claude/skills/jev-router/scripts/report.mjs --all      # every prompt in the log
//   node .claude/skills/jev-router/scripts/report.mjs --any-repo # do not filter by repo
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const li = args.indexOf('--last');
const LAST = args.includes('--all') ? Infinity : li >= 0 ? Number(args[li + 1]) || 1 : 1;
const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../..').split('/').filter(Boolean).pop();
const LOG = join(homedir(), '.local/state/jev-router/gate.jsonl');
if (!existsSync(LOG)) { console.log('No gate log yet:', LOG); process.exit(0); }

const rows = readFileSync(LOG, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const mine = rows.filter((r) => r.turn && (args.includes('--any-repo') || r.repo === REPO));

// group by session + turn
const groups = new Map();
for (const r of mine) {
  const k = `${r.session}|${r.turn}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(r);
}
const list = [...groups.entries()].sort((a, b) => a[1][0].turn.localeCompare(b[1][0].turn));
if (!list.length) { console.log('No prompt with turn info yet. Send a prompt in a new session (hooks reload) and retry.'); process.exit(0); }
const shown = list.slice(-LAST === -Infinity ? 0 : -LAST);

function models(file, from, to) {
  const c = {};
  try {
    for (const l of readFileSync(file, 'utf8').split('\n')) {
      if (!l) continue;
      const e = JSON.parse(l);
      if (e.type !== 'assistant' || !e.message?.model || e.message.model === '<synthetic>') continue;
      if ((from && e.timestamp < from) || (to && e.timestamp >= to)) continue;
      c[e.message.model] = (c[e.message.model] || 0) + 1;
    }
  } catch {}
  return c;
}
const fmt = (c) => Object.entries(c).map(([m, n]) => `${m} ×${n}`).join(', ') || '(none)';
const bump = (o, k) => (o[k] = (o[k] || 0) + 1);

for (const [key, g] of shown) {
  const [sid, turn] = key.split('|');
  const idx = list.findIndex(([k]) => k === key);
  const next = list.slice(idx + 1).find(([k]) => k.startsWith(sid + '|'));
  const to = next ? next[1][0].turn : null;
  const jevCalls = g.filter((r) => r.jev);
  const totalMs = jevCalls.reduce((s, r) => s + (r.ms || 0), 0);
  const byMode = {};
  for (const r of g) bump(byMode, r.mode);

  console.log(`\n=== Prompt @ ${turn.replace('T', ' ').slice(0, 19)}Z  | repo=${g[0].repo} | session=${sid.slice(0, 8)}`);
  console.log(`Jev calls: ${jevCalls.length} (prompt ${byMode.prompt || 0}, agent ${byMode.agent || 0}, tool ${byMode.tool || 0}) | total ${totalMs} ms | Jev model: jev-1.14.0` +
    (g.some((r) => !r.jev && r.mode !== 'skip') ? ` | fail-open: ${g.filter((r) => !r.jev && r.mode !== 'skip').length}` : '') +
    (g.some((r) => r.mode === 'skip') ? ` | skipped system notifications: ${g.filter((r) => r.mode === 'skip').length}` : ''));

  for (const r of g.filter((r) => r.mode === 'prompt'))
    console.log(`  [prompt] Jev suggests subagent=${r.subagent}, model=${r.model} (${r.ms} ms)`);
  for (const r of g.filter((r) => r.mode === 'agent'))
    console.log(`  [agent]  ${r.from} -> ${r.to}, model=${r.model} ${r.changed ? '(OVERRIDDEN by Jev)' : '(unchanged)'} (${r.ms} ms)`);

  const tools = g.filter((r) => r.mode === 'tool');
  if (tools.length) {
    const per = {}; const by = { main: 0, subagent: 0 };
    for (const r of tools) { bump(per, r.tool); by[r.agent ? 'subagent' : 'main']++; }
    const maxD = Math.max(...tools.map((r) => r.destructive || 0)); const maxO = Math.max(...tools.map((r) => r.off_task || 0));
    console.log(`  [tool]   ${tools.length} calls (${Object.entries(per).map(([k, v]) => `${k}×${v}`).join(', ')}); in main=${by.main}, in subagents=${by.subagent}`);
    console.log(`           max destructive=${maxD}, max off-task=${maxO}, escalated to "ask": ${tools.filter((r) => r.escalate).length}`);
  }

  // actual models (transcripts)
  const tr = g.find((r) => r.transcript)?.transcript;
  if (tr) {
    console.log('  Models that actually ran:');
    console.log(`    main      : ${fmt(models(tr, turn, to))}`);
    const dir = join(tr.replace(/\.jsonl$/, ''), 'subagents');
    try {
      for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl'))) {
        const file = join(dir, f);
        const first = readFileSync(file, 'utf8').split('\n').find(Boolean);
        const ts = first ? JSON.parse(first).timestamp : '';
        if (ts < turn || (to && ts >= to)) continue;
        let type = '?';
        try { type = JSON.parse(readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8')).agentType || '?'; } catch {}
        console.log(`    subagent  : ${type} (${f.replace(/^agent-|\.jsonl$/g, '').slice(0, 8)}) : ${fmt(models(file))}`);
      }
    } catch {}
  }
}
console.log();
