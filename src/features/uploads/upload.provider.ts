import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import { S3_CLIENT } from './upload.constant';

const logger = new Logger('S3ClientProvider');

/** Returns `null` (and warns) when R2 is not configured so the rest of the service can still boot. */
export const S3ClientProvider: Provider = {
  provide: S3_CLIENT,
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => {
    const endpoint = configService.get<string>('CLOUDFLARE_R2_ENDPOINT');
    const accessKeyId = configService.get<string>('CLOUDFLARE_R2_ACCESS_KEY_ID');
    const secretAccessKey = configService.get<string>('CLOUDFLARE_R2_SECRET_ACCESS_KEY');
    const region = configService.get<string>('CLOUDFLARE_R2_REGION') ?? 'auto';

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      logger.warn(
        'Cloudflare R2 not configured (CLOUDFLARE_R2_ENDPOINT / _ACCESS_KEY_ID / _SECRET_ACCESS_KEY) — uploads disabled',
      );
      return null;
    }

    return new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
      requestHandler: { requestTimeout: 30_000 },
    });
  },
};
