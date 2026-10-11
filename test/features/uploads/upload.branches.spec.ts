import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Readable } from 'stream';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadController } from 'src/features/uploads/upload.controller';
import { UploadRpcController } from 'src/features/uploads/upload.rpc.controller';
import { UploadService } from 'src/features/uploads/upload.service';

jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

describe('UploadController.download — branches', () => {
  const service = { download: jest.fn() };
  const controller = new UploadController(service as unknown as UploadService);
  const response = () => ({ setHeader: jest.fn(), status: jest.fn() }) as never;

  it('rejects a missing key with 400', async () => {
    await expect(controller.download('', response())).rejects.toBeInstanceOf(BadRequestException);
  });

  it('omits Content-Length when the object size is unknown', async () => {
    service.download.mockResolvedValue({ stream: Readable.from([]), contentType: 'text/plain' });
    const res = { setHeader: jest.fn() } as never as { setHeader: jest.Mock };
    const pipe = jest.spyOn(Readable.prototype, 'pipe').mockImplementation((dest) => dest as never);

    await controller.download('a/b.txt', res as never);

    expect(res.setHeader).not.toHaveBeenCalledWith('Content-Length', expect.anything());
    pipe.mockRestore();
  });

  it('maps a missing R2 object to 404', async () => {
    service.download.mockRejectedValue(Object.assign(new Error('x'), { name: 'NoSuchKey' }));
    await expect(controller.download('gone.jpg', response())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rethrows any other storage error unchanged', async () => {
    const boom = new Error('network');
    service.download.mockRejectedValue(boom);
    await expect(controller.download('x.jpg', response())).rejects.toBe(boom);
  });
});

describe('UploadRpcController.download — chunk types', () => {
  it('concatenates Uint8Array chunks as well as Buffers', async () => {
    const service = {
      download: jest.fn().mockResolvedValue({
        stream: Readable.from([new Uint8Array([1, 2]), Buffer.from([3])]),
        contentType: 'application/octet-stream',
        contentLength: 3,
      }),
    };
    const controller = new UploadRpcController(service as unknown as UploadService);

    const out = await controller.download({ key: 'dir/file.bin' });

    expect(out.content).toEqual(Buffer.from([1, 2, 3]));
    expect(out.filename).toBe('file.bin');
  });
});

describe('UploadService.onModuleInit — failure logging', () => {
  it('logs the bare error name and message when R2 fails without HTTP metadata', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const send = jest.fn().mockRejectedValue(Object.assign(new Error('socket closed'), { name: 'NetworkingError' }));
    const config = { get: (_: string, fallback?: string) => fallback } as unknown as ConfigService;
    const service = new UploadService({ send } as never, config);

    await service.onModuleInit();

    expect(error).toHaveBeenCalledWith('Cloudflare R2 connection failed: NetworkingError — socket closed');
    error.mockRestore();
  });
});
