import { ConfigService } from '@nestjs/config';

export function validateRequiredEnvs(
  configService: ConfigService,
  requiredEnvs: readonly string[],
): true {
  const missingEnvs = requiredEnvs.filter((key) => {
    const value = configService.get<string>(key);
    return !value || value.trim().length === 0;
  });

  if (missingEnvs.length > 0) {
    throw new Error(
      ['Missing required environment variables:', ...missingEnvs.map((env) => `- ${env}`)].join(
        '\n',
      ),
    );
  }

  return true;
}
