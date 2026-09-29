import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '@tutor/gateway/schema';
import { validateRequiredEnvs } from '@packages/helpers';

// esModuleInterop wraps the schema in a null-prototype `default` namespace that drizzle's is() chokes on.
const { default: _default, ...tables } = schema as Record<string, unknown>;

export const DRIZZLE = 'DRIZZLE';
export const DATABASE_ENVS = [
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
] as const;
@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const logger = new Logger(DatabaseModule.name);

        // Nếu không dùng DATABASE_URL thì validate từng biến
        const databaseUrl = configService.get<string>('DATABASE_URL')?.trim();

        if (!databaseUrl) {
          validateRequiredEnvs(configService, DATABASE_ENVS);
        }

        const connectionString =
          databaseUrl ||
          (() => {
            const url = new URL(
              `postgres://${configService.getOrThrow(
                'POSTGRES_HOST',
              )}:${configService.getOrThrow(
                'POSTGRES_PORT',
              )}/${configService.getOrThrow('POSTGRES_DB')}`,
            );

            url.username = configService.getOrThrow('POSTGRES_USER');
            url.password = configService.getOrThrow('POSTGRES_PASSWORD');

            return url.toString();
          })();

        const client = postgres(connectionString);

        const MAX_RETRIES = 3;
        const RETRY_DELAY_MS = 2000;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
          try {
            logger.log('this connection:', databaseUrl);
            await client`SELECT 1`;
            logger.log('✅ PostgreSQL connected.');
            return drizzle(client, { schema: tables });
          } catch (error) {
            logger.warn(
              `PostgreSQL connection attempt ${attempt}/${MAX_RETRIES} failed: ${
                (error as Error).message
              }`,
            );

            if (attempt === MAX_RETRIES) {
              logger.error('❌ PostgreSQL connect failed.');
              throw new Error('PostgreSQL connect failed');
            }

            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          }
        }
      },
    },
  ],
  exports: [DRIZZLE],
})
export class DatabaseModule {}