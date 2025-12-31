import {
    Controller,
    Post,
    Req,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiCookieAuth,
    ApiConsumes,
    ApiResponse,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard, AuthenticatedRequest } from '@examio/common';
import { R2UploadService } from './r2-upload.service';

@ApiTags('R2')
@Controller('r2')
export class R2Controller {
    constructor(private readonly r2UploadService: R2UploadService) {}

    @Post('image')
    @UseGuards(AuthGuard)
    @UseInterceptors(FileInterceptor('file'))
    @ApiCookieAuth('cookie-auth')
    @ApiConsumes('multipart/form-data')
    @ApiOperation({ summary: 'Upload image to R2 storage' })
    @ApiResponse({
        status: 201,
        description: 'Image uploaded successfully',
        schema: {
            properties: {
                url: { type: 'string', description: 'Public URL of the image' },
            },
        },
    })
    async uploadImage(
        @Req() req: AuthenticatedRequest,
        @UploadedFile() file: Express.Multer.File
    ) {
        if (!file || !file.buffer) {
            throw new BadRequestException('No file uploaded');
        }

        // Validate file type
        if (!file.mimetype.startsWith('image/')) {
            throw new BadRequestException('Only image files are allowed');
        }

        // Validate file size (max 2MB)
        const maxSize = 2 * 1024 * 1024;
        if (file.size > maxSize) {
            throw new BadRequestException(
                `File too large. Maximum size is 2MB, got ${(file.size / (1024 * 1024)).toFixed(2)}MB`
            );
        }

        const result = await this.r2UploadService.uploadImage(
            file,
            req.user?.id
        );

        return { url: result.url };
    }
}
