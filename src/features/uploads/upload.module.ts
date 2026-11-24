import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadController } from './upload.controller';
import { UploadRpcController } from './upload.rpc.controller';
import { UploadService } from './upload.service';
import { S3ClientProvider } from './upload.provider';
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_FILES } from './upload.constant';

@Module({
  imports: [
    MulterModule.register({
      storage: memoryStorage(),
      limits: {
        fileSize: MAX_UPLOAD_BYTES,
        files: MAX_UPLOAD_FILES,
        // Bound non-file parts too: unlimited fields/parts is a memory-DoS vector with memoryStorage.
        fields: 10,
        parts: MAX_UPLOAD_FILES + 10,
        fieldSize: 64 * 1024,
      },
    }),
  ],
  controllers: [UploadController, UploadRpcController],
  providers: [UploadService, S3ClientProvider],
  exports: [UploadService],
})
export class UploadModule {}
