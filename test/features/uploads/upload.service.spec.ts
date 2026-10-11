import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { UploadService } from 'src/features/uploads/upload.service';
import type { MulterFile } from 'src/features/uploads/upload.interface';

const makeConfig = (values: Record<string, string | undefined>) =>
  ({
    get: jest.fn((key: string, fallback?: string) => values[key] ?? fallback),
  }) as unknown as ConfigService;

const makeS3 = () => {
  const send = jest.fn().mockResolvedValue({});
  return { s3: { send } as unknown as S3Client, send };
};

const pngBuffer = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#336699' } }).png().toBuffer();

const file = (overrides: Partial<MulterFile>): MulterFile => ({
  fieldname: 'file',
  originalname: 'a.txt',
  encoding: '7bit',
  mimetype: 'text/plain',
  size: 3,
  buffer: Buffer.from('abc'),
  ...overrides,
});

// uuid@14 is ESM-only and jest's CJS transform can't load it; the key format is what matters here.
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

const PUBLIC_URL = 'https://cdn.tutor.dev';

describe('UploadService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const config = makeConfig({ CLOUDFLARE_R2_BUCKET: 'tutor-bucket', CLOUDFLARE_R2_PUBLIC_URL: PUBLIC_URL });

  describe('onModuleInit (R2 healthcheck)', () => {
    it('writes then deletes a probe object when R2 is reachable', async () => {
      const { s3, send } = makeS3();
      await new UploadService(s3, config).onModuleInit();

      expect(send).toHaveBeenCalledTimes(2);
      const [put, del] = send.mock.calls.map((c) => c[0]);
      expect(put).toBeInstanceOf(PutObjectCommand);
      expect(del).toBeInstanceOf(DeleteObjectCommand);
      expect(put.input.Bucket).toBe('tutor-bucket');
      expect(put.input.Key).toMatch(/^healthcheck-\d+\.tmp$/);
      expect(del.input.Key).toBe(put.input.Key);
    });

    it('logs and does not throw when R2 is not configured (null client)', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn');
      await expect(new UploadService(null, config).onModuleInit()).resolves.toBeUndefined();
      expect(String(warn.mock.calls[0][0])).toContain('not configured');
    });

    it('logs an access-denied hint on HTTP 403 and does not throw', async () => {
      const { s3, send } = makeS3();
      send.mockRejectedValue(Object.assign(new Error('denied'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }));
      const error = jest.spyOn(Logger.prototype, 'error');

      await expect(new UploadService(s3, config).onModuleInit()).resolves.toBeUndefined();
      expect(String(error.mock.calls[0][0])).toContain('Access Denied');
    });

    it('logs the error name and status for other failures without throwing', async () => {
      const { s3, send } = makeS3();
      send.mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError', $metadata: { httpStatusCode: 500 } }));
      const error = jest.spyOn(Logger.prototype, 'error');

      await expect(new UploadService(s3, config).onModuleInit()).resolves.toBeUndefined();
      expect(String(error.mock.calls[0][0])).toContain('TimeoutError');
      expect(String(error.mock.calls[0][0])).toContain('status=500');
    });
  });

  describe('upload', () => {
    it('re-encodes images to JPEG, bounds them to 1920px, and stores them as image/jpeg', async () => {
      const { s3, send } = makeS3();
      const service = new UploadService(s3, config);
      const original = await pngBuffer(3000, 1000);

      const result = await service.upload(file({ originalname: 'photo.png', mimetype: 'image/png', buffer: original }), 'avatars');

      const put = send.mock.calls[0][0];
      expect(put.input.Key).toMatch(/^avatars\/test-uuid\.jpg$/);
      expect(put.input.ContentType).toBe('image/jpeg');
      const meta = await sharp(put.input.Body).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.width).toBe(1920);
      expect(result).toEqual({
        url: `${PUBLIC_URL}/${put.input.Key}`,
        key: put.input.Key,
        size: put.input.Body.length,
        mimetype: 'image/jpeg',
      });
    });

    it('does not enlarge images smaller than the bound', async () => {
      const { s3, send } = makeS3();
      const small = await pngBuffer(200, 100);

      await new UploadService(s3, config).upload(file({ originalname: 'x.png', mimetype: 'image/png', buffer: small }));

      const meta = await sharp(send.mock.calls[0][0].input.Body).metadata();
      expect(meta.width).toBe(200);
      expect(meta.height).toBe(100);
    });

    it('stores non-image files byte-for-byte with their original extension and mimetype', async () => {
      const { s3, send } = makeS3();
      const buffer = Buffer.from('%PDF-1.4 hello');

      const result = await new UploadService(s3, config).upload(
        file({ originalname: 'report.final.pdf', mimetype: 'application/pdf', buffer }),
      );

      const put = send.mock.calls[0][0];
      expect(put.input.Key).toMatch(/^uploads\/test-uuid\.pdf$/);
      expect(put.input.Body).toBe(buffer);
      expect(put.input.ContentType).toBe('application/pdf');
      expect(result.mimetype).toBe('application/pdf');
      expect(result.size).toBe(buffer.length);
    });

    it('falls back to the .bin extension when the original name has none', async () => {
      const { s3, send } = makeS3();

      await new UploadService(s3, config).upload(file({ originalname: 'README', mimetype: 'application/octet-stream' }));

      expect(send.mock.calls[0][0].input.Key).toMatch(/\.bin$/);
    });

    it('rejects when no S3 client is configured', async () => {
      await expect(new UploadService(null, config).upload(file({}))).rejects.toThrow('Cloudflare R2 not configured');
    });

    it('propagates S3 write failures to the caller', async () => {
      const { s3, send } = makeS3();
      send.mockRejectedValue(new Error('SlowDown'));

      await expect(new UploadService(s3, config).upload(file({}))).rejects.toThrow('SlowDown');
    });
  });

  describe('uploadMultiple', () => {
    it('uploads every file and returns one result per file in order', async () => {
      const { s3, send } = makeS3();
      const service = new UploadService(s3, config);

      const results = await service.uploadMultiple(
        [file({ originalname: 'a.txt' }), file({ originalname: 'b.txt' })],
        'docs',
      );

      expect(results).toHaveLength(2);
      expect(results.map((r) => r.key.split('/')[0])).toEqual(['docs', 'docs']);
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('rejects as a whole if any single upload fails', async () => {
      const { s3, send } = makeS3();
      send.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('partial failure'));

      await expect(
        new UploadService(s3, config).uploadMultiple([file({}), file({})]),
      ).rejects.toThrow('partial failure');
    });
  });

  describe('getPublicUrl', () => {
    it('joins the configured public base and the object key', () => {
      expect(new UploadService(null, config).getPublicUrl('uploads/x.jpg')).toBe(`${PUBLIC_URL}/uploads/x.jpg`);
    });
  });

  describe('download', () => {
    it('returns the object stream with its content type and length', async () => {
      const { s3, send } = makeS3();
      const body = { pipe: jest.fn() };
      send.mockResolvedValue({ Body: body, ContentType: 'image/jpeg', ContentLength: 42 });

      const result = await new UploadService(s3, config).download('uploads/x.jpg');

      expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
      expect(send.mock.calls[0][0].input).toEqual({ Bucket: 'tutor-bucket', Key: 'uploads/x.jpg' });
      expect(result).toEqual({ stream: body, contentType: 'image/jpeg', contentLength: 42 });
    });

    it('defaults the content type to application/octet-stream when R2 omits it', async () => {
      const { s3, send } = makeS3();
      send.mockResolvedValue({ Body: {} });

      const result = await new UploadService(s3, config).download('k');

      expect(result.contentType).toBe('application/octet-stream');
      expect(result.contentLength).toBeUndefined();
    });

    it('propagates NoSuchKey so the HTTP layer can map it to 404', async () => {
      const { s3, send } = makeS3();
      send.mockRejectedValue(Object.assign(new Error('missing'), { name: 'NoSuchKey' }));

      await expect(new UploadService(s3, config).download('gone')).rejects.toMatchObject({ name: 'NoSuchKey' });
    });

    it('rejects when no S3 client is configured', async () => {
      await expect(new UploadService(null, config).download('k')).rejects.toThrow('Cloudflare R2 not configured');
    });
  });

  describe('delete', () => {
    it('issues a DeleteObject for the given key', async () => {
      const { s3, send } = makeS3();

      await new UploadService(s3, config).delete('uploads/x.jpg');

      expect(send.mock.calls[0][0]).toBeInstanceOf(DeleteObjectCommand);
      expect(send.mock.calls[0][0].input).toEqual({ Bucket: 'tutor-bucket', Key: 'uploads/x.jpg' });
    });

    it('rejects when no S3 client is configured', async () => {
      await expect(new UploadService(null, config).delete('k')).rejects.toThrow('Cloudflare R2 not configured');
    });
  });

  it('defaults the bucket to "tutor" when CLOUDFLARE_R2_BUCKET is unset', async () => {
    const { s3, send } = makeS3();

    await new UploadService(s3, makeConfig({})).delete('k');

    expect(send.mock.calls[0][0].input.Bucket).toBe('tutor');
  });
});
