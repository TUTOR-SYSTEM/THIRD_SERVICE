import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Readable } from 'stream';
import { IS_PUBLIC_KEY } from '@packages/decorators/public.decorator';
import { UploadController } from 'src/features/uploads/upload.controller';
import { UploadService } from 'src/features/uploads/upload.service';

type FakeRes = { setHeader: jest.Mock; headers: Record<string, unknown> };

const fakeRes = (): FakeRes => {
  const headers: Record<string, unknown> = {};
  return {
    headers,
    setHeader: jest.fn((name: string, value: unknown) => {
      headers[name] = value;
    }),
  };
};

// uuid@14 is ESM-only; the controller specs never assert on keys.
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

describe('UploadController (HTTP)', () => {
  const service = {
    upload: jest.fn(),
    uploadMultiple: jest.fn(),
    download: jest.fn(),
    delete: jest.fn(),
  };
  const controller = new UploadController(service as unknown as UploadService);

  beforeEach(() => jest.clearAllMocks());

  it('marks every upload route as @Public (called by services without a user JWT)', () => {
    const reflector = new Reflector();
    for (const handler of [
      UploadController.prototype.upload,
      UploadController.prototype.uploadMultiple,
      UploadController.prototype.download,
      UploadController.prototype.delete,
    ]) {
      expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBe(true);
    }
  });

  it('upload delegates the multer file to the service', async () => {
    const file = { originalname: 'a.png', mimetype: 'image/png', buffer: Buffer.from('x'), size: 1, fieldname: 'file', encoding: '7bit' };
    service.upload.mockResolvedValue({ key: 'k' });

    await expect(controller.upload(file)).resolves.toEqual({ key: 'k' });
    expect(service.upload).toHaveBeenCalledWith(file);
  });

  it('uploadMultiple delegates the file list to the service', async () => {
    service.uploadMultiple.mockResolvedValue([{ key: 'a' }]);

    await expect(controller.uploadMultiple([{ originalname: 'a' } as never])).resolves.toEqual([{ key: 'a' }]);
  });

  it('download rejects a missing key with 400 before touching R2', async () => {
    await expect(controller.download('', fakeRes() as never)).rejects.toThrow(BadRequestException);
    expect(service.download).not.toHaveBeenCalled();
  });

  it('download streams the object with Content-Type, Content-Disposition and Content-Length', async () => {
    const stream = Object.assign(Readable.from([]), { pipe: jest.fn() });
    service.download.mockResolvedValue({ stream, contentType: 'image/jpeg', contentLength: 9 });
    const res = fakeRes();

    await controller.download('uploads/photo.jpg', res as never);

    expect(res.headers).toEqual({
      'Content-Type': 'image/jpeg',
      'Content-Disposition': 'attachment; filename="photo.jpg"',
      'Content-Length': 9,
    });
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it('download omits Content-Length when R2 does not report it', async () => {
    const stream = Object.assign(Readable.from([]), { pipe: jest.fn() });
    service.download.mockResolvedValue({ stream, contentType: 'application/pdf' });
    const res = fakeRes();

    await controller.download('k.pdf', res as never);

    expect(res.headers).not.toHaveProperty('Content-Length');
  });

  it.each(['NoSuchKey', 'NotFound'])('maps R2 %s to a 404 NotFoundException', async (name) => {
    service.download.mockRejectedValue(Object.assign(new Error('x'), { name }));

    await expect(controller.download('uploads/missing.jpg', fakeRes() as never)).rejects.toThrow(NotFoundException);
  });

  it('re-throws unexpected download errors unchanged', async () => {
    service.download.mockRejectedValue(new Error('network down'));

    await expect(controller.download('k', fakeRes() as never)).rejects.toThrow('network down');
  });

  it('delete forwards the path param to the service', async () => {
    service.delete.mockResolvedValue(undefined);

    await controller.delete('uploads%2Fx.jpg');

    expect(service.delete).toHaveBeenCalledWith('uploads%2Fx.jpg');
  });
});
