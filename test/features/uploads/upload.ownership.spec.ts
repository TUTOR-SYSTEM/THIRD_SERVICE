import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { UploadService } from 'src/features/uploads/upload.service';
import { RedisService } from 'src/features/redis/redis.service';

jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://r2.example/signed?X=1'),
}));

const KEY = 'uploads/test-uuid.pdf';
const config = {
  get: (key: string, fallback?: string) =>
    key === 'CLOUDFLARE_R2_PUBLIC_URL' ? 'https://cdn.example' : (fallback ?? undefined),
} as unknown as ConfigService;
const tutor = { userId: 'tutor-1', role: 'TUTOR' };
const admin = { userId: 'admin-1', role: 'ADMIN' };
const student = { userId: 'stu-1', role: 'STUDENT' };

describe('UploadService ownership, presign and quota', () => {
  let s3: { send: jest.Mock };
  let redis: { client: { incrby: jest.Mock; expire: jest.Mock } };

  beforeEach(() => {
    jest.clearAllMocks();
    s3 = { send: jest.fn() };
    redis = { client: { incrby: jest.fn(), expire: jest.fn() } };
  });

  const service = (withRedis = true) =>
    new UploadService(
      s3 as never,
      config,
      withRedis ? (redis as unknown as RedisService) : undefined,
    );

  describe('upload owner metadata', () => {
    it('stores the uploader id as object metadata', async () => {
      s3.send.mockResolvedValue({});
      await service().upload(
        {
          originalname: 'a.pdf',
          mimetype: 'application/pdf',
          buffer: Buffer.from('abc'),
          size: 3,
        } as never,
        'uploads',
        'tutor-1',
      );
      const put = s3.send.mock.calls[0][0] as PutObjectCommand;
      expect(put.input.Metadata).toEqual({ 'owner-id': 'tutor-1' });
    });
  });

  describe('assertDownloadable', () => {
    it('lets the owner through and returns the stored content type', async () => {
      s3.send.mockResolvedValue({
        ContentType: 'application/pdf',
        ContentLength: 3,
        Metadata: { 'owner-id': 'tutor-1' },
      });
      await expect(service().assertDownloadable(KEY, tutor)).resolves.toMatchObject({
        contentType: 'application/pdf',
        filename: 'test-uuid.pdf',
      });
      expect(s3.send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
    });

    it('lets ADMIN read any object', async () => {
      s3.send.mockResolvedValue({ Metadata: { 'owner-id': 'tutor-1' } });
      await expect(service().assertDownloadable(KEY, admin)).resolves.toBeDefined();
    });

    it('refuses a non-owner', async () => {
      s3.send.mockResolvedValue({ Metadata: { 'owner-id': 'tutor-1' } });
      await expect(service().assertDownloadable(KEY, student)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses a non-admin for legacy objects without owner metadata (fail closed)', async () => {
      s3.send.mockResolvedValue({ Metadata: {} });
      await expect(service().assertDownloadable(KEY, tutor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('maps a missing object to 404', async () => {
      s3.send.mockRejectedValue(Object.assign(new Error('nf'), { name: 'NotFound' }));
      await expect(service().assertDownloadable(KEY, admin)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects a key outside uploads/ before calling R2', async () => {
      await expect(service().assertDownloadable('../etc/passwd', admin)).rejects.toThrow(
        'Invalid file key',
      );
      expect(s3.send).not.toHaveBeenCalled();
    });
  });

  describe('presignDownload', () => {
    it('returns a presigned URL only after the ownership check passes', async () => {
      s3.send.mockResolvedValue({
        ContentType: 'application/pdf',
        Metadata: { 'owner-id': 'tutor-1' },
      });

      const out = await service().presignDownload(KEY, tutor);

      expect(out).toEqual({
        url: 'https://r2.example/signed?X=1',
        expiresIn: 300,
        contentType: 'application/pdf',
        filename: 'test-uuid.pdf',
      });
      expect(getSignedUrl).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
        expiresIn: 300,
      });
    });

    it('never signs a URL for a non-owner', async () => {
      s3.send.mockResolvedValue({ Metadata: { 'owner-id': 'tutor-1' } });

      await expect(service().presignDownload(KEY, student)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(getSignedUrl).not.toHaveBeenCalled();
    });
  });

  describe('assertUploaderRole', () => {
    it.each(['ADMIN', 'TUTOR'])('allows %s', (role) => {
      expect(() => service().assertUploaderRole(role)).not.toThrow();
    });

    it.each(['STUDENT', 'PARENT', '', undefined])('refuses %p', (role) => {
      expect(() => service().assertUploaderRole(role as string)).toThrow(ForbiddenException);
    });
  });

  describe('consumeUploadQuota', () => {
    it('counts files in a per-minute window and sets the expiry on the first write', async () => {
      redis.client.incrby.mockResolvedValue(3);
      redis.client.expire.mockResolvedValue(1);

      await service().consumeUploadQuota('tutor-1', 3);

      expect(redis.client.incrby.mock.calls[0][0]).toMatch(/^upload-rate:tutor-1:\d+$/);
      expect(redis.client.incrby).toHaveBeenCalledWith(expect.any(String), 3);
      expect(redis.client.expire).toHaveBeenCalledWith(expect.any(String), 120);
    });

    it('throws 429 once the user exceeds the per-minute quota', async () => {
      redis.client.incrby.mockResolvedValue(31);

      await expect(service().consumeUploadQuota('tutor-1', 1)).rejects.toMatchObject({
        status: 429,
      });
      await expect(service().consumeUploadQuota('tutor-1', 1)).rejects.toBeInstanceOf(
        HttpException,
      );
    });

    it('fails open when Redis errors', async () => {
      redis.client.incrby.mockRejectedValue(new Error('down'));
      await expect(service().consumeUploadQuota('tutor-1', 1)).resolves.toBeUndefined();
    });

    it('is a no-op when Redis is not wired', async () => {
      await expect(service(false).consumeUploadQuota('tutor-1', 1)).resolves.toBeUndefined();
      expect(redis.client.incrby).not.toHaveBeenCalled();
    });
  });
});
