#!/usr/bin/env node
// Jev gate: routes EVERY user prompt, EVERY subagent call and EVERY tool call through Jev.
//
//   hook.mjs prompt   (UserPromptSubmit) -> Jev picks {subagent, model} for the prompt and hands it to
//                                           Claude as context; the prompt is remembered for later calls.
//   hook.mjs pre      (PreToolUse, matcher "*")
//        tool = Agent -> Jev re-routes the sub-task: sets `model` (when not explicit) and, for role
//                        agents / general-purpose only, `subagent_type` (updatedInput).
//        other tools  -> Jev answers "destructive?" / "off-task?" about the call; very likely risky
//                        calls become an "ask". Everything else is left to normal permissions.
//
// Fail-open: no key, timeout or Jev error => silent exit 0. Disable with JEV_GATE=off.
// Every pass through Jev is appended to ~/.local/state/jev-router/gate.jsonl (no prompt/tool text).
// Privacy: the prompt, the Agent task text and a short redacted summary of each tool call
// (command / path / pattern, never file contents) are sent to the TypeSafe API.
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { choice, noul, TypeSafeClient } from '@typesafe-ai/sdk';

if (process.env.JEV_GATE === 'off') process.exit(0);

const MODE = process.argv[2];
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../..'); // repo root
const STATE_DIR = join(homedir(), '.local/state/jev-router');
const JEV_MODEL = 'jev-1.14.0';
const YES = 0.7;
const MIN_AGENT_P = 0.5;
const RISK_ASK = 0.85; // a tool call is only escalated to "ask" above this
const OVERALL_TIMEOUT_MS = 8000;

const DESC = {
  dev: 'Implements a feature or change in code, or fixes a bug',
  test: 'Runs or writes tests, or fixes failing tests or coverage',
  review: 'Reviews an existing diff or code for correctness',
  security: 'Audits code for security vulnerabilities',
  orchestrator: 'A larger request with several independent parts that need implementing, testing and reviewing',
  'general-purpose': 'Anything else: questions, research, explanations',
};
function agentOptions() {
  let have = [];
  try {
    have = readdirSync(join(ROOT, '.claude/agents')).map((f) => f.replace(/\.md$/, ''));
  } catch {}
  const o = {};
  for (const k of Object.keys(DESC)) if (k === 'general-purpose' || have.includes(k)) o[k] = DESC[k];
  return o;
}
const ROLE_AGENTS = new Set(['dev', 'test', 'review', 'security', 'orchestrator']);

function loadKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  let dir = ROOT;
  for (let i = 0; i < 3; i++, dir = join(dir, '..')) {
    try {
      const m = readFileSync(join(dir, '.env'), 'utf8').match(/^TYPESAFE_API_KEY=(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch {}
  }
  return undefined;
}

function log(entry) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    appendFileSync(
      join(STATE_DIR, 'gate.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), repo: ROOT.split('/').pop(), session: sid, turn: (() => { try { return JSON.parse(readFileSync(stateFile, 'utf8')).turn; } catch { return undefined; } })(), agent: input.agent_id || null, transcript: input.transcript_path || null, ...entry }) + '\n',
    );
  } catch {}
}
function countCall() {
  const f = join(STATE_DIR, 'count.json');
  try {
    let n = 0;
    try {
      n = JSON.parse(readFileSync(f, 'utf8')).calls || 0;
    } catch {}
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(f, JSON.stringify({ calls: n + 1, updated: Date.now() }));
  } catch {}
}
const emit = (o) => process.stdout.write(JSON.stringify(o));

// ---- read the hook input
let raw = '';
for await (const c of process.stdin) raw += c;
let input = {};
try {
  input = JSON.parse(raw || '{}');
} catch {
  process.exit(0);
}
const sid = String(input.session_id || 'nosession').replace(/[^\w-]/g, '');
const stateFile = join(tmpdir(), `jev-gate-${sid}.json`);
const readState = () => {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch {
    return {};
  }
};

const key = loadKey();
if (!key) {
  log({ mode: MODE, jev: false, why: 'no key' });
  process.exit(0);
}
process.env.TYPESAFE_API_KEY = key;
const client = new TypeSafeClient({ timeout: 6000 });
const ask = (state, questions) =>
  Promise.race([
    client.systemOne({ state, questions, model: JEV_MODEL }).then((r) => r.answers),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), OVERALL_TIMEOUT_MS)),
  ]);

function routeQuestions() {
  return {
    agent: choice('Which kind of work does the user ask for?', agentOptions()),
    is_bug_fix: noul('Does the user ask to fix a bug or an error in existing code?'),
    is_rename: noul('Does the user ask to rename an existing field, variable, function, class or file?'),
    is_ui_creation: noul('Does the user ask to create or build a user interface, page or component?'),
    is_security_review: noul('Does the user ask for a security review, audit or vulnerability check of code, authentication, permissions, secrets or dependencies?'),
    is_migration_issue: noul('Does the user ask to check, debug, fix or review a database or data migration (schema migration, migration errors, migrating data)?'),
    is_system_design: noul('Does the user ask to design or re-architect a system, architecture, data model or cross-service flow?'),
  };
}
function decide(answers) {
  const a = answers.agent;
  const p = a.probabilities[a.choice] ?? 0;
  const confident = p >= MIN_AGENT_P;
  const general = confident && a.choice === 'general-purpose';
  // Opus: security review, migration check/debug, system design (wins over the cheap rules).
  const heavy =
    answers.is_security_review.noul > YES || answers.is_migration_issue.noul > YES || answers.is_system_design.noul > YES;
  const cheap =
    !heavy && (answers.is_bug_fix.noul > YES || answers.is_ui_creation.noul > YES || answers.is_rename.noul > YES || general);
  return {
    subagent: confident ? a.choice : 'general-purpose',
    model: heavy ? 'opus' : cheap ? 'haiku' : 'sonnet',
    agent_p: p,
    cheap,
    heavy,
  };
}

