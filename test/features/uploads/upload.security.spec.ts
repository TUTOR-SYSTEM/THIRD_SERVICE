import { BadRequestException, HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { PassThrough, Readable } from 'stream';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { IS_PUBLIC_KEY } from '@packages/decorators/public.decorator';
import { UploadService } from 'src/features/uploads/upload.service';
import { UploadController } from 'src/features/uploads/upload.controller';
import { UploadRpcController } from 'src/features/uploads/upload.rpc.controller';
import { UploadModule } from 'src/features/uploads/upload.module';
import { S3ClientProvider } from 'src/features/uploads/upload.provider';

jest.mock('uuid', () => ({ v4: () => 'test-uuid' }));

const MB = 1024 * 1024;
const cfg = (v: Record<string, string | undefined>) =>
  ({ get: jest.fn((k: string, d?: string) => v[k] ?? d) }) as unknown as ConfigService;
const config = cfg({ CLOUDFLARE_R2_BUCKET: 'b', CLOUDFLARE_R2_PUBLIC_URL: 'https://cdn.dev' });
const mk = () => {
  const send = jest.fn().mockResolvedValue({});
  return { send, svc: new UploadService({ send } as unknown as S3Client, config) };
};
const f = (o: Record<string, unknown>): any => ({
  fieldname: 'file',
  originalname: 'a.txt',
  encoding: '7bit',
  mimetype: 'text/plain',
  size: 3,
  buffer: Buffer.from('abc'),
  ...o,
});

const ADMIN = { id: 'u1', role: 'ADMIN', email: 'a@x.y', typ: 'access', sid: 's' } as never;

describe('uploads review fixes (group B)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('HTTP controller metadata', () => {
    it.each(['upload', 'uploadMultiple', 'download', 'delete'] as const)(
      '%s is not @Public',
      (h) => {
        const r = new Reflector();
        expect(
          r.getAllAndOverride(IS_PUBLIC_KEY, [UploadController.prototype[h], UploadController]),
        ).toBeFalsy();
      },
    );

    it('multer limits 10MB / 5 files (contract C5)', () => {
      const imports = Reflect.getMetadata('imports', UploadModule) as any[];
      const prov = imports
        .flatMap((i) => i.providers ?? [])
        .find((p: any) => p.provide === 'MULTER_MODULE_OPTIONS');
      const opts = prov?.useFactory ? prov.useFactory() : prov?.useValue;
      expect(opts?.limits?.fileSize).toBe(10 * MB);
      expect(opts?.limits?.files).toBe(5);
    });
  });

  describe('service.upload validation', () => {
    it('rejects file > 10MB with 400', async () => {
      const { svc, send } = mk();
      const big = Buffer.alloc(10 * MB + 1);
      await expect(
        svc.upload(
          f({ originalname: 'a.pdf', mimetype: 'application/pdf', buffer: big, size: big.length }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(send).not.toHaveBeenCalled();
    });

    it.each([
      ['a.svg', 'image/svg+xml'],
      ['a.html', 'text/html'],
      ['a.js', 'application/javascript'],
      ['a.html', 'text/plain'],
      ['a.svg', 'image/png'],
      ['a.exe', 'application/octet-stream'],
    ])('rejects %s (%s) with 400', async (originalname, mimetype) => {
      const { svc, send } = mk();
      await expect(svc.upload(f({ originalname, mimetype }))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(send).not.toHaveBeenCalled();
    });

    it('docx: attachment disposition, whitelisted content type and ext', async () => {
      const { svc, send } = mk();
      const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const res = await svc.upload(f({ originalname: 'Report.DOCX', mimetype: docx }));
      const put = send.mock.calls.map((c) => c[0]).find((c) => c instanceof PutObjectCommand);
      expect(put.input.ContentDisposition).toBe('attachment');
      expect(put.input.ContentType).toBe(docx);
      expect(put.input.Key).toMatch(/^uploads\/[^/]+\.docx$/);
      expect(res.key).toMatch(/^uploads\//);
    });

    it('does not trust client mimetype for dangerous ext mismatch (pdf ext declared text/html)', async () => {
      const { svc, send } = mk();
      await svc.upload(f({ originalname: 'a.pdf', mimetype: 'text/html' })).catch(() => undefined);
      const put = send.mock.calls.map((c) => c[0]).find((c) => c instanceof PutObjectCommand);
      if (put) expect(put.input.ContentType).toBe('application/pdf');
    });
  });

  describe('key validation (download/delete)', () => {
    it.each(['../x', 'uploads/../x', 'other/a.jpg', '/uploads/a.jpg', 'a.jpg'])(
      'download+delete reject %s with 400',
      async (key) => {
        const { svc, send } = mk();
        await expect(svc.download(key)).rejects.toBeInstanceOf(BadRequestException);
        await expect(svc.delete(key)).rejects.toBeInstanceOf(BadRequestException);
        expect(send).not.toHaveBeenCalled();
      },
    );

    it('accepts uploads/ keys', async () => {
      const { svc, send } = mk();
      await svc.delete('uploads/a.pdf');
      expect(send).toHaveBeenCalled();
    });
  });

  describe('F-28/F-39 missing config', () => {
    it('provider returns null and warns (does not throw) when R2 vars missing', () => {
      const factory = (S3ClientProvider as any).useFactory as (c: ConfigService) => unknown;
      expect(factory(cfg({}))).toBeNull();
      expect(Logger.prototype.warn).toHaveBeenCalled();
    });

    it('upload/download/delete throw HttpException (503/502) when s3 is null', async () => {
      const svc = new UploadService(null, config);
      for (const p of [
        svc.upload(f({})),
        svc.download('uploads/a.pdf'),
        svc.delete('uploads/a.pdf'),
      ]) {
        const e = await p.then(
          () => null,
          (x) => x,
        );
        expect(e).toBeInstanceOf(HttpException);
        expect([502, 503]).toContain((e as HttpException).getStatus());
      }
    });

    it('missing CLOUDFLARE_R2_PUBLIC_URL -> HttpException, never "undefined/..."', async () => {
      const send = jest.fn().mockResolvedValue({});
      const svc = new UploadService(
        { send } as unknown as S3Client,
        cfg({ CLOUDFLARE_R2_BUCKET: 'b' }),
      );
      expect(() => svc.getPublicUrl('uploads/a.pdf')).toThrow(HttpException);
      const e = await svc.upload(f({ originalname: 'a.pdf', mimetype: 'application/pdf' })).then(
        () => null,
        (x) => x,
      );
      expect(e).toBeInstanceOf(HttpException);
    });
  });

  describe('F-26 download stream safety', () => {
    const makeRes = () => {
      const res: any = new PassThrough();
      res.setHeader = jest.fn();
      res.status = jest.fn().mockReturnThis();
      res.json = jest.fn();
      return res;
    };
    const ctl = (stream: Readable) => {
      const service = {
        download: jest
          .fn()
          .mockResolvedValue({ stream, contentType: 'application/pdf', contentLength: 3 }),
        assertDownloadable: jest.fn().mockResolvedValue({}),
      };
      return new UploadController(service as unknown as UploadService);
    };

    it('stream error does not crash and destroys res', async () => {
      const stream = new Readable({
        read() {
          this.destroy(new Error('boom'));
        },
      });
      const res = makeRes();
      res.on('error', () => undefined);
      await ctl(stream)
        .download(ADMIN, 'uploads/a.pdf', res)
        .catch(() => undefined);
      await new Promise((r) => setTimeout(r, 20));
      expect(res.destroyed).toBe(true);
    });

    it('res close destroys source stream', async () => {
      const stream = new Readable({ read() {} });
      const res = makeRes();
      await ctl(stream).download(ADMIN, 'uploads/a.pdf', res);
      res.destroy();
      await new Promise((r) => setTimeout(r, 20));
      expect(stream.destroyed).toBe(true);
    });
  });

  describe('RPC size check', () => {
    it('upload.upload rejects > 10MB decoded buffer', async () => {
      const service = {
        upload: jest.fn(),
        uploadMultiple: jest.fn(),
        assertUploaderRole: UploadService.prototype.assertUploaderRole,
        consumeUploadQuota: jest.fn().mockResolvedValue(undefined),
      };
      const rpc = new UploadRpcController(service as unknown as UploadService);
      const data = Array.from({ length: 10 * MB + 1 }, () => 0);
      const file = {
        fieldname: 'file',
        originalname: 'a.pdf',
        encoding: '7bit',
        mimetype: 'application/pdf',
        size: 1,
        buffer: { type: 'Buffer' as const, data },
      };
      const actor = { userId: 'u1', role: 'ADMIN' };
      await expect(rpc.upload({ file, ...actor })).rejects.toBeDefined();
      await expect(rpc.uploadMultiple({ files: [file], ...actor })).rejects.toBeDefined();
      expect(service.upload).not.toHaveBeenCalled();
      expect(service.uploadMultiple).not.toHaveBeenCalled();
    });
  });
});
