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
import { ExamSessionService } from './examsession.service';
import { CreateExamSessionDto } from './dto/create-examsession.dto';
import { UpdateExamSessionDto } from './dto/update-examsession.dto';
import { GetExamSessionsDto } from './dto/get-examsession.dto';

@ApiTags('ExamSessions')
@ApiExtraModels(CreateExamSessionDto, UpdateExamSessionDto, GetExamSessionsDto)
@Controller('examsessions')
export class ExamSessionController {
    constructor(private readonly examSessionService: ExamSessionService) {}

    @Post()
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Create a new exam session' })
    @ApiResponse({
        status: 201,
        description: 'Exam session created successfully',
        type: Object,
    })
    async createExamSession(
        @Req() req: AuthenticatedRequest,
        @Body() createExamSessionDto: CreateExamSessionDto
    ) {
        return this.examSessionService.createExamSession(
            req.user,
            createExamSessionDto
        );
    }

    @Get('get-by-id/:id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get an exam session by ID' })
    @ApiParam({ name: 'id', description: 'Exam session ID' })
    @ApiResponse({
        status: 200,
        description: 'Exam session retrieved successfully',
        type: Object,
    })
    async getExamSessionById(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.examSessionService.getExamSessionById(id, req.user);
    }

    @Put(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Update an exam session by ID' })
    @ApiParam({ name: 'id', description: 'Exam session ID' })
    @ApiResponse({
        status: 200,
        description: 'Exam session updated successfully',
        type: Object,
    })
    async updateExamSession(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Body() updateExamSessionDto: UpdateExamSessionDto
    ) {
        return this.examSessionService.updateExamSession(
            id,
            req.user,
            updateExamSessionDto
        );
    }

    @Get('list')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get a list of exam sessions' })
    @ApiResponse({
        status: 200,
        description: 'Exam sessions retrieved successfully',
        type: [Object],
    })
    async getExamSessions(
        @Req() req: AuthenticatedRequest,
        @Body() getExamSessionsDto: GetExamSessionsDto
    ) {
        return this.examSessionService.getExamSessions(
            req.user,
            getExamSessionsDto
        );
    }

    @Delete(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Delete an exam session by ID' })
    @ApiParam({ name: 'id', description: 'Exam session ID' })
    @ApiResponse({
        status: 200,
        description: 'Exam session deleted successfully',
        type: Object,
    })
    async deleteExamSession(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.examSessionService.deleteExamSession(id, req.user);
    }

    @Get('get-public/:id')
    @ApiOperation({ summary: 'Get a public exam session by ID' })
    @ApiParam({ name: 'id', description: 'Exam session ID' })
    @ApiResponse({
        status: 200,
        description: 'Public exam session retrieved successfully',
        type: Object,
    })
    async getPublicExamSessionById(@Param('id') id: string) {
        return this.examSessionService.getExamSessionPublicById(id);
    }
}
