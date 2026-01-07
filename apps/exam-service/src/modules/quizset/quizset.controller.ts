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
    UseInterceptors,
    UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
    ApiTags,
    ApiResponse,
    ApiOperation,
    ApiExtraModels,
    ApiCookieAuth,
    ApiParam,
} from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '@examio/common';
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
import { GetQuestionsDto } from './dto/get-questions.dto';
import {
    CreateLabelDto,
    UpdateLabelDto,
    AssignQuestionsToLabelDto,
} from './dto/label.dto';

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
    @UseInterceptors(FileInterceptor('thumbnail'))
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Create a new quiz set' })
    @ApiResponse({
        status: 201,
        description: 'Quiz set created successfully',
        type: CreateQuizSetResponseDto,
    })
    async createQuizSet(
        @Req() req: AuthenticatedRequest,
        @UploadedFile() thumbnail?: Express.Multer.File
    ) {
        // Access body from req.body (Multer stores parsed fields here)
        const body = req.body;

        // Manually parse form data fields since @Body() doesn't work with multipart/form-data
        const createQuizsetDto: CreateQuizsetDto = {
            title: body.title,
            description: body.description,
            isPublic:
                body.isPublic !== undefined
                    ? body.isPublic === 'true' || body.isPublic === true
                    : undefined,
            isPinned:
                body.isPinned !== undefined
                    ? body.isPinned === 'true' || body.isPinned === true
                    : undefined,
            tags: body.tags
                ? typeof body.tags === 'string'
                    ? JSON.parse(body.tags)
                    : body.tags
                : undefined,
            thumbnail: body.thumbnail,
        };

        return this.quizsetService.createQuizSet(
            req.user,
            createQuizsetDto,
            thumbnail
        );
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

    @Get(':id/questions')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get paginated questions for a quiz set' })
    @ApiParam({ name: 'id', description: 'Quiz set ID' })
    @ApiResponse({
        status: 200,
        description: 'Questions retrieved successfully with pagination',
    })
    async getQuizSetQuestions(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Query() query: GetQuestionsDto
    ) {
        return this.quizsetService.getQuizSetQuestions(
            id,
            req.user,
            query.page,
            query.limit
        );
    }

    @Put(':id')
    @UseGuards(AuthGuard)
    @UseInterceptors(FileInterceptor('thumbnail'))
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
        @UploadedFile() thumbnail?: Express.Multer.File
    ) {
        // Access body from req.body (Multer stores parsed fields here)
        const body = req.body;

        // Manually parse form data fields since @Body() doesn't work with multipart/form-data
        const updateQuizSetDto: UpdateQuizSetDto = {
            title: body.title,
            description: body.description,
            isPublic:
                body.isPublic !== undefined
                    ? body.isPublic === 'true' || body.isPublic === true
                    : undefined,
            isPinned:
                body.isPinned !== undefined
                    ? body.isPinned === 'true' || body.isPinned === true
                    : undefined,
            tags: body.tags
                ? typeof body.tags === 'string'
                    ? JSON.parse(body.tags)
                    : body.tags
                : undefined,
            thumbnail: body.thumbnail,
        };

        return this.quizsetService.updateQuizSet(
            id,
            req.user,
            updateQuizSetDto,
            thumbnail
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

    @Get('list/all')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get all quiz sets without pagination' })
    @ApiResponse({
        status: 200,
        description: 'All quiz sets retrieved successfully',
        type: [Object],
    })
    async getAllQuizSets(@Req() req: AuthenticatedRequest) {
        console.log('🚀 ~ getAllQuizSets ~ req.user:', req.user);
        return this.quizsetService.getAllQuizSets(req.user);
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

    // ==================== LABEL CRUD ENDPOINTS ====================

    @Get(':quizSetId/labels')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get all labels for a quiz set' })
    @ApiParam({ name: 'quizSetId', description: 'Quiz set ID' })
    @ApiResponse({
        status: 200,
        description: 'Labels retrieved successfully',
    })
    async getLabels(
        @Req() req: AuthenticatedRequest,
        @Param('quizSetId') quizSetId: string
    ) {
        return this.quizsetService.getLabels(quizSetId, req.user);
    }

    @Post(':quizSetId/labels')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Create a new label for a quiz set' })
    @ApiParam({ name: 'quizSetId', description: 'Quiz set ID' })
    @ApiResponse({
        status: 201,
        description: 'Label created successfully',
    })
    async createLabel(
        @Req() req: AuthenticatedRequest,
        @Param('quizSetId') quizSetId: string,
        @Body() dto: CreateLabelDto
    ) {
        return this.quizsetService.createLabel(quizSetId, req.user, dto);
    }

    @Put(':quizSetId/labels/:labelId')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Update a label' })
    @ApiParam({ name: 'quizSetId', description: 'Quiz set ID' })
    @ApiParam({ name: 'labelId', description: 'Label ID' })
    @ApiResponse({
        status: 200,
        description: 'Label updated successfully',
    })
    async updateLabel(
        @Req() req: AuthenticatedRequest,
        @Param('quizSetId') quizSetId: string,
        @Param('labelId') labelId: string,
        @Body() dto: UpdateLabelDto
    ) {
        return this.quizsetService.updateLabel(
            quizSetId,
            labelId,
            req.user,
            dto
        );
    }

    @Delete(':quizSetId/labels/:labelId')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Delete a label' })
    @ApiParam({ name: 'quizSetId', description: 'Quiz set ID' })
    @ApiParam({ name: 'labelId', description: 'Label ID' })
    @ApiResponse({
        status: 200,
        description: 'Label deleted successfully',
    })
    async deleteLabel(
        @Req() req: AuthenticatedRequest,
        @Param('quizSetId') quizSetId: string,
        @Param('labelId') labelId: string
    ) {
        return this.quizsetService.deleteLabel(quizSetId, labelId, req.user);
    }

    @Post(':quizSetId/labels/:labelId/questions')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Assign questions to a label' })
    @ApiParam({ name: 'quizSetId', description: 'Quiz set ID' })
    @ApiParam({ name: 'labelId', description: 'Label ID' })
    @ApiResponse({
        status: 200,
        description: 'Questions assigned to label successfully',
    })
    async assignQuestionsToLabel(
        @Req() req: AuthenticatedRequest,
        @Param('quizSetId') quizSetId: string,
        @Param('labelId') labelId: string,
        @Body() dto: AssignQuestionsToLabelDto
    ) {
        return this.quizsetService.assignQuestionsToLabel(
            quizSetId,
            labelId,
            req.user,
            dto.questionIds
        );
    }

    @Delete(':quizSetId/labels/:labelId/questions')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Remove questions from a label' })
    @ApiParam({ name: 'quizSetId', description: 'Quiz set ID' })
    @ApiParam({ name: 'labelId', description: 'Label ID' })
    @ApiResponse({
        status: 200,
        description: 'Questions removed from label successfully',
    })
    async removeQuestionsFromLabel(
        @Req() req: AuthenticatedRequest,
        @Param('quizSetId') quizSetId: string,
        @Param('labelId') labelId: string,
        @Body() dto: AssignQuestionsToLabelDto
    ) {
        return this.quizsetService.removeQuestionsFromLabel(
            quizSetId,
            labelId,
            req.user,
            dto.questionIds
        );
    }

    @Get(':quizSetId/labels/:labelId/questions')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get questions by label' })
    @ApiParam({ name: 'quizSetId', description: 'Quiz set ID' })
    @ApiParam({
        name: 'labelId',
        description: 'Label ID (use "unlabeled" for questions without label)',
    })
    @ApiResponse({
        status: 200,
        description: 'Questions retrieved successfully',
    })
    async getQuestionsByLabel(
        @Req() req: AuthenticatedRequest,
        @Param('quizSetId') quizSetId: string,
        @Param('labelId') labelId: string,
        @Query() query: GetQuestionsDto
    ) {
        // Handle special "unlabeled" value
        const actualLabelId = labelId === 'unlabeled' ? null : labelId;
        return this.quizsetService.getQuestionsByLabel(
            quizSetId,
            actualLabelId,
            req.user,
            query.page,
            query.limit
        );
    }
}
