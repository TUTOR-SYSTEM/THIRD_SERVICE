import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { pipeline } from 'stream';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiResponse as SwaggerResponse,
} from '@nestjs/swagger';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
<<<<<<< Updated upstream
=======
import { Roles } from '@packages/decorators';
import { RolesGuard } from '@packages/guards';
>>>>>>> Stashed changes
import { StatusCodes } from 'http-status-codes';
import { MAX_UPLOAD_FILES } from './upload.constant';
import { UploadService } from './upload.service';
import type { MulterFile, UploadResponse } from './upload.interface';

@ApiTags('Upload')
@ApiBearerAuth('access-token')
@Controller('upload')
export class UploadController {
  private readonly logger = new Logger(UploadController.name);

  constructor(private readonly uploadService: UploadService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(StatusCodes.CREATED)
  @ApiOperation({ summary: 'Upload file', description: 'Upload a file to Cloudflare R2' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @SwaggerResponse({ status: 201, description: 'File uploaded' })
  async upload(@UploadedFile() file: MulterFile): Promise<UploadResponse> {
    return this.uploadService.upload(file);
  }

  @Post('multiple')
  @UseInterceptors(FilesInterceptor('files', MAX_UPLOAD_FILES))
  @HttpCode(StatusCodes.CREATED)
  @ApiOperation({ summary: 'Upload multiple files' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
      },
    },
  })
  @SwaggerResponse({ status: 201, description: 'Files uploaded' })
  async uploadMultiple(@UploadedFiles() files: MulterFile[]): Promise<UploadResponse[]> {
    return this.uploadService.uploadMultiple(files);
  }

  @Get('download')
  @ApiOperation({
    summary: 'Download file',
    description: 'Stream a file from Cloudflare R2 by its key',
  })
  @ApiQuery({ name: 'key', required: true, description: 'R2 object key (e.g. uploads/uuid.jpg)' })
  @SwaggerResponse({ status: 200, description: 'File stream' })
  @SwaggerResponse({ status: 400, description: 'key query param missing' })
  @SwaggerResponse({ status: 404, description: 'File not found in R2' })
  async download(@Query('key') key: string, @Res() res: Response): Promise<void> {
    if (!key) throw new BadRequestException('key query param is required');
    try {
      const { stream, contentType, contentLength } = await this.uploadService.download(key);
      const filename = (key.split('/').pop() as string).replace(/[^\w.-]/g, '_');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (contentLength !== undefined) res.setHeader('Content-Length', contentLength);
<<<<<<< Updated upstream
      // `pipeline` forwards stream errors and destroys both ends, so a mid-transfer R2 failure
      // or a client disconnect can't surface as an uncaught 'error' event.
      pipeline(stream, res, () => undefined);
=======
      // pipeline destroys both ends on error or premature client close (no S3 connection leak / unhandled 'error').
      pipeline(stream, res, (pipeErr) => {
        if (pipeErr) {
          this.logger.warn(`Download stream aborted for "${key}": ${pipeErr.message}`);
          if (!res.destroyed) res.destroy();
        }
      });
>>>>>>> Stashed changes
    } catch (err: unknown) {
      const e = err as { name?: string };
      if (e.name === 'NoSuchKey' || e.name === 'NotFound') {
        throw new NotFoundException(`File "${key}" not found`);
      }
      throw err;
    }
  }

<<<<<<< Updated upstream
=======
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
>>>>>>> Stashed changes
  @Delete(':key')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'Delete file' })
  @SwaggerResponse({ status: 200, description: 'File deleted' })
  async delete(@Param('key') key: string): Promise<void> {
    return this.uploadService.delete(key);
  }
}
