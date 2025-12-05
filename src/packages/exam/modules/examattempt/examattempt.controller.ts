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
    Query,
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

    // ==================== NEW QUIZ ENDPOINTS ====================

    @Post('start')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Start or resume an exam attempt (with retry limit check)',
    })
    @ApiResponse({
        status: 201,
        description: 'Exam attempt started or resumed successfully',
        type: Object,
    })
    async startExamAttempt(
        @Req() req: AuthenticatedRequest,
        @Body() dto: CreateExamAttemptDto
    ) {
        return this.examAttemptService.startExamAttempt(req.user, dto);
    }

    @Put(':id/progress')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Update exam attempt progress (auto-save)' })
    @ApiParam({ name: 'id', description: 'Exam attempt ID' })
    @ApiResponse({
        status: 200,
        description: 'Progress updated successfully',
        type: Object,
    })
    async updateExamAttemptProgress(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Body()
        dto: {
            answers?: Record<string, string>;
            currentIndex?: number;
            markedQuestions?: string[];
        }
    ) {
        return this.examAttemptService.updateExamAttemptProgress(
            id,
            req.user,
            dto
        );
    }

    @Post(':id/submit')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Submit exam attempt and calculate score' })
    @ApiParam({ name: 'id', description: 'Exam attempt ID' })
    @ApiResponse({
        status: 200,
        description: 'Exam attempt submitted successfully',
        type: Object,
    })
    async submitExamAttempt(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.examAttemptService.submitExamAttempt(id, req.user);
    }

    @Get(':id/quiz')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get exam attempt with questions for quiz view' })
    @ApiParam({ name: 'id', description: 'Exam attempt ID' })
    @ApiResponse({
        status: 200,
        description: 'Exam attempt with questions retrieved successfully',
        type: Object,
    })
    async getExamAttemptForQuiz(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.examAttemptService.getExamAttemptForQuiz(id, req.user);
    }

    @Get('list-by-room/:examRoomId')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Get all exam attempts for an exam room (owner only)',
    })
    @ApiParam({ name: 'examRoomId', description: 'Exam room ID' })
    @ApiResponse({
        status: 200,
        description: 'List of exam attempts with user details',
        type: Object,
    })
    async getExamAttemptsByRoom(
        @Req() req: AuthenticatedRequest,
        @Param('examRoomId') examRoomId: string,
        @Query('page') page: string = '1',
        @Query('limit') limit: string = '10'
    ) {
        return this.examAttemptService.getExamAttemptsByRoom(
            examRoomId,
            req.user,
            parseInt(page, 10) || 1,
            parseInt(limit, 10) || 10
        );
    }

    @Get(':id/detail')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Get exam attempt details for slider view (owner only)',
    })
    @ApiParam({ name: 'id', description: 'Exam attempt ID' })
    @ApiResponse({
        status: 200,
        description: 'Exam attempt details',
        type: Object,
    })
    async getExamAttemptDetail(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.examAttemptService.getExamAttemptDetailForSlider(
            id,
            req.user
        );
    }

    // ==================== EXISTING ENDPOINTS ====================

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
        @Query() getExamAttemptsDto: GetExamAttemptsDto
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
