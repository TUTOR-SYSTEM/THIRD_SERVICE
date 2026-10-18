import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PassThrough, Readable, Writable } from 'stream';
import { IS_PUBLIC_KEY } from '@packages/decorators/public.decorator';
import { UploadController } from 'src/features/uploads/upload.controller';
import { UploadService } from 'src/features/uploads/upload.service';

type FakeRes = Writable & { setHeader: jest.Mock; headers: Record<string, unknown> };

// A real Writable, because the controller uses `stream.pipeline` (which needs a stream).
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

const TUTOR = { id: 'tutor-1', role: 'TUTOR', email: 't@x.y', typ: 'access', sid: 's' } as never;
const STUDENT = { id: 'stu-1', role: 'STUDENT', email: 's@x.y', typ: 'access', sid: 's' } as never;
const PARENT = { id: 'par-1', role: 'PARENT', email: 'p@x.y', typ: 'access', sid: 's' } as never;

describe('UploadController (HTTP)', () => {
  const service = {
    assertUploaderRole: UploadService.prototype.assertUploaderRole,
    consumeUploadQuota: jest.fn().mockResolvedValue(undefined),
    upload: jest.fn(),
    uploadMultiple: jest.fn(),
    assertDownloadable: jest.fn().mockResolvedValue({ contentType: 'x', filename: 'x' }),
    download: jest.fn(),
    delete: jest.fn(),
  };
  const controller = new UploadController(service as unknown as UploadService);

  beforeEach(() => jest.clearAllMocks());

  it('requires a JWT on every upload route (none is @Public; the gateway reaches us over RMQ)', () => {
    const reflector = new Reflector();
    for (const handler of [
      UploadController.prototype.upload,
      UploadController.prototype.uploadMultiple,
      UploadController.prototype.download,
      UploadController.prototype.delete,
    ]) {
      expect(reflector.get<boolean>(IS_PUBLIC_KEY, handler)).toBeUndefined();
    }
  });

  it('upload delegates the multer file to the service with the uploader as owner', async () => {
    const file = {
      originalname: 'a.png',
      mimetype: 'image/png',
      buffer: Buffer.from('x'),
      size: 1,
      fieldname: 'file',
      encoding: '7bit',
    };
    service.upload.mockResolvedValue({ key: 'k' });

    await expect(controller.upload(TUTOR, file)).resolves.toEqual({ key: 'k' });
    expect(service.upload).toHaveBeenCalledWith(file, 'uploads', 'tutor-1');
  });

  it('upload refuses a PARENT before any bytes are stored', async () => {
    await expect(controller.upload(PARENT, {} as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('uploadMultiple delegates the file list and charges the quota per file', async () => {
    service.uploadMultiple.mockResolvedValue([{ key: 'a' }]);

    await expect(
      controller.uploadMultiple(TUTOR, [{ originalname: 'a' } as never]),
    ).resolves.toEqual([{ key: 'a' }]);
    expect(service.consumeUploadQuota).toHaveBeenCalledWith('tutor-1', 1);
    expect(service.uploadMultiple).toHaveBeenCalledWith(
      [{ originalname: 'a' }],
      'uploads',
      'tutor-1',
    );
  });

  it('download rejects a missing key with 400 before touching R2', async () => {
    await expect(controller.download(TUTOR, '', fakeRes() as never)).rejects.toThrow(
      BadRequestException,
    );
    expect(service.download).not.toHaveBeenCalled();
  });

  it('download checks ownership first and then streams the object with the expected headers', async () => {
    const stream = Readable.from([Buffer.from('imgdata9')]);
    service.download.mockResolvedValue({ stream, contentType: 'image/jpeg', contentLength: 9 });
    const res = realRes();

    await controller.download(TUTOR, 'uploads/photo.jpg', res as never);
    await new Promise((r) => setTimeout(r, 10));

    expect(service.assertDownloadable).toHaveBeenCalledWith('uploads/photo.jpg', {
      userId: 'tutor-1',
      role: 'TUTOR',
    });
    expect(res.headers).toEqual({
      'Content-Type': 'image/jpeg',
      'Content-Disposition': 'attachment; filename="photo.jpg"',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': 9,
    });
  });

  it('download does not open the object when the caller is not the owner', async () => {
    service.assertDownloadable.mockRejectedValueOnce(new ForbiddenException('PERMISSION_DENIED'));

    await expect(
      controller.download(STUDENT, 'uploads/photo.jpg', fakeRes() as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.download).not.toHaveBeenCalled();
  });

  it('download sanitises the filename used in Content-Disposition', async () => {
    service.download.mockResolvedValue({ stream: Readable.from([]), contentType: 'text/plain' });
    const res = fakeRes();

    await controller.download(TUTOR, 'uploads/we"ird\r\nname.txt', res as never);

    expect(res.headers['Content-Disposition']).toBe('attachment; filename="we_ird__name.txt"');
  });

  it('download omits Content-Length when R2 does not report it', async () => {
    const stream = Readable.from([Buffer.from('x')]);
    service.download.mockResolvedValue({ stream, contentType: 'application/pdf' });
    const res = realRes();

    await controller.download(TUTOR, 'uploads/k.pdf', res as never);
    await new Promise((r) => setTimeout(r, 10));

    expect(res.headers).not.toHaveProperty('Content-Length');
  });

  it.each(['NoSuchKey', 'NotFound'])('maps R2 %s to a 404 NotFoundException', async (name) => {
    service.download.mockRejectedValue(Object.assign(new Error('x'), { name }));

    await expect(
      controller.download(TUTOR, 'uploads/missing.jpg', fakeRes() as never),
    ).rejects.toThrow(NotFoundException);
  });

  it('re-throws unexpected download errors unchanged', async () => {
    service.download.mockRejectedValue(new Error('network down'));

    await expect(controller.download(TUTOR, 'uploads/k', fakeRes() as never)).rejects.toThrow(
      'network down',
    );
  });

  it('delete forwards the path param to the service', async () => {
    service.delete.mockResolvedValue(undefined);

    await controller.delete('uploads%2Fx.jpg');

    expect(service.delete).toHaveBeenCalledWith('uploads%2Fx.jpg');
  });
});
