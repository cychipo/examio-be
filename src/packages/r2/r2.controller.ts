import {
    Controller,
    Post,
    Get,
    Delete,
    Body,
    Param,
    Query,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiConsumes,
    ApiBody,
} from '@nestjs/swagger';
import { R2Service } from './r2.service';
import { UploadFileDto, UploadFileResponseDto } from './dto/upload-file.dto';
import { ListFilesDto, ListFilesResponseDto } from './dto/list-files.dto';
import {
    DeleteFileResponseDto,
    DeleteDirectoryResponseDto,
} from './dto/delete-file.dto';
import { sanitizeFilename } from 'src/common/utils/sanitize-filename';

@ApiTags('R2 Storage')
@Controller('r2')
export class R2Controller {
    constructor(private readonly r2Service: R2Service) {}

    @Post('upload')
    @ApiOperation({ summary: 'Upload file to R2 bucket' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    format: 'binary',
                    description: 'File to upload',
                },
                directory: {
                    type: 'string',
                    description: 'Optional directory path',
                    example: 'avatars',
                },
            },
            required: ['file'],
        },
    })
    @ApiResponse({
        status: 201,
        description: 'File uploaded successfully',
        type: UploadFileResponseDto,
    })
    @ApiResponse({
        status: 400,
        description: 'No file provided or invalid file',
    })
    @UseInterceptors(FileInterceptor('file'))
    async uploadFile(
        @UploadedFile() file: Express.Multer.File,
        @Body() uploadFileDto: UploadFileDto
    ): Promise<UploadFileResponseDto> {
        if (!file) {
            throw new BadRequestException('No file provided');
        }

        // Sanitize filename để tránh lỗi format với tiếng Việt và ký tự đặc biệt
        const sanitizedFilename = sanitizeFilename(file.originalname);
        const key = `${Date.now()}-${sanitizedFilename}`;

        const fullKey = await this.r2Service.uploadFile(
            key,
            file.buffer,
            file.mimetype,
            uploadFileDto.directory
        );

        const url = this.r2Service.getPublicUrl(fullKey);

        return {
            url,
            key: fullKey,
            message: 'File uploaded successfully',
        };
    }

    @Post('image')
    @ApiOperation({ summary: 'Upload image to R2 bucket (max 2MB)' })
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                file: {
                    type: 'string',
                    format: 'binary',
                    description: 'Image file to upload (max 2MB)',
                },
            },
            required: ['file'],
        },
    })
    @ApiResponse({
        status: 201,
        description: 'Image uploaded successfully',
        type: UploadFileResponseDto,
    })
    @ApiResponse({
        status: 400,
        description: 'Invalid file type or size exceeds 2MB',
    })
    @UseInterceptors(FileInterceptor('file'))
    async uploadImage(
        @UploadedFile() file: Express.Multer.File
    ): Promise<{ url: string }> {
        if (!file) {
            throw new BadRequestException('No file provided');
        }

        // Validate file type
        if (!file.mimetype.startsWith('image/')) {
            throw new BadRequestException(
                'Invalid file type. Only images are allowed.'
            );
        }

        // Validate file size (max 2MB)
        const maxSize = 2 * 1024 * 1024; // 2MB in bytes
        if (file.size > maxSize) {
            throw new BadRequestException(
                `File size exceeds 2MB limit. Current size: ${(file.size / (1024 * 1024)).toFixed(2)}MB`
            );
        }

        // Sanitize filename and create unique key
        const sanitizedFilename = sanitizeFilename(file.originalname);
        const key = `${Date.now()}-${sanitizedFilename}`;

        const fullKey = await this.r2Service.uploadFile(
            key,
            file.buffer,
            file.mimetype,
            'images' // Always store in images directory
        );

        const url = this.r2Service.getPublicUrl(fullKey);

        return { url };
    }

    @Get('files')
    @ApiOperation({ summary: 'List files in directory' })
    @ApiResponse({
        status: 200,
        description: 'Files retrieved successfully',
        type: ListFilesResponseDto,
    })
    async listFiles(
        @Query() listFilesDto: ListFilesDto
    ): Promise<ListFilesResponseDto> {
        const files = await this.r2Service.listFiles(
            listFilesDto.directory,
            listFilesDto.maxKeys
        );

        return {
            files,
            total: files.length,
        };
    }

    @Delete('file/*path')
    @ApiOperation({ summary: 'Delete a file from R2 bucket' })
    @ApiResponse({
        status: 200,
        description: 'File deleted successfully',
        type: DeleteFileResponseDto,
    })
    async deleteFile(
        @Param('path') key: string
    ): Promise<DeleteFileResponseDto> {
        await this.r2Service.deleteFile(key);
        return {
            message: 'File deleted successfully',
        };
    }

    @Delete('directory/*path')
    @ApiOperation({ summary: 'Delete entire directory and all files inside' })
    @ApiResponse({
        status: 200,
        description: 'Directory deleted successfully',
        type: DeleteDirectoryResponseDto,
    })
    async deleteDirectory(
        @Param('path') directory: string
    ): Promise<DeleteDirectoryResponseDto> {
        const deletedCount = await this.r2Service.deleteDirectory(directory);
        return {
            message: 'Directory deleted successfully',
            deletedCount,
        };
    }
}
