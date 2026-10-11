export const S3_CLIENT = 'S3_CLIENT';
export const UPLOAD_DIR = 'uploads';
/** Per-file cap enforced by Multer (HTTP) and by `UploadService.upload` (RPC path). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
