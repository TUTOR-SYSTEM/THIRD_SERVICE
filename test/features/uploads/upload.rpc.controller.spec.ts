import { Readable } from 'stream';
import { PATTERN_METADATA } from '@nestjs/microservices/constants';
import { UploadRpcController } from 'src/features/uploads/upload.rpc.controller';
import { UploadService } from 'src/features/uploads/upload.service';

// uuid@14 is ESM-only; the controller specs never assert on keys.
jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

describe('UploadRpcController', () => {
  const service = {
    upload: jest.fn(),
    uploadMultiple: jest.fn(),
    download: jest.fn(),
    delete: jest.fn(),
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
      Reflect.getMetadata(PATTERN_METADATA, UploadRpcController.prototype[method as keyof UploadRpcController]),
    ).toEqual([pattern]);
  });

  it('rebuilds a real Buffer from the JSON-serialized RMQ payload before uploading', async () => {
    service.upload.mockResolvedValue({ key: 'k', url: 'u', size: 3, mimetype: 'text/plain' });

    await controller.upload({ file: rpcFile('a.txt', [97, 98, 99]) });

    const passed = service.upload.mock.calls[0][0];
    expect(Buffer.isBuffer(passed.buffer)).toBe(true);
    expect(passed.buffer.toString()).toBe('abc');
    expect(passed.originalname).toBe('a.txt');
  });

  it('uploadMultiple converts every file and returns the service results', async () => {
    service.uploadMultiple.mockResolvedValue([{ key: 'a' }, { key: 'b' }]);

    const result = await controller.uploadMultiple({
      files: [rpcFile('a.txt', [1]), rpcFile('b.txt', [2])],
    });

    expect(result).toEqual([{ key: 'a' }, { key: 'b' }]);
    const passed = service.uploadMultiple.mock.calls[0][0];
    expect(passed.every((f: { buffer: unknown }) => Buffer.isBuffer(f.buffer))).toBe(true);
  });

  it('download drains the S3 stream into one Buffer and derives the filename from the key', async () => {
    service.download.mockResolvedValue({
      stream: Readable.from([Buffer.from('he'), Buffer.from('llo')]),
      contentType: 'text/plain',
      contentLength: 5,
    });

    const result = await controller.download({ key: 'uploads/2024/notes.txt' });

    expect(result.content.toString()).toBe('hello');
    expect(result.contentType).toBe('text/plain');
    expect(result.contentLength).toBe(5);
    expect(result.filename).toBe('notes.txt');
  });

  it('download converts non-Buffer chunks (Uint8Array) into Buffers', async () => {
    service.download.mockResolvedValue({
      stream: Readable.from([new Uint8Array([104, 105])]),
      contentType: 'application/octet-stream',
    });

    const result = await controller.download({ key: 'k' });

    expect(Buffer.isBuffer(result.content)).toBe(true);
    expect(result.content.toString()).toBe('hi');
    expect(result.filename).toBe('k');
  });

  it('download propagates NoSuchKey from the service', async () => {
    service.download.mockRejectedValue(Object.assign(new Error('gone'), { name: 'NoSuchKey' }));

    await expect(controller.download({ key: 'missing' })).rejects.toMatchObject({ name: 'NoSuchKey' });
  });

  it('delete forwards the key and returns the service result', async () => {
    service.delete.mockResolvedValue(undefined);

    await controller.del({ key: 'uploads/x.jpg' });

    expect(service.delete).toHaveBeenCalledWith('uploads/x.jpg');
  });
});
