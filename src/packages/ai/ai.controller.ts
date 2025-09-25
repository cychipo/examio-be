import {
    Controller,
    Post,
    Body,
    UseInterceptors,
    UploadedFile,
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
    @UseInterceptors(FileInterceptor('file'))
    @ApiOperation({ summary: 'Extract and embed text from an uploaded file' })
    @ApiResponse({
        status: 200,
        description: 'File processed successfully',
        type: String,
    })
    @ApiFile('file')
    async filePrompt(@UploadedFile() file: Express.Multer.File) {
        return this.aiService.embedTextFromFile(file);
    }
}
