import { BadRequestException } from '@nestjs/common';
import { LogRpcController } from 'src/features/log/log.rpc.controller';
import { RedisRpcController } from 'src/features/redis/redis.rpc.controller';
import { UploadRpcController } from 'src/features/uploads/upload.rpc.controller';
import { UploadService } from 'src/features/uploads/upload.service';

// uuid@14 is ESM-only and jest's CJS transform can't load it.
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

describe('security hardening (review round)', () => {
  describe('log.create RPC validation', () => {
    it('drops an invalid payload without persisting it', () => {
      const logService = { createInternal: jest.fn() };
      const controller = new LogRpcController(logService as never);

      controller.create({ serviceName: 'x' });

      expect(logService.createInternal).not.toHaveBeenCalled();
    });

    it('persists a valid payload', () => {
      const logService = { createInternal: jest.fn().mockResolvedValue(undefined) };
      const controller = new LogRpcController(logService as never);
      const dto = {
        serviceName: 'gateway',
        type: 'HTTP',
        path: '/x',
        durationMs: 3,
        correlationId: 'c1',
        traceId: 't1',
      };

      controller.create(dto);

      expect(logService.createInternal).toHaveBeenCalledWith(expect.objectContaining(dto));
    });
  });

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
