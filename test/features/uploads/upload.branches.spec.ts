import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PassThrough, Readable } from 'stream';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadController } from 'src/features/uploads/upload.controller';
import { UploadService } from 'src/features/uploads/upload.service';

jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

describe('UploadController.download — branches', () => {
  const service = { download: jest.fn(), assertDownloadable: jest.fn().mockResolvedValue({}) };
  const controller = new UploadController(service as unknown as UploadService);
  const response = () => ({ setHeader: jest.fn(), status: jest.fn() }) as never;
  const user = { id: 'u1', role: 'ADMIN' } as never;

  it('rejects a missing key with 400', async () => {
    await expect(controller.download(user, '', response())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('omits Content-Length when the object size is unknown', async () => {
    service.download.mockResolvedValue({
      stream: Readable.from([Buffer.from('x')]),
      contentType: 'text/plain',
    });
    const res = Object.assign(new PassThrough(), { setHeader: jest.fn() });
    res.resume();

    await controller.download(user, 'uploads/b.txt', res as never);
    await new Promise((r) => setTimeout(r, 10));

    expect(res.setHeader).not.toHaveBeenCalledWith('Content-Length', expect.anything());
  });

  it('maps a missing R2 object to 404', async () => {
    service.download.mockRejectedValue(Object.assign(new Error('x'), { name: 'NoSuchKey' }));
    await expect(controller.download(user, 'gone.jpg', response())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rethrows any other storage error unchanged', async () => {
    const boom = new Error('network');
    service.download.mockRejectedValue(boom);
    await expect(controller.download(user, 'x.jpg', response())).rejects.toBe(boom);
  });
});

describe('UploadService.onModuleInit — failure logging', () => {
  it('logs the bare error name and message when R2 fails without HTTP metadata', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const send = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('socket closed'), { name: 'NetworkingError' }));
    const config = { get: (_: string, fallback?: string) => fallback } as unknown as ConfigService;
    const service = new UploadService({ send } as never, config);

    await service.onModuleInit();

    expect(error).toHaveBeenCalledWith(
      'Cloudflare R2 connection failed: NetworkingError — socket closed',
    );
    error.mockRestore();
  });
});
