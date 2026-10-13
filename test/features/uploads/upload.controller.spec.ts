import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
<<<<<<< Updated upstream
import { Readable, Writable } from 'stream';
=======
import { PassThrough, Readable } from 'stream';
>>>>>>> Stashed changes
import { IS_PUBLIC_KEY } from '@packages/decorators/public.decorator';
import { UploadController } from 'src/features/uploads/upload.controller';
import { UploadService } from 'src/features/uploads/upload.service';

type FakeRes = Writable & { setHeader: jest.Mock; headers: Record<string, unknown> };

// A real Writable, because the controller now uses `stream.pipeline` (which needs a stream).
const fakeRes = (): FakeRes => {
  const headers: Record<string, unknown> = {};
  const res = new Writable({ write: (_chunk, _enc, cb) => cb() }) as FakeRes;
  res.headers = headers;
  res.setHeader = jest.fn((name: string, value: unknown) => {
    headers[name] = value;
  });
  return res;
};

const realRes = () => {
  const res: any = new PassThrough();
  res.headers = {} as Record<string, unknown>;
  res.setHeader = jest.fn((n: string, v: unknown) => {
    res.headers[n] = v;
  });
  res.resume();
  return res;
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

<<<<<<< Updated upstream
  it('requires a JWT on every upload route (none is @Public; the gateway reaches us over RMQ)', () => {
=======
  it('no upload route is @Public (JWT required)', () => {
>>>>>>> Stashed changes
    const reflector = new Reflector();
    for (const handler of [
      UploadController.prototype.upload,
      UploadController.prototype.uploadMultiple,
      UploadController.prototype.download,
      UploadController.prototype.delete,
    ]) {
<<<<<<< Updated upstream
      expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBeUndefined();
=======
      expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBeFalsy();
>>>>>>> Stashed changes
    }
  });

  it('upload delegates the multer file to the service', async () => {
    const file = {
      originalname: 'a.png',
      mimetype: 'image/png',
      buffer: Buffer.from('x'),
      size: 1,
      fieldname: 'file',
      encoding: '7bit',
    };
    service.upload.mockResolvedValue({ key: 'k' });

    await expect(controller.upload(file)).resolves.toEqual({ key: 'k' });
    expect(service.upload).toHaveBeenCalledWith(file);
  });

  it('uploadMultiple delegates the file list to the service', async () => {
    service.uploadMultiple.mockResolvedValue([{ key: 'a' }]);

    await expect(controller.uploadMultiple([{ originalname: 'a' } as never])).resolves.toEqual([
      { key: 'a' },
    ]);
  });

  it('download rejects a missing key with 400 before touching R2', async () => {
    await expect(controller.download('', fakeRes() as never)).rejects.toThrow(BadRequestException);
    expect(service.download).not.toHaveBeenCalled();
  });

  it('download streams the object with Content-Type, Content-Disposition and Content-Length', async () => {
<<<<<<< Updated upstream
    service.download.mockResolvedValue({
      stream: Readable.from([Buffer.from('data')]),
      contentType: 'image/jpeg',
      contentLength: 9,
    });
    const res = fakeRes();
    const finished = new Promise((resolve) => res.on('finish', resolve));

    await controller.download('uploads/photo.jpg', res as never);
    await finished;
=======
    const stream = Readable.from([Buffer.from('imgdata9')]);
    service.download.mockResolvedValue({ stream, contentType: 'image/jpeg', contentLength: 9 });
    const res = realRes();

    await controller.download('uploads/photo.jpg', res as never);
    await new Promise((r) => setTimeout(r, 10));
>>>>>>> Stashed changes

    expect(res.headers).toEqual({
      'Content-Type': 'image/jpeg',
      'Content-Disposition': 'attachment; filename="photo.jpg"',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': 9,
    });
<<<<<<< Updated upstream
  });

  it('download sanitises the filename used in Content-Disposition', async () => {
    service.download.mockResolvedValue({ stream: Readable.from([]), contentType: 'text/plain' });
    const res = fakeRes();

    await controller.download('uploads/we"ird\r\nname.txt', res as never);

    expect(res.headers['Content-Disposition']).toBe('attachment; filename="we_ird__name.txt"');
  });

  it('download omits Content-Length when R2 does not report it', async () => {
    const stream = Readable.from([]);
=======
  });

  it('download omits Content-Length when R2 does not report it', async () => {
    const stream = Readable.from([Buffer.from('x')]);
>>>>>>> Stashed changes
    service.download.mockResolvedValue({ stream, contentType: 'application/pdf' });
    const res = realRes();

    await controller.download('uploads/k.pdf', res as never);
    await new Promise((r) => setTimeout(r, 10));

    expect(res.headers).not.toHaveProperty('Content-Length');
  });

  it.each(['NoSuchKey', 'NotFound'])('maps R2 %s to a 404 NotFoundException', async (name) => {
    service.download.mockRejectedValue(Object.assign(new Error('x'), { name }));

    await expect(controller.download('uploads/missing.jpg', fakeRes() as never)).rejects.toThrow(
      NotFoundException,
    );
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
