import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, HeadObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { UploadService } from 'src/features/uploads/upload.service';

// uuid@14 is ESM-only and jest's CJS transform can't load it.
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

const config = {
  get: jest.fn((key: string, fallback?: string) =>
    key === 'CLOUDFLARE_R2_BUCKET' ? 'tutor-bucket' : fallback,
  ),
} as unknown as ConfigService;

/** Fake S3: HeadObject answers with the given owner metadata (or a not-found error). */
const makeS3 = (head: { owner?: string } | 'missing') => {
  const send = jest.fn(async (cmd: unknown) => {
    if (cmd instanceof HeadObjectCommand) {
      if (head === 'missing') {
        const err = new Error('NotFound') as Error & { name: string };
        err.name = 'NotFound';
        throw err;
      }
      return { Metadata: head.owner ? { 'owner-id': head.owner } : {} };
    }
    return {};
  });
  return { s3: { send } as unknown as S3Client, send };
};

const sentDelete = (send: jest.Mock) =>
  send.mock.calls.some(([cmd]) => cmd instanceof DeleteObjectCommand);

describe('UploadService.deleteOwned (ownership check for HTTP delete)', () => {
  it('lets the uploader delete their own object', async () => {
    const { s3, send } = makeS3({ owner: 'user-1' });

    await new UploadService(s3, config).deleteOwned('uploads/a.jpg', {
      userId: 'user-1',
      role: 'TUTOR',
    });

    expect(sentDelete(send)).toBe(true);
  });

  it('lets ADMIN delete any object', async () => {
    const { s3, send } = makeS3({ owner: 'someone-else' });

    await new UploadService(s3, config).deleteOwned('uploads/a.jpg', {
      userId: 'admin-1',
      role: 'ADMIN',
    });

    expect(sentDelete(send)).toBe(true);
  });

  it('rejects a non-owner with 403 and never sends DeleteObject', async () => {
    const { s3, send } = makeS3({ owner: 'user-2' });

    await expect(
      new UploadService(s3, config).deleteOwned('uploads/a.jpg', {
        userId: 'user-1',
        role: 'TUTOR',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sentDelete(send)).toBe(false);
  });

  it('rejects a non-admin when the object has no owner metadata', async () => {
    const { s3, send } = makeS3({});

    await expect(
      new UploadService(s3, config).deleteOwned('uploads/a.jpg', {
        userId: 'user-1',
        role: 'STUDENT',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sentDelete(send)).toBe(false);
  });

  it('does not let the gateway authorized flag bypass delete ownership', async () => {
    const { s3, send } = makeS3({ owner: 'user-2' });

    await expect(
      new UploadService(s3, config).deleteOwned('uploads/a.jpg', {
        userId: 'user-1',
        role: 'TUTOR',
        authorized: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sentDelete(send)).toBe(false);
  });

  it('returns 404 for a missing object', async () => {
    const { s3, send } = makeS3('missing');

    await expect(
      new UploadService(s3, config).deleteOwned('uploads/a.jpg', {
        userId: 'admin-1',
        role: 'ADMIN',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(sentDelete(send)).toBe(false);
  });

  it('rejects an invalid key with 400 before touching S3', async () => {
    const { s3, send } = makeS3({ owner: 'user-1' });

    await expect(
      new UploadService(s3, config).deleteOwned('../x', { userId: 'user-1', role: 'TUTOR' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(send).not.toHaveBeenCalled();
  });
});
