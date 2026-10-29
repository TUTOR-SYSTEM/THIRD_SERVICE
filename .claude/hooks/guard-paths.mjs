#!/usr/bin/env node
// PreToolUse hook (Write|Edit): ask before editing protected files.
//   - .env / .env.* / *.env (e.g. docker.env) — hold secrets; Claude asks before editing them.
// (drizzle/ migrations moved to the gateway repo — 2026-09-28 schema consolidation — so that
// half of the rule no longer applies here.)
// Emits a PreToolUse permission decision ("ask") as JSON; otherwise stays silent and allows the edit.
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let data;
  try {
    data = JSON.parse(input || '{}');
  } catch {
    process.exit(0);
  }

  const file = data?.tool_input?.file_path || '';
  const norm = file.replace(/\\/g, '/');

  const rules = [
    {
      re: /(^|\/)(\.env(\.[^/]+)?|[^/]*\.env)$/,
      why: 'env files hold secrets — confirm before Claude edits them.',
    },
  ];

  for (const rule of rules) {
    if (rule.re.test(norm)) {
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'ask',
            permissionDecisionReason: rule.why,
          },
        }),
      );
      process.exit(0);
    }
  }

  process.exit(0);
});
