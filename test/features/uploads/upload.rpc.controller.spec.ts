import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import { UploadRpcController } from 'src/features/uploads/upload.rpc.controller';
import { UploadService } from 'src/features/uploads/upload.service';

// uuid@14 is ESM-only; the controller specs never assert on keys.
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

const TUTOR = { userId: 'tutor-1', role: 'TUTOR' };

describe('UploadRpcController', () => {
  const service = {
    upload: jest.fn(),
    uploadMultiple: jest.fn(),
    presignDownload: jest.fn(),
    delete: jest.fn(),
    // Pure role check (uses no instance state), so the real implementation is safe to reuse.
    assertUploaderRole: UploadService.prototype.assertUploaderRole,
    consumeUploadQuota: jest.fn().mockResolvedValue(undefined),
  };
  const controller = new UploadRpcController(service as unknown as UploadService);

  const rpcFile = (name: string, bytes: number[]) => ({
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: 'text/plain',
    size: bytes.length,
    buffer: { type: 'Buffer' as const, data: bytes },
  });

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['upload.upload', 'upload'],
    ['upload.uploadMultiple', 'uploadMultiple'],
    ['upload.download', 'download'],
    ['upload.delete', 'del'],
  ])('binds %s to the %s handler', (pattern, method) => {
    expect(
      Reflect.getMetadata(
        PATTERN_METADATA,
        UploadRpcController.prototype[method as keyof UploadRpcController],
      ),
    ).toEqual([pattern]);
  });

  it('rebuilds a real Buffer from the JSON-serialized RMQ payload and records the uploader', async () => {
    service.upload.mockResolvedValue({ key: 'k', url: 'u', size: 3, mimetype: 'text/plain' });

    await controller.upload({ file: rpcFile('a.txt', [97, 98, 99]), ...TUTOR });

    const [file, folder, owner] = service.upload.mock.calls[0];
    expect(Buffer.isBuffer(file.buffer)).toBe(true);
    expect(file.buffer.toString()).toBe('abc');
    expect(file.originalname).toBe('a.txt');
    expect(folder).toBe('uploads');
    expect(owner).toBe('tutor-1');
  });

  it('uploadMultiple converts every file, passes the owner and returns the results', async () => {
    service.uploadMultiple.mockResolvedValue([{ key: 'a' }, { key: 'b' }]);

    const result = await controller.uploadMultiple({
      files: [rpcFile('a.txt', [1]), rpcFile('b.txt', [2])],
      ...TUTOR,
    });

    expect(result).toEqual([{ key: 'a' }, { key: 'b' }]);
    const [passed, , owner] = service.uploadMultiple.mock.calls[0];
    expect(passed.every((f: { buffer: unknown }) => Buffer.isBuffer(f.buffer))).toBe(true);
    expect(owner).toBe('tutor-1');
  });

  it('uploadMultiple rejects more than MAX_UPLOAD_FILES (5) files', async () => {
    const files = Array.from({ length: 6 }, (_, i) => rpcFile(`f${i}.txt`, [1]));

    await expect(controller.uploadMultiple({ files, ...TUTOR })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.uploadMultiple).not.toHaveBeenCalled();
  });

  it.each([
    ['STUDENT', 'upload'],
    ['PARENT', 'upload'],
    [undefined, 'upload'],
  ])('upload refuses role %s (contract C5: only ADMIN/TUTOR upload)', async (role) => {
    await expect(
      controller.upload({ file: rpcFile('a.txt', [1]), userId: 'u', role: role as string }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('refuses a call without a userId (fail closed)', async () => {
    await expect(
      controller.upload({ file: rpcFile('a.txt', [1]), role: 'ADMIN' } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('download delegates to presignDownload with the caller identity and replies the presigned payload', async () => {
    const presigned = {
      url: 'https://r2.example/signed',
      expiresIn: 300,
      contentType: 'text/plain',
      filename: 'notes.txt',
    };
    service.presignDownload.mockResolvedValue(presigned);

    await expect(controller.download({ key: 'uploads/2024/notes.txt', ...TUTOR })).resolves.toEqual(
      presigned,
    );
    expect(service.presignDownload).toHaveBeenCalledWith('uploads/2024/notes.txt', TUTOR);
  });

  it('download propagates the service refusal (not owner) without a reply body', async () => {
    service.presignDownload.mockRejectedValue(new ForbiddenException('PERMISSION_DENIED'));

    await expect(controller.download({ key: 'uploads/x.pdf', ...TUTOR })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('delete forwards the key for an ADMIN and replies { ok, key } (never an empty reply)', async () => {
    service.delete.mockResolvedValue(undefined);

    await expect(controller.del({ key: 'uploads/x.jpg', role: 'ADMIN' })).resolves.toEqual({
      ok: true,
      key: 'uploads/x.jpg',
    });

    expect(service.delete).toHaveBeenCalledWith('uploads/x.jpg');
  });

  it('delete rejects a non-ADMIN or missing role without touching R2 (TRD3-05)', async () => {
    await expect(controller.del({ key: 'uploads/x.jpg', role: 'STUDENT' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(controller.del({ key: 'uploads/x.jpg' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(service.delete).not.toHaveBeenCalled();
  });
});
