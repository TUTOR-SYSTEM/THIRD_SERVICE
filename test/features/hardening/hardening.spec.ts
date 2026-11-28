import { BadRequestException } from '@nestjs/common';
import { RedisRpcController } from 'src/features/redis/redis.rpc.controller';
import { UploadRpcController } from 'src/features/uploads/upload.rpc.controller';
import { UploadService } from 'src/features/uploads/upload.service';

// uuid@14 is ESM-only and jest's CJS transform can't load it.
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

describe('security hardening (review round)', () => {
  describe('redis RPC with an empty payload', () => {
    const redis = { get: jest.fn(), exists: jest.fn(), set: jest.fn() };
    const controller = new RedisRpcController(redis as never);
    beforeEach(() => jest.clearAllMocks());

    it('answers 400 (not a TypeError 500) for get/exists/set with no payload', async () => {
      // The real RedisService validates the key; the RPC layer must not crash before that.
      redis.get.mockRejectedValue(new BadRequestException('key is required'));
      redis.exists.mockRejectedValue(new BadRequestException('key is required'));
      redis.set.mockRejectedValue(new BadRequestException('key is required'));

      await expect(controller.get(undefined as never)).rejects.toBeInstanceOf(BadRequestException);
      await expect(controller.exists(undefined as never)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(controller.set(undefined as never)).rejects.toBeInstanceOf(BadRequestException);
      expect(redis.get).toHaveBeenCalledWith(undefined);
    });

    it('requires a TTL for an OTP key (reset-password-otp has no colon)', async () => {
      await expect(
        controller.set({ key: 'reset-password-otp:abc', value: '1' } as never),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('upload RPC base64 size guard', () => {
    it('rejects an oversized base64 string before decoding it', async () => {
      const uploadService = {
        assertUploaderRole: jest.fn(),
        consumeUploadQuota: jest.fn(),
        upload: jest.fn(),
      } as unknown as UploadService;
      const controller = new UploadRpcController(uploadService);
      const huge = 'A'.repeat(14 * 1024 * 1024);

      await expect(
        controller.upload({
          userId: 'u1',
          role: 'TUTOR',
          file: {
            fieldname: 'file',
            originalname: 'a.pdf',
            encoding: '7bit',
            mimetype: 'application/pdf',
            size: 0,
            buffer: huge,
          },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(uploadService.upload).not.toHaveBeenCalled();
    });
  });
});
