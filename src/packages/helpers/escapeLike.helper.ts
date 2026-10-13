/** Escape `\`, `%` and `_` so user input is matched literally inside an ILIKE pattern. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
