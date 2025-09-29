import {
    Controller,
    Post,
    Body,
    UseInterceptors,
    UploadedFile,
    UseGuards,
    Req,
} from '@nestjs/common';
import { AIService } from './ai.service';
import {
    ApiTags,
    ApiResponse,
    ApiOperation,
    ApiExtraModels,
    ApiBearerAuth,
    ApiConsumes,
    ApiBody,
} from '@nestjs/swagger';
import { GenerateDto } from './dto/generate.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiFile } from 'src/common/decorators/file-upload.decorator';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { AuthenticatedRequest } from '../auth/dto/request-with-auth.dto';

@ApiTags('AI')
@ApiExtraModels()
@Controller('ai')
export class AIController {
    constructor(private aiService: AIService) {}

    @Post('generate')
    @ApiOperation({ summary: 'Generate content based on a prompt' })
    @ApiResponse({
        status: 200,
        description: 'Content generated successfully',
        type: String,
    })
    async generate(@Body() generateDto: GenerateDto) {
        return this.aiService.generateContent(generateDto.prompt);
    }

    @Post('embedde-file')
    @UseGuards(AuthGuard)
    @ApiBearerAuth('JWT')
    @UseInterceptors(FileInterceptor('file'))
    @ApiOperation({ summary: 'Extract and embed text from an uploaded file' })
    @ApiResponse({
        status: 200,
        description: 'File processed successfully',
        type: String,
    })
    @ApiFile('file')
    async filePrompt(
        @UploadedFile() file: Express.Multer.File,
        @Req() req: AuthenticatedRequest,
        @Body()
        {
            quantityFlashcard,
            quantityQuizz,
            typeResult,
            isNarrowSearch,
            keyword,
        }: {
            quantityFlashcard?: number;
            quantityQuizz?: number;
            typeResult: number;
            isNarrowSearch?: boolean;
            keyword?: string;
        }
    ) {
        return this.aiService.handleActionsWithFile(
            file,
            req.user,
            typeResult,
            quantityFlashcard,
            quantityQuizz,
            isNarrowSearch,
            keyword
        );
    }
}
