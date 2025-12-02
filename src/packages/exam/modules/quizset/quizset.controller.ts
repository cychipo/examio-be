import {
    Controller,
    Post,
    Body,
    UseGuards,
    Req,
    Get,
    Res,
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
import { QuizsetService } from './quizset.service';
import { CreateQuizsetDto } from './dto/create-quizset.dto';
import { UpdateQuizSetDto } from './dto/update-quizset.dto';
import { GetQuizsetsDto } from './dto/get-quizset.dto';
import { SetQuizzToQuizsetDto } from './dto/set-quizz-to-quizset.dto';
import { SaveHistoryToQuizsetDto } from './dto/save-history-to-quizset.dto';
import {
    CreateQuizSetResponseDto,
    UpdateQuizSetResponseDto,
    GetQuizSetsResponseDto,
    DeleteQuizSetResponseDto,
    SetQuizzesToQuizSetResponseDto,
    QuizSetDto,
} from './dto/quizset-response.dto';
import {
    CreateQuestionDto,
    UpdateQuestionDto,
    CreateQuestionResponseDto,
    UpdateQuestionResponseDto,
    DeleteQuestionResponseDto,
} from './dto/question.dto';

@ApiTags('Quizsets')
@ApiExtraModels(
    CreateQuizsetDto,
    UpdateQuizSetDto,
    GetQuizsetsDto,
    CreateQuizSetResponseDto,
    UpdateQuizSetResponseDto,
    GetQuizSetsResponseDto,
    DeleteQuizSetResponseDto,
    SetQuizzesToQuizSetResponseDto,
    QuizSetDto
)
@Controller('quizsets')
export class QuizsetController {
    constructor(private readonly quizsetService: QuizsetService) {}

    @Post()
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Create a new quiz set' })
    @ApiResponse({
        status: 201,
        description: 'Quiz set created successfully',
        type: CreateQuizSetResponseDto,
    })
    async createQuizSet(
        @Req() req: AuthenticatedRequest,
        @Body() createQuizsetDto: CreateQuizsetDto
    ) {
        return this.quizsetService.createQuizSet(req.user, createQuizsetDto);
    }

    @Get('stats')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get quiz set statistics' })
    @ApiResponse({
        status: 200,
        description: 'Quiz set statistics retrieved successfully',
    })
    async getQuizSetStats(@Req() req: AuthenticatedRequest) {
        return this.quizsetService.getQuizSetStats(req.user);
    }

    @Get(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get a quiz set by ID' })
    @ApiResponse({
        status: 200,
        description: 'Quiz set retrieved successfully',
        type: QuizSetDto,
    })
    async getQuizSetById(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.quizsetService.getQuizSetById(id, req.user);
    }

    @Put(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Update a quiz set by ID' })
    @ApiResponse({
        status: 200,
        description: 'Quiz set updated successfully',
        type: UpdateQuizSetResponseDto,
    })
    async updateQuizSet(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Body() updateQuizSetDto: UpdateQuizSetDto
    ) {
        return this.quizsetService.updateQuizSet(
            id,
            req.user,
            updateQuizSetDto
        );
    }

    @Get()
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get a list of quiz sets' })
    @ApiResponse({
        status: 200,
        description: 'Quiz sets retrieved successfully',
        type: GetQuizSetsResponseDto,
    })
    async getQuizSets(
        @Req() req: AuthenticatedRequest,
        @Query() getQuizsetsDto: GetQuizsetsDto
    ) {
        return this.quizsetService.getQuizSets(req.user, getQuizsetsDto);
    }

    @Delete(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Delete a quiz set by ID' })
    @ApiResponse({
        status: 200,
        description: 'Quiz set deleted successfully',
        type: DeleteQuizSetResponseDto,
    })
    async deleteQuizSet(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.quizsetService.deleteQuizSet(id, req.user);
    }

    @Get('public/:id')
    @ApiOperation({ summary: 'Get a public quiz set by ID' })
    @ApiResponse({
        status: 200,
        description: 'Public quiz set retrieved successfully',
        type: QuizSetDto,
    })
    async getPublicQuizSetById(@Param('id') id: string) {
        return this.quizsetService.getQuizSetPublicById(id);
    }

    @Post('set-quizzes-to-quizset')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Set quizz to quizset' })
    @ApiResponse({
        status: 200,
        description: 'Set quizz to quizset successfully',
        type: SetQuizzesToQuizSetResponseDto,
    })
    async setQuizzToQuizset(
        @Req() req: AuthenticatedRequest,
        @Body() dto: SetQuizzToQuizsetDto
    ) {
        return this.quizsetService.setQuizzsToQuizSet(req.user, dto);
    }

    @Post('save-history-to-quizset')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Save history generated quizzes to quizset' })
    @ApiResponse({
        status: 200,
        description: 'Save history to quizset successfully',
        type: SetQuizzesToQuizSetResponseDto,
    })
    async saveHistoryToQuizset(
        @Req() req: AuthenticatedRequest,
        @Body() dto: SaveHistoryToQuizsetDto
    ) {
        return this.quizsetService.saveHistoryToQuizSet(req.user, dto);
    }

    // ==================== QUESTION CRUD ENDPOINTS ====================

    @Post(':quizSetId/questions')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Add a question to a quiz set' })
    @ApiParam({ name: 'quizSetId', description: 'Quiz set ID' })
    @ApiResponse({
        status: 201,
        description: 'Question added successfully',
        type: CreateQuestionResponseDto,
    })
    async addQuestion(
        @Req() req: AuthenticatedRequest,
        @Param('quizSetId') quizSetId: string,
        @Body() dto: CreateQuestionDto
    ) {
        return this.quizsetService.addQuestionToQuizSet(
            quizSetId,
            req.user,
            dto
        );
    }

    @Put(':quizSetId/questions/:questionId')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Update a question in a quiz set' })
    @ApiParam({ name: 'quizSetId', description: 'Quiz set ID' })
    @ApiParam({ name: 'questionId', description: 'Question ID' })
    @ApiResponse({
        status: 200,
        description: 'Question updated successfully',
        type: UpdateQuestionResponseDto,
    })
    async updateQuestion(
        @Req() req: AuthenticatedRequest,
        @Param('quizSetId') quizSetId: string,
        @Param('questionId') questionId: string,
        @Body() dto: UpdateQuestionDto
    ) {
        return this.quizsetService.updateQuestionInQuizSet(
            quizSetId,
            questionId,
            req.user,
            dto
        );
    }

    @Delete(':quizSetId/questions/:questionId')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Delete a question from a quiz set' })
    @ApiParam({ name: 'quizSetId', description: 'Quiz set ID' })
    @ApiParam({ name: 'questionId', description: 'Question ID' })
    @ApiResponse({
        status: 200,
        description: 'Question deleted successfully',
        type: DeleteQuestionResponseDto,
    })
    async deleteQuestion(
        @Req() req: AuthenticatedRequest,
        @Param('quizSetId') quizSetId: string,
        @Param('questionId') questionId: string
    ) {
        return this.quizsetService.deleteQuestionFromQuizSet(
            quizSetId,
            questionId,
            req.user
        );
    }
}
