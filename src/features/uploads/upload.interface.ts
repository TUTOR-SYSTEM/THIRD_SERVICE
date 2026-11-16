export interface MulterFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
  fieldname: string;
  encoding: string;
}

export interface UploadResponse {
  url: string;
  key: string;
  size: number;
  mimetype: string;
}

/** Identity forwarded by the gateway (from the JWT, never from the client body). */
export interface UploadActor {
  userId: string;
  role: string;
  /**
   * Gateway đã kiểm tra quyền truy cập file theo ngữ cảnh (buổi học / bài tập / bài giảng) qua
   * `exercise.fileAccess`; khi true thì bỏ qua kiểm tra owner-metadata ở đây.
   */
  authorized?: boolean;
}

export interface PresignedDownload {
  url: string;
  expiresIn: number;
  contentType: string;
  filename: string;
}
