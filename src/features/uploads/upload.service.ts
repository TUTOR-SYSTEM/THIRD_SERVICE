import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { ERROR_MESSAGES } from 'src/data/constants';
import { RedisService } from '../redis/redis.service';
import {
  BLOCKED_MIMETYPES,
  DOCUMENT_CONTENT_TYPES,
  IMAGE_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  OWNER_METADATA_KEY,
  PRESIGNED_DOWNLOAD_TTL_SECONDS,
  S3_CLIENT,
  MAX_IMAGE_PIXELS,
  UPLOAD_FILES_PER_MINUTE,
  SUBMISSION_KEY_PREFIX,
  UPLOAD_KEY_PREFIX,
  UPLOADER_ROLES,
} from './upload.constant';
import type {
  MulterFile,
  PresignedDownload,
  UploadActor,
  UploadResponse,
} from './upload.interface';

/** Max image decodes running at once across all requests (report F-12). */
const SHARP_MAX_CONCURRENCY = 4;
let sharpActive = 0;
const sharpWaiters: Array<() => void> = [];

async function withSharpSlot<T>(task: () => Promise<T>): Promise<T> {
  if (sharpActive >= SHARP_MAX_CONCURRENCY) {
    // The slot is handed over to the next waiter, so the count never exceeds the limit.
    await new Promise<void>((resolve) => sharpWaiters.push(resolve));
  } else {
    sharpActive++;
  }
  try {
    return await task();
  } finally {
    const next = sharpWaiters.shift();
    if (next) next();
    else sharpActive--;
  }
}

@Injectable()
export class UploadService implements OnModuleInit {
  private readonly logger = new Logger(UploadService.name);
  private readonly bucket: string;

  constructor(
    @Inject(S3_CLIENT)
    private readonly s3: S3Client | null,
    private readonly configService: ConfigService,
    @Optional() private readonly redisService?: RedisService,
  ) {
    this.bucket = this.configService.get<string>('CLOUDFLARE_R2_BUCKET', 'tutor');
  }

