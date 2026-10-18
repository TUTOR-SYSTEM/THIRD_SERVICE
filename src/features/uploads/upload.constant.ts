export const S3_CLIENT = 'S3_CLIENT';
export const UPLOAD_DIR = 'uploads';

/** Per-file cap enforced by Multer (HTTP) and by `UploadService.upload` (RPC path). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Files per multipart / RPC batch request (contract C5). */
export const MAX_UPLOAD_FILES = 5;
/** Per-user quota: files uploaded per rolling minute (fixed window, shared across instances via Redis). */
export const UPLOAD_FILES_PER_MINUTE = 30;
/** Lifetime of a presigned download URL handed out over RPC. */
export const PRESIGNED_DOWNLOAD_TTL_SECONDS = 300;
/** S3 object metadata key holding the uploader's user id (used for download ownership). */
export const OWNER_METADATA_KEY = 'owner-id';
/** Roles allowed to upload (PARENT is rejected). Objects are owner-tagged, so students only read their own. */
export const UPLOADER_ROLES: ReadonlySet<string> = new Set(['ADMIN', 'TUTOR', 'STUDENT']);
export const UPLOAD_KEY_PREFIX = `${UPLOAD_DIR}/`;

/** Images are decoded and re-encoded to JPEG by sharp, so the stored object is always image/jpeg. */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

/** Non-image whitelist: extension -> the ContentType we store (never the client-supplied mimetype). */
export const DOCUMENT_CONTENT_TYPES: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  zip: 'application/zip',
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
};

/** Client mimetypes that are rejected outright regardless of extension. */
export const BLOCKED_MIMETYPES: ReadonlySet<string> = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
]);
