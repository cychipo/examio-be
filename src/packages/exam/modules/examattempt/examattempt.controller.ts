import {
    Controller,
    Post,
    Body,
    UseGuards,
    Req,
    Get,
    Put,
    Delete,
    Param,
} from '@nestjs/common';
import {
    ApiTags,
    ApiResponse,
    ApiOperation,
    ApiExtraModels,
    ApiCookieAuth,
    ApiParam,
} from '@nestjs/swagger';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { AuthenticatedRequest } from 'src/packages/auth/dto/request-with-auth.dto';
import { ExamAttemptService } from './examattempt.service';
import { CreateExamAttemptDto } from './dto/create-examattempt.dto';
import { UpdateExamAttemptDto } from './dto/update-examattempt.dto';
import { GetExamAttemptsDto } from './dto/get-examattempt.dto';

@ApiTags('ExamAttempts')
@ApiExtraModels(CreateExamAttemptDto, UpdateExamAttemptDto, GetExamAttemptsDto)
@Controller('examattempts')
export class ExamAttemptController {
    constructor(private readonly examAttemptService: ExamAttemptService) {}

    @Post()
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Start a new exam attempt' })
    @ApiResponse({
        status: 201,
        description: 'Exam attempt created successfully',
        type: Object,
    })
    async createExamAttempt(
        @Req() req: AuthenticatedRequest,
        @Body() createExamAttemptDto: CreateExamAttemptDto
    ) {
        return this.examAttemptService.createExamAttempt(
            req.user,
            createExamAttemptDto
        );
    }

    @Get('get-by-id/:id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get an exam attempt by ID' })
    @ApiParam({ name: 'id', description: 'Exam attempt ID' })
    @ApiResponse({
        status: 200,
        description: 'Exam attempt retrieved successfully',
        type: Object,
    })
    async getExamAttemptById(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.examAttemptService.getExamAttemptById(id, req.user);
    }

    @Put(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Update an exam attempt by ID' })
    @ApiParam({ name: 'id', description: 'Exam attempt ID' })
    @ApiResponse({
        status: 200,
        description: 'Exam attempt updated successfully',
        type: Object,
    })
    async updateExamAttempt(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Body() updateExamAttemptDto: UpdateExamAttemptDto
    ) {
        return this.examAttemptService.updateExamAttempt(
            id,
            req.user,
            updateExamAttemptDto
        );
    }

    @Get('list')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get a list of exam attempts' })
    @ApiResponse({
        status: 200,
        description: 'Exam attempts retrieved successfully',
        type: [Object],
    })
    async getExamAttempts(
        @Req() req: AuthenticatedRequest,
        @Body() getExamAttemptsDto: GetExamAttemptsDto
    ) {
        return this.examAttemptService.getExamAttempts(
            req.user,
            getExamAttemptsDto
        );
    }

    @Delete(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Delete an exam attempt by ID' })
    @ApiParam({ name: 'id', description: 'Exam attempt ID' })
    @ApiResponse({
        status: 200,
        description: 'Exam attempt deleted successfully',
        type: Object,
    })
    async deleteExamAttempt(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.examAttemptService.deleteExamAttempt(id, req.user);
    }
}
