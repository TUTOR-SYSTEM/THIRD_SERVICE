/** Thrown when a path would leave the configured gateway origin. */
export class GatewayUrlError extends Error {}

export function gatewayBaseUrl(): string {
  return (process.env.GATEWAY_BASE_URL ?? 'http://localhost:8888').replace(/\/+$/, '');
}

/**
 * Joins `path` onto `GATEWAY_BASE_URL` and refuses anything that would end up on another origin
 * (e.g. `@attacker.example/x`, `//attacker.example`), so a token is never sent off-gateway.
 */
export function buildGatewayUrl(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    throw new GatewayUrlError(
      `Refusing path "${path}": must start with a single "/" and contain no backslash`,
    );
  }
  const base = gatewayBaseUrl();
  let url: URL;
  try {
    url = new URL(`${base}${path}`);
  } catch {
    throw new GatewayUrlError(`Refusing path "${path}": not a valid URL`);
  }
  if (url.origin !== new URL(base).origin) {
    throw new GatewayUrlError(`Refusing path "${path}": resolves outside the gateway origin`);
  }
  return url.toString();
}
