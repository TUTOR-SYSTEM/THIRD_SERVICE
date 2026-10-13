import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_JWT_ACCESS_EXPIRES_SECONDS,
  DEFAULT_JWT_REFRESH_EXPIRES_SECONDS,
  type JwtTokensConfig,
} from '../helpers';

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

<<<<<<< Updated upstream
/**
 * Access-token secret from env. Throws instead of falling back to a built-in constant: a public
 * fallback would let anyone mint a valid ADMIN token when the env var is missing.
 */
=======
/** Resolve the access-token secret; throws when none is configured (no insecure fallback). */
>>>>>>> Stashed changes
export function resolveJwtAccessSecret(configService: ConfigService): string {
  const secret =
    configService.get<string>('JWT_ACCESS_SECRET') || configService.get<string>('JWT_SECRET');
  if (!secret) {
<<<<<<< Updated upstream
    throw new Error('JWT_ACCESS_SECRET (or JWT_SECRET) must be set');
=======
    throw new Error('Missing JWT secret: set JWT_ACCESS_SECRET (or JWT_SECRET) in the environment');
>>>>>>> Stashed changes
  }
  return secret;
}

export function getJwtTokensConfig(configService: ConfigService): JwtTokensConfig {
  const accessSecret = resolveJwtAccessSecret(configService);
  const refreshSecret = configService.get<string>('JWT_REFRESH_SECRET') ?? accessSecret;

  const accessExpiresIn = parsePositiveInt(
    configService.get<string>('JWT_ACCESS_EXPIRES_SECONDS'),
    DEFAULT_JWT_ACCESS_EXPIRES_SECONDS,
  );
  const refreshExpiresIn = parsePositiveInt(
    configService.get<string>('JWT_REFRESH_EXPIRES_SECONDS'),
    DEFAULT_JWT_REFRESH_EXPIRES_SECONDS,
  );

  return {
    accessSecret,
    accessExpiresIn,
    refreshSecret,
    refreshExpiresIn,
  };
}

/** Default Nest `JwtModule` — used as defaults; access/refresh still pass explicit options when signing. */
export function getJwtModuleOptionsFromConfig(configService: ConfigService) {
  const { accessSecret, accessExpiresIn } = getJwtTokensConfig(configService);
  return {
    secret: accessSecret,
    signOptions: { expiresIn: accessExpiresIn },
  };
}
