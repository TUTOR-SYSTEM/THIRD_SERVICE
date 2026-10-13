/** Strip bound SQL params from drizzle "Failed query" messages before logging. */
export function sanitizeLogMessage(message: string): string {
  if (!message.startsWith('Failed query:')) {
    return message;
  }
  const idx = message.search(/\n?\s*params:/);
  return idx >= 0 ? message.slice(0, idx) : message;
}
