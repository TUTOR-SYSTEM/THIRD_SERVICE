import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UploadService } from 'src/features/uploads/upload.service';

jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

const config = {
  get: (key: string, fallback?: string) =>
    key === 'CLOUDFLARE_R2_PUBLIC_URL' ? 'https://cdn.test' : fallback,
} as unknown as ConfigService;
const file = (originalname: unknown, buffer: Buffer) =>
  ({ originalname, mimetype: 'application/octet-stream', buffer, size: buffer.length }) as never;

describe('UploadService hardening', () => {
  const send = jest.fn().mockResolvedValue({});
  const service = new UploadService({ send } as never, config);
  beforeEach(() => send.mockClear());

  it('rejects a document whose bytes do not match its extension', async () => {
    await expect(
      service.upload(file('evil.pdf', Buffer.from('MZ\x90 exe'))),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a missing originalname with 400 instead of a TypeError', async () => {
    await expect(service.upload(file(undefined, Buffer.from('%PDF')))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a txt file containing NUL bytes', async () => {
    await expect(
      service.upload(file('a.txt', Buffer.from([0x61, 0x00, 0x62]))),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
