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
import { CurrentUser, Roles } from '@packages/decorators';
import { RolesGuard, type JwtGuardUser } from '@packages/guards';
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
  async upload(
    @CurrentUser() user: JwtGuardUser,
    @UploadedFile() file: MulterFile,
  ): Promise<UploadResponse> {
    this.uploadService.assertUploaderRole(user.role);
    await this.uploadService.consumeUploadQuota(user.id, 1);
    return this.uploadService.upload(file, 'uploads', user.id);
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
  async uploadMultiple(
    @CurrentUser() user: JwtGuardUser,
    @UploadedFiles() files: MulterFile[],
  ): Promise<UploadResponse[]> {
    this.uploadService.assertUploaderRole(user.role);
    await this.uploadService.consumeUploadQuota(user.id, files?.length ?? 0);
    return this.uploadService.uploadMultiple(files, 'uploads', user.id);
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
  async download(
    @CurrentUser() user: JwtGuardUser,
    @Query('key') key: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!key) throw new BadRequestException('key query param is required');
    // Ownership first: a non-owner gets 403 before any object bytes are opened.
    await this.uploadService.assertDownloadable(key, { userId: user.id, role: user.role });
    try {
      const { stream, contentType, contentLength } = await this.uploadService.download(key);
      const filename = (key.split('/').pop() as string).replace(/[^\w.-]/g, '_');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (contentLength !== undefined) res.setHeader('Content-Length', contentLength);
      // pipeline destroys both ends on error or premature client close (no S3 connection leak / unhandled 'error').
      pipeline(stream, res, (pipeErr) => {
        if (pipeErr) {
          this.logger.warn(`Download stream aborted for "${key}": ${pipeErr.message}`);
          if (!res.destroyed) res.destroy();
        }
      });
    } catch (err: unknown) {
      const e = err as { name?: string };
      if (e.name === 'NoSuchKey' || e.name === 'NotFound') {
        throw new NotFoundException(`File "${key}" not found`);
      }
      throw err;
    }
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Delete(':key')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'Delete file' })
  @SwaggerResponse({ status: 200, description: 'File deleted' })
  async delete(@Param('key') key: string): Promise<void> {
    return this.uploadService.delete(key);
  }
}
