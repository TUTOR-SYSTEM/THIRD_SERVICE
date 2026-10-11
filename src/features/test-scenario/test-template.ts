import { randomUUID } from 'node:crypto';

/** `{{name}}` placeholders: letters, digits, `_` and `.` (e.g. `fixture.classId`, `token.student`). */
const VARIABLE_PATTERN = /\{\{\s*([A-Za-z][\w.]*)\s*\}\}/g;

/** A well-formed UUID that no row will ever have — for "not found" cases. */
export const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';

/** Every distinct variable name used in a string or (deeply) in a JSON value. */
export function collectVariables(...values: unknown[]): string[] {
  const names = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(VARIABLE_PATTERN)) names.add(match[1]);
    } else if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value !== null && typeof value === 'object') {
      Object.entries(value).forEach(([key, val]) => {
        visit(key);
        visit(val);
      });
    }
  };
  values.forEach(visit);
  return [...names];
}

/** Fills `{{name}}` in a string; a name missing from `vars` is left as is. */
export function renderString(value: string, vars: ReadonlyMap<string, string>): string {
  return value.replace(VARIABLE_PATTERN, (whole, name: string) => vars.get(name) ?? whole);
}

/** Fills `{{name}}` in every string of a JSON value (keys included), keeping its structure. */
export function renderValue(value: unknown, vars: ReadonlyMap<string, string>): unknown {
  if (typeof value === 'string') return renderString(value, vars);
  if (Array.isArray(value)) return value.map((item) => renderValue(item, vars));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [renderString(key, vars), renderValue(val, vars)]),
    );
  }
  return value;
}

/** Values that need no lookup. Each run gets fresh random ones, so "create" cases don't collide. */
export function builtinVariable(name: string): string | undefined {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
  switch (name) {
    case 'uuid':
      return randomUUID();
    case 'unknownUuid':
      return UNKNOWN_UUID;
    case 'timestamp':
      return String(Date.now());
    case 'random.email':
      return `test+${suffix}@example.com`;
    case 'random.string':
      return suffix;
    default:
      return undefined;
  }
}

/** Reads `data.classes.0.id`-style dot paths out of a parsed JSON body (numbers index arrays). */
export function extractPath(source: unknown, path: string): unknown {
  let current = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
