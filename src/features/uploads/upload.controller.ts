import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
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
import { Public } from '@packages/decorators';
import { StatusCodes } from 'http-status-codes';
import { UploadService } from './upload.service';
import type { MulterFile, UploadResponse } from './upload.interface';

@ApiTags('Upload')
@ApiBearerAuth('access-token')
@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Public()
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

  @Public()
  @Post('multiple')
  @UseInterceptors(FilesInterceptor('files', 10))
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

  @Public()
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
      const filename = key.split('/').pop() as string;
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      if (contentLength !== undefined) res.setHeader('Content-Length', contentLength);
      stream.pipe(res);
    } catch (err: unknown) {
      const e = err as { name?: string };
      if (e.name === 'NoSuchKey' || e.name === 'NotFound') {
        throw new NotFoundException(`File "${key}" not found`);
      }
      throw err;
    }
  }

  @Public()
  @Delete(':key')
  @HttpCode(StatusCodes.OK)
  @ApiOperation({ summary: 'Delete file' })
  @SwaggerResponse({ status: 200, description: 'File deleted' })
  async delete(@Param('key') key: string): Promise<void> {
    return this.uploadService.delete(key);
  }
}
