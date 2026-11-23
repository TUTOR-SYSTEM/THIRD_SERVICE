#!/usr/bin/env node
// Jev routing: asks typed questions about a prompt, maps answers to {subagent, model} in code.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { choice, noul, TypeSafeClient } from '@typesafe-ai/sdk';

const MODELS = ['haiku', 'sonnet', 'opus', 'fable'];
const YES = 0.7; // a Noul above this reads as yes; 0.3 to 0.7 counts as no
const MIN_AGENT_P = 0.5;
const JEV_MODEL = 'jev-1.14.0';

const AGENTS = {
  dev: 'Implements a feature or change in code, or fixes a bug',
  test: 'Runs or writes tests, or fixes failing tests or coverage',
  review: 'Reviews an existing diff or code for correctness',
  security: 'Audits code for security vulnerabilities',
  orchestrator: 'A larger request with several independent parts that need implementing, testing and reviewing',
  'general-purpose': 'Anything else: questions, research, explanations',
};

const args = process.argv.slice(2);
const mi = args.indexOf('--model');
const forced = mi >= 0 ? args.splice(mi, 2)[1] : undefined;
const prompt = args.join(' ').trim();
if (!prompt || (forced && !MODELS.includes(forced))) {
  console.error('usage: route.mjs "<prompt>" [--model haiku|sonnet|opus|fable]');
  process.exit(2);
}

function loadKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  // Look for TYPESAFE_API_KEY in `.env` of the repo root, then in its parent folders
  // (the shared workspace folder that holds all sources keeps one `.env` for every repo).
  let dir = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
  for (let i = 0; i < 3; i++, dir = join(dir, '..')) {
    try {
      const m = readFileSync(join(dir, '.env'), 'utf8').match(/^TYPESAFE_API_KEY=(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch {}
  }
  return undefined;
}

// Counts requests sent to Jev; the Claude Code status line reads this file.
const COUNT_FILE = join(homedir(), '.local/state/jev-router/count.json');
function countCall() {
  try {
    let n = 0;
    try {
      n = JSON.parse(readFileSync(COUNT_FILE, 'utf8')).calls || 0;
    } catch {}
    mkdirSync(dirname(COUNT_FILE), { recursive: true });
    writeFileSync(COUNT_FILE, JSON.stringify({ calls: n + 1, updated: Date.now() }));
  } catch {}
}

const out = (o) => console.log(JSON.stringify(o, null, 2));
const fallback = (reason) =>
  out({ subagent: 'general-purpose', model: forced ?? 'sonnet', fallback: reason });

const key = loadKey();
if (!key) {
  fallback('no TYPESAFE_API_KEY');
  process.exit(0);
}

try {
  process.env.TYPESAFE_API_KEY = key; // the SDK reads the key from the environment
  const client = new TypeSafeClient();
  countCall();
  const { answers } = await client.systemOne({
    state: { user_prompt: prompt },
    questions: {
      agent: choice('Which kind of work does the user ask for?', AGENTS),
      is_bug_fix: noul('Does the user ask to fix a bug or an error in existing code?'),
      is_rename: noul('Does the user ask to rename an existing field, variable, function, class or file?'),
      is_ui_creation: noul('Does the user ask to create or build a user interface, page or component?'),
      is_security_review: noul('Does the user ask for a security review, audit or vulnerability check of code, authentication, permissions, secrets or dependencies?'),
      is_migration_issue: noul('Does the user ask to check, debug, fix or review a database or data migration (schema migration, migration errors, migrating data)?'),
      is_system_design: noul('Does the user ask to design or re-architect a system, architecture, data model or cross-service flow?'),
    },
    model: JEV_MODEL,
  });

  const a = answers.agent;
  const p = a.probabilities[a.choice] ?? 0;
  const bug = answers.is_bug_fix.noul;
  const ui = answers.is_ui_creation.noul;
  const rename = answers.is_rename.noul;
  const confident = p >= MIN_AGENT_P;
  // Bug fixes, UI creation, renames and plain Q&A (Jev confidently says general-purpose) go to haiku.
  const general = confident && a.choice === 'general-purpose';
  const heavy =
    answers.is_security_review.noul > YES || answers.is_migration_issue.noul > YES || answers.is_system_design.noul > YES;
  const cheap = !heavy && (bug > YES || ui > YES || rename > YES || general);
  out({
    subagent: confident ? a.choice : 'general-purpose',
    model: forced ?? (heavy ? 'opus' : cheap ? 'haiku' : 'sonnet'),
    reason: forced
      ? 'model chosen by user'
      : heavy
        ? 'security review, migration issue or system design'
        : cheap
        ? general
          ? 'general question or chat'
          : rename > YES && !(bug > YES || ui > YES)
            ? 'rename'
            : 'bug fix or UI creation'
        : 'default',
    signals: {
      agent: a.choice,
      agent_p: p,
      is_bug_fix: bug,
      is_ui_creation: ui,
      is_rename: rename,
      is_security_review: answers.is_security_review.noul,
      is_migration_issue: answers.is_migration_issue.noul,
      is_system_design: answers.is_system_design.noul,
    },
  });
} catch (err) {
  fallback(`Jev error: ${err.message}`);
}
