import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { UploadController } from 'src/features/uploads/upload.controller';
import { UploadService } from 'src/features/uploads/upload.service';
import { IS_PUBLIC_KEY } from '@packages/decorators';

jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

const config = {
  get: (key: string, fallback?: string) =>
    key === 'CLOUDFLARE_R2_PUBLIC_URL' ? 'https://cdn.test' : fallback,
} as unknown as ConfigService;

const file = (originalname: string, mimetype: string, buffer = Buffer.from('data')) =>
  ({ originalname, mimetype, buffer, size: buffer.length }) as never;

const pngBuffer = () =>
  sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();

describe('UploadService — key and mimetype edge cases', () => {
  const send = jest.fn().mockResolvedValue({});
  const service = new UploadService({ send } as never, config);

  beforeEach(() => send.mockClear());

  it('rejects a file without an extension (not whitelisted) with 400', async () => {
    await expect(service.upload(file('README', 'application/octet-stream'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('keeps the original extension for non-images', async () => {
    const res = await service.upload(file('notes.final.pdf', 'application/pdf'), 'docs');
    expect(res.key).toMatch(/^docs\/test-uuid\.pdf$/);
    expect(res.url).toBe(`https://cdn.test/${res.key}`);
  });

  it('re-encodes images to JPEG and reports image/jpeg', async () => {
    const res = await service.upload(file('photo.png', 'image/png', await pngBuffer()));
    expect(res.key.endsWith('.jpg')).toBe(true);
    expect(res.mimetype).toBe('image/jpeg');
    const sent = send.mock.calls[0][0].input;
    expect(sent.ContentType).toBe('image/jpeg');
    expect(sent.Body.subarray(0, 2).toString('hex')).toBe('ffd8');
  });

  // BUG (expected to fail): the extension is taken verbatim from originalname, so a name
  // containing "/" puts extra path segments into the object key.
  it.failing('does not let the original filename inject "/" into the object key', async () => {
    const res = await service.upload(file('evil.j/pg', 'application/octet-stream'));
    expect(res.key.split('/')).toHaveLength(2);
  });
});

describe('UploadController — access control metadata', () => {
  const isPublic = (handler: object) => Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true;

<<<<<<< Updated upstream
  it('POST /upload requires authentication', () => {
    expect(isPublic(UploadController.prototype.upload)).toBe(false);
    expect(isPublic(UploadController.prototype.uploadMultiple)).toBe(false);
  });

=======
  it('upload routes are not @Public (JWT required)', () => {
    expect(isPublic(UploadController.prototype.upload)).toBe(false);
  });

  // SECURITY (expected to fail): DELETE /upload/:key is @Public, so anyone who can reach the
  // service can delete any object in the R2 bucket without a JWT.
>>>>>>> Stashed changes
  it('DELETE /upload/:key requires authentication', () => {
    expect(isPublic(UploadController.prototype.delete)).toBe(false);
  });

<<<<<<< Updated upstream
=======
  // SECURITY (expected to fail): GET /upload/download is @Public and streams any object key
  // the caller names, so private uploads are readable without a JWT.
>>>>>>> Stashed changes
  it('GET /upload/download requires authentication', () => {
    expect(isPublic(UploadController.prototype.download)).toBe(false);
  });
});