  async onModuleInit() {
    if (!this.s3) {
      this.logger.warn('Cloudflare R2 not configured — set CLOUDFLARE_R2_* env vars');
      return;
    }
    try {
      const key = `healthcheck-${Date.now()}.tmp`;
      await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: 'ok' }));
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      this.logger.log(`Cloudflare R2 connected — bucket "${this.bucket}" ready`);
    } catch (_err) {
      const err = _err as Error & { name: string; $metadata?: { httpStatusCode?: number } };

      const hint =
        err.$metadata?.httpStatusCode === 403
          ? ' — check the bucket exists, the API token has write permission on it, and the key/secret/endpoint belong to the same account'
          : '';
      this.logger.error(
        `Cloudflare R2 connection failed: ${err.name} — ${err.message}` +
          (err.$metadata ? ` [status=${err.$metadata.httpStatusCode}]` : '') +
          hint,
      );
    }
  }

  private requireS3(): S3Client {
    if (!this.s3) throw new ServiceUnavailableException('Cloudflare R2 not configured');
    return this.s3;
  }

  private assertValidKey(key: string): void {
    if (typeof key !== 'string') throw new BadRequestException('Invalid file key');
    const validPrefix = key.startsWith(UPLOAD_KEY_PREFIX) || key.startsWith(SUBMISSION_KEY_PREFIX);
    if (!key || !validPrefix || key.includes('..') || key.includes('\\')) {
      throw new BadRequestException('Invalid file key');
    }
  }

  /** Only ADMIN, TUTOR and STUDENT may upload (PARENT is refused). Fail closed on a missing role. */
  assertUploaderRole(role: string | undefined): void {
    if (!role || !UPLOADER_ROLES.has(role)) {
      throw new ForbiddenException(ERROR_MESSAGES.PERMISSION_DENIED);
    }
  }

  /**
   * Per-user fixed-window quota (files per minute), kept in Redis so it holds across instances.
   * Fails open when Redis is not wired or unreachable: the rate limit is best-effort, the
   * per-request cap (MAX_UPLOAD_FILES) still applies.
   */
  async consumeUploadQuota(userId: string, fileCount: number): Promise<void> {
    if (!this.redisService || fileCount <= 0) return;
    const window = Math.floor(Date.now() / 60_000);
    const key = `upload-rate:${userId}:${window}`;
    let used: number;
    try {
      // Atomic INCRBY + EXPIRE: a crash in between can never leave a counter without a TTL.
      used = await this.redisService.incrByWithWindow(key, fileCount, 120);
    } catch (err) {
      this.logger.warn(`Upload quota unavailable, failing open: ${(err as Error).message}`);
      return;
    }
    if (used > UPLOAD_FILES_PER_MINUTE) {
      throw new HttpException(ERROR_MESSAGES.UPLOAD_RATE_LIMITED, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /**
   * `ownerId` is stored as S3 object metadata and decides who may download the object later
   * (see `assertDownloadable`). Callers pass the authenticated user, never a client value.
   */
  async upload(file: MulterFile, folder = 'uploads', ownerId?: string): Promise<UploadResponse> {
    const s3 = this.requireS3();
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const size = file.buffer?.length ?? 0;
    if (size === 0 || size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `File must be between 1 byte and ${MAX_UPLOAD_BYTES / 1024 / 1024}MB`,
      );
    }
    const mimetype = (file.mimetype ?? '').toLowerCase();
    if (typeof file.originalname !== 'string' || file.originalname.length === 0) {
      throw new BadRequestException('File name is required');
    }
    const dot = file.originalname.lastIndexOf('.');
    const originalExt = dot >= 0 ? file.originalname.slice(dot + 1).toLowerCase() : '';
    const isImage = IMAGE_EXTENSIONS.has(originalExt);
    const documentType = DOCUMENT_CONTENT_TYPES[originalExt];
    if (BLOCKED_MIMETYPES.has(mimetype) || (!isImage && !documentType)) {
      throw new BadRequestException('File type is not allowed');
    }
    if (!isImage && !this.matchesDocumentSignature(originalExt, file.buffer)) {
      throw new BadRequestException('File content does not match its extension');
    }
    // Images are always re-encoded to JPEG below, so key/mimetype must say so.
    const ext = isImage ? 'jpg' : originalExt;
    const contentType = isImage ? 'image/jpeg' : documentType;
    const key = `${folder}/${uuidv4()}.${ext}`;
    const url = this.getPublicUrl(key);

    let processedBuffer = file.buffer;

    if (isImage) {
      try {
        // Pixel cap guards against decompression bombs (a small file that decodes to GBs of RAM).
        processedBuffer = await withSharpSlot(() =>
          sharp(file.buffer, { limitInputPixels: MAX_IMAGE_PIXELS })
            .rotate()
            .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80, mozjpeg: true })
            .toBuffer(),
        );
      } catch (err) {
        this.logger.warn(`Image decode failed: ${(err as Error).message}`);
        throw new BadRequestException('Invalid image file');
      }
    }

    await s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: processedBuffer,
        ContentType: contentType,
        ...(isImage ? {} : { ContentDisposition: 'attachment' }),
        ...(ownerId ? { Metadata: { [OWNER_METADATA_KEY]: ownerId } } : {}),
      }),
    );

    return { url, key, size: processedBuffer.length, mimetype: contentType };
  }

  /** Magic-byte check so a renamed binary cannot pass as a document (extension alone is client-controlled). */
  private matchesDocumentSignature(ext: string, buf: Buffer): boolean {
    const startsWith = (...bytes: number[]) => bytes.every((b, i) => buf[i] === b);
    switch (ext) {
      case 'pdf':
        return startsWith(0x25, 0x50, 0x44, 0x46); // %PDF
      case 'docx':
      case 'xlsx':
      case 'pptx':
      case 'zip':
        return startsWith(0x50, 0x4b); // PK
      case 'doc':
      case 'xls':
      case 'ppt':
        return startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1); // OLE2
      case 'mp4':
        return buf.length > 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp';
      case 'mp3':
        return startsWith(0x49, 0x44, 0x33) || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
      case 'txt':
        return !buf.subarray(0, 8000).includes(0); // no NUL bytes => text
      default:
        return false;
    }
  }

  getPublicUrl(key: string): string {
    const base = this.configService.get<string>('CLOUDFLARE_R2_PUBLIC_URL');
    if (!base) throw new ServiceUnavailableException('CLOUDFLARE_R2_PUBLIC_URL is not configured');
    return `${base.replace(/\/+$/, '')}/${key}`;
  }

  /**
   * Ownership check for downloads: ADMIN may read anything; everyone else only the objects they
   * uploaded (owner metadata). Objects without owner metadata are ADMIN-only. Returns the stored
   * content type and a safe filename.
   */
  async assertDownloadable(
    key: string,
    actor: UploadActor,
  ): Promise<{ contentType: string; contentLength?: number; filename: string }> {
    this.assertValidKey(key);
    const s3 = this.requireS3();
    let head: HeadObjectCommandOutput;
    try {
      head = await s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      const e = err as { name?: string };
      if (e.name === 'NoSuchKey' || e.name === 'NotFound') {
        throw new NotFoundException(ERROR_MESSAGES.FILE_NOT_FOUND);
      }
      throw err;
    }
    const owner = head.Metadata?.[OWNER_METADATA_KEY];
    // Gateway đã kiểm tra quyền theo buổi học/bài tập/bài giảng (exercise.fileAccess) → tin cờ đó.
    if (!actor.authorized && actor.role !== 'ADMIN' && (!owner || owner !== actor.userId)) {
      throw new ForbiddenException(ERROR_MESSAGES.PERMISSION_DENIED);
    }
    return {
      contentType: head.ContentType ?? 'application/octet-stream',
      contentLength: head.ContentLength,
      filename: this.safeFilename(key),
    };
  }

  /** Short-lived signed GET URL for the object, issued only after `assertDownloadable` passes. */
  async presignDownload(key: string, actor: UploadActor): Promise<PresignedDownload> {
    const { contentType, filename } = await this.assertDownloadable(key, actor);
    const s3 = this.requireS3();
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${filename}"`,
      }),
      { expiresIn: PRESIGNED_DOWNLOAD_TTL_SECONDS },
    );
    return { url, expiresIn: PRESIGNED_DOWNLOAD_TTL_SECONDS, contentType, filename };
  }

  async download(
    key: string,
  ): Promise<{ stream: Readable; contentType: string; contentLength?: number }> {
    this.assertValidKey(key);
    const s3 = this.requireS3();
    const result = await s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      stream: result.Body as Readable,
      contentType: result.ContentType ?? 'application/octet-stream',
      contentLength: result.ContentLength,
    };
  }

  /** 404 when the object does not exist (S3 DeleteObject alone is silent for missing keys). */
  async delete(key: string): Promise<void> {
    this.assertValidKey(key);
    const s3 = this.requireS3();
    try {
      await s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      const e = err as { name?: string };
      if (e.name === 'NoSuchKey' || e.name === 'NotFound') {
        throw new NotFoundException(ERROR_MESSAGES.FILE_NOT_FOUND);
      }
      throw err;
    }
    await s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /**
   * Ownership check for HTTP deletes: ADMIN may delete anything; everyone else only objects they
   * uploaded (owner metadata). Unlike downloads, the gateway's `authorized` flag does NOT bypass
   * this: it only grants read access to a lesson's files, never deletion.
   */
  async deleteOwned(key: string, actor: UploadActor): Promise<void> {
    this.assertValidKey(key);
    const s3 = this.requireS3();
    let head: HeadObjectCommandOutput;
    try {
      head = await s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      const e = err as { name?: string };
      if (e.name === 'NoSuchKey' || e.name === 'NotFound') {
        throw new NotFoundException(ERROR_MESSAGES.FILE_NOT_FOUND);
      }
      throw err;
    }
    const owner = head.Metadata?.[OWNER_METADATA_KEY];
    if (actor.role !== 'ADMIN' && (!owner || owner !== actor.userId)) {
      throw new ForbiddenException(ERROR_MESSAGES.PERMISSION_DENIED);
    }
    await this.delete(key);
  }

  async uploadMultiple(
    files: MulterFile[],
    folder = 'uploads',
    ownerId?: string,
  ): Promise<UploadResponse[]> {
    if (!Array.isArray(files) || files.length === 0) {
      throw new BadRequestException('files is required');
    }
    const results = await Promise.allSettled(files.map((f) => this.upload(f, folder, ownerId)));
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) {
      // Don't leave the files that did land in the bucket orphaned when the batch fails.
      await Promise.allSettled(
        results.flatMap((r) => (r.status === 'fulfilled' ? [this.delete(r.value.key)] : [])),
      );
      throw failed.reason;
    }
    return results.map((r) => (r as PromiseFulfilledResult<UploadResponse>).value);
  }

  private safeFilename(key: string): string {
    return (key.split('/').pop() as string).replace(/[^\w.-]/g, '_');
  }
}
