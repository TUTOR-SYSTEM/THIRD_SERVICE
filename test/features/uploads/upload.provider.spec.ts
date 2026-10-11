import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { S3ClientProvider } from 'src/features/uploads/upload.provider';
import { S3_CLIENT } from 'src/features/uploads/upload.constant';

const makeConfig = (values: Record<string, string | undefined>) =>
  ({
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  }) as unknown as ConfigService;

const full = {
  CLOUDFLARE_R2_ENDPOINT: 'https://acc.r2.cloudflarestorage.com',
  CLOUDFLARE_R2_ACCESS_KEY_ID: 'ak',
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'sk',
};

describe('S3ClientProvider', () => {
  it('is registered under the S3_CLIENT token and injects ConfigService', () => {
    expect(S3ClientProvider).toMatchObject({ provide: S3_CLIENT, inject: [ConfigService] });
  });

  it('builds an S3Client against the R2 endpoint with path-style addressing and region "auto"', async () => {
    const factory = (S3ClientProvider as { useFactory: (c: ConfigService) => S3Client }).useFactory;

    const client = factory(makeConfig(full));

    expect(client).toBeInstanceOf(S3Client);
    await expect(client.config.region()).resolves.toBe('auto');
    expect(client.config.forcePathStyle).toBe(true);
  });

  it.each(Object.keys(full))('throws BadGatewayException when %s is missing', (missing) => {
    const factory = (S3ClientProvider as { useFactory: (c: ConfigService) => S3Client }).useFactory;
    const values = { ...full, [missing]: undefined };

    expect(() => factory(makeConfig(values))).toThrow(BadGatewayException);
  });
});
