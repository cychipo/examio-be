import {
    Controller,
    Post,
    Body,
    UseGuards,
    Req,
    Get,
    Put,
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
    ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '@examio/common';
import { QuizPracticeAttemptService } from './quiz-practice-attempt.service';
import {
    CreateQuizPracticeAttemptDto,
    UpdateQuizPracticeAttemptDto,
    QuizPracticeAttemptDto,
    GetOrCreateAttemptResponseDto,
    SubmitAttemptResponseDto,
    ResetAttemptResponseDto,
} from './dto';

@ApiTags('Quiz Practice Attempts')
@ApiExtraModels(
    CreateQuizPracticeAttemptDto,
    UpdateQuizPracticeAttemptDto,
    QuizPracticeAttemptDto,
    GetOrCreateAttemptResponseDto,
    SubmitAttemptResponseDto,
    ResetAttemptResponseDto
)
@Controller('quiz-practice-attempts')
export class QuizPracticeAttemptController {
    constructor(private readonly attemptService: QuizPracticeAttemptService) {}

    @Post()
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Lấy hoặc tạo phiên làm bài',
        description:
            'Nếu đã có phiên làm bài chưa nộp thì trả về, ngược lại tạo mới',
    })
    @ApiResponse({
        status: 201,
        description: 'Phiên làm bài được lấy/tạo thành công',
        type: GetOrCreateAttemptResponseDto,
    })
    async getOrCreateAttempt(
        @Req() req: AuthenticatedRequest,
        @Body() dto: CreateQuizPracticeAttemptDto
    ) {
        return this.attemptService.getOrCreateAttempt(req.user, dto);
    }

    @Get('by-quizset/:quizSetId')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Lấy phiên làm bài theo quizSetId và type',
    })
    @ApiParam({ name: 'quizSetId', description: 'ID của bộ đề' })
    @ApiQuery({
        name: 'type',
        required: false,
        description: '0: PRACTICE, 1: REAL',
    })
    @ApiResponse({
        status: 200,
        description: 'Phiên làm bài (có thể null nếu chưa có)',
        type: QuizPracticeAttemptDto,
    })
    async getAttemptByQuizSet(
        @Req() req: AuthenticatedRequest,
        @Param('quizSetId') quizSetId: string,
        @Query('type') type?: string
    ) {
        const attemptType = type ? parseInt(type, 10) : 0;
        return this.attemptService.getAttemptByQuizSetAndType(
            quizSetId,
            attemptType,
            req.user
        );
    }

    @Get(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Lấy chi tiết phiên làm bài' })
    @ApiParam({ name: 'id', description: 'ID của phiên làm bài' })
    @ApiResponse({
        status: 200,
        description: 'Chi tiết phiên làm bài',
        type: QuizPracticeAttemptDto,
    })
    async getAttemptById(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.attemptService.getAttemptById(id, req.user);
    }

    @Put(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Cập nhật phiên làm bài',
        description:
            'Dùng để auto-save answers, currentIndex, timeSpent (debounced)',
    })
    @ApiParam({ name: 'id', description: 'ID của phiên làm bài' })
    @ApiResponse({
        status: 200,
        description: 'Cập nhật thành công',
    })
    async updateAttempt(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Body() dto: UpdateQuizPracticeAttemptDto
    ) {
        return this.attemptService.updateAttempt(id, req.user, dto);
    }

    @Post(':id/submit')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Nộp bài',
        description: 'Tính điểm và đánh dấu đã nộp',
    })
    @ApiParam({ name: 'id', description: 'ID của phiên làm bài' })
    @ApiResponse({
        status: 200,
        description: 'Nộp bài thành công',
        type: SubmitAttemptResponseDto,
    })
    async submitAttempt(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.attemptService.submitAttempt(id, req.user);
    }

    @Post(':id/reset')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Reset để làm lại',
        description: 'Chỉ có thể reset sau khi đã nộp bài',
    })
    @ApiParam({ name: 'id', description: 'ID của phiên làm bài' })
    @ApiResponse({
        status: 200,
        description: 'Reset thành công',
        type: ResetAttemptResponseDto,
    })
    async resetAttempt(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Body() body?: { timeLimitMinutes?: number | null }
    ) {
        return this.attemptService.resetAttempt(
            id,
            req.user,
            body?.timeLimitMinutes
        );
    }

    @Get('stats/completion-rate')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Lấy tỷ lệ hoàn thành trung bình',
    })
    @ApiResponse({
        status: 200,
        description: 'Tỷ lệ hoàn thành trung bình (%)',
    })
    async getCompletionRate(@Req() req: AuthenticatedRequest) {
        const rate = await this.attemptService.getAverageCompletionRate(
            req.user
        );
        return { completionRate: rate };
    }
}