const redact = (s) =>
  String(s)
    .replace(/\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS)[A-Z0-9_]*)=\S+/gi, '$1=<redacted>')
    .replace(/(Bearer|Basic)\s+[\w.~+/=-]+/gi, '$1 <redacted>')
    .replace(/\b(sk|pk|ghp|gho|xox[bp])[-_][\w-]{10,}/g, '<redacted>')
    .replace(/:\/\/[^/\s:@]+:[^/\s@]+@/g, '://<redacted>@');
const ENV_PATH = /(^|\/)(\.env(\.[^/]*)?|[^/]*\.env)$/;
function summarize(tool, ti = {}) {
  const path = ti.file_path || ti.notebook_path || ti.path || '';
  if (path && ENV_PATH.test(path)) return `${tool} on an env file`;
  if (tool === 'Bash') return redact(ti.command || '').slice(0, 400);
  if (path) return `${path}${ti.pattern ? ` pattern=${ti.pattern}` : ''}`.slice(0, 300);
  if (ti.pattern) return `pattern=${String(ti.pattern).slice(0, 200)}`;
  if (ti.url) return redact(ti.url).slice(0, 300);
  if (ti.query) return String(ti.query).slice(0, 200);
  return `args: ${Object.keys(ti).join(',')}`.slice(0, 200);
}

const t0 = Date.now();
try {
  if (MODE === 'prompt') {
    const prompt = String(input.prompt || '').trim();
    if (!prompt) process.exit(0);
    // Background-task notifications / system reminders arrive as "prompts": not user work, don't route them.
    if (/^<(task-notification|system-reminder)/.test(prompt)) {
      log({ mode: 'skip', jev: false, why: 'system notification' });
      process.exit(0);
    }
    countCall();
    const answers = await ask({ user_prompt: prompt.slice(0, 4000) }, routeQuestions());
    const d = decide(answers);
    writeFileSync(stateFile, JSON.stringify({ prompt: prompt.slice(0, 1500), route: d, turn: new Date().toISOString() }));
    log({ mode: 'prompt', jev: true, ms: Date.now() - t0, subagent: d.subagent, model: d.model });
    emit({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext:
          `[Jev route] subagent=${d.subagent}, model=${d.model}${d.heavy ? ' (security/migration/design task)' : d.cheap ? ' (cheap task)' : ''}. ` +
          `Delegate with the Agent tool (subagent_type/model) ONLY if the session is not already that model/role; if the main thread already matches (or the task is small), do the work directly in this chat without spawning a subagent. Each Agent call and each tool call is also checked by Jev through hooks.`,
      },
    });
  } else if (MODE === 'pre') {
    const tool = input.tool_name || '';
    const ti = input.tool_input || {};
    const st = readState();
    countCall();

    if (tool === 'Agent') {
      const task = `${ti.description || ''}\n${ti.prompt || ''}`.trim();
      if (!task) process.exit(0);
      const d = decide(await ask({ user_prompt: task.slice(0, 4000) }, routeQuestions()));
      const cur = ti.subagent_type || 'general-purpose';
      const canSwap = cur === 'general-purpose' || ROLE_AGENTS.has(cur);
      const next = { ...ti };
      if (canSwap && d.subagent !== cur && (d.subagent === 'general-purpose' || agentOptions()[d.subagent]))
        next.subagent_type = d.subagent;
      if (!ti.model) next.model = d.model;
      const changed = next.subagent_type !== ti.subagent_type || next.model !== ti.model;
      log({ mode: 'agent', jev: true, ms: Date.now() - t0, from: cur, to: next.subagent_type || cur, model: next.model || null, changed });
      if (changed) {
        emit({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: `Jev: subagent=${next.subagent_type || cur}, model=${next.model || 'default'}`,
            updatedInput: next,
          },
        });
      }
    } else {
      const answers = await ask(
        { user_prompt: st.prompt || '(unknown)', tool_name: tool, tool_call: summarize(tool, ti) },
        {
          is_destructive: noul('Is this tool call destructive, irreversible, or does it change shared/remote state?'),
          is_off_task: noul('Is this tool call clearly unrelated to what the user asked for?'),
        },
      );
      const destructive = answers.is_destructive.noul;
      const off = answers.is_off_task.noul;
      const escalate = destructive > RISK_ASK || off > RISK_ASK;
      log({ mode: 'tool', jev: true, ms: Date.now() - t0, tool, destructive, off_task: off, escalate });
      if (escalate) {
        emit({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'ask',
            permissionDecisionReason: `Jev flagged this ${tool} call (destructive=${destructive}, off-task=${off}) — confirm.`,
          },
        });
      }
    }
  }
} catch (err) {
  log({ mode: MODE, tool: input.tool_name, jev: false, why: String(err.message || err).slice(0, 120), ms: Date.now() - t0 });
}
process.exit(0);
