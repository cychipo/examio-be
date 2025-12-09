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
import { OptionalAuthGuard } from 'src/common/guard/optional-auth.guard';
import { AuthenticatedRequest } from 'src/packages/auth/dto/request-with-auth.dto';
import { ExamSessionService } from './examsession.service';
import { CreateExamSessionDto } from './dto/create-examsession.dto';
import { UpdateExamSessionDto } from './dto/update-examsession.dto';
import { GetExamSessionsDto } from './dto/get-examsession.dto';
import {
    ExamSessionUpdateSharingSettingsDto,
    ExamSessionVerifyAccessCodeDto,
    ExamSessionAccessCheckResponseDto,
    ExamSessionVerifyCodeResponseDto,
    ExamSessionSharingSettingsResponseDto,
    ExamSessionPublicInfoDto,
} from './dto/sharing.dto';

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
        @Query() getExamSessionsDto: GetExamSessionsDto
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

    // ==================== ACCESS CONTROL ENDPOINTS ====================

    @Get('study/:id/access')
    @UseGuards(OptionalAuthGuard)
    @ApiOperation({ summary: 'Check access for an exam session' })
    @ApiParam({ name: 'id', description: 'Exam session ID' })
    @ApiResponse({
        status: 200,
        description: 'Access check result',
        type: ExamSessionAccessCheckResponseDto,
    })
    async checkAccess(
        @Param('id') id: string,
        @Req() req: AuthenticatedRequest
    ) {
        return this.examSessionService.checkAccess(id, req.user?.id);
    }

    @Get('study/:id/info')
    @ApiOperation({ summary: 'Get public info for an exam session' })
    @ApiParam({ name: 'id', description: 'Exam session ID' })
    @ApiResponse({
        status: 200,
        description: 'Exam session public info',
        type: ExamSessionPublicInfoDto,
    })
    async getPublicInfo(@Param('id') id: string) {
        return this.examSessionService.getExamSessionPublicInfo(id);
    }

    @Get('study/:id')
    @UseGuards(OptionalAuthGuard)
    @ApiOperation({ summary: 'Get exam session for study with access check' })
    @ApiParam({ name: 'id', description: 'Exam session ID' })
    @ApiResponse({
        status: 200,
        description: 'Exam session for study',
        type: Object,
    })
    async getForStudy(
        @Param('id') id: string,
        @Req() req: AuthenticatedRequest
    ) {
        return this.examSessionService.getExamSessionForStudy(id, req.user?.id);
    }

    @Post('study/:id/verify-code')
    @ApiOperation({ summary: 'Verify access code for a private exam session' })
    @ApiParam({ name: 'id', description: 'Exam session ID' })
    @ApiResponse({
        status: 200,
        description: 'Code verification result',
        type: ExamSessionVerifyCodeResponseDto,
    })
    async verifyCode(
        @Param('id') id: string,
        @Body() dto: ExamSessionVerifyAccessCodeDto
    ) {
        return this.examSessionService.verifyAccessCode(id, dto.accessCode);
    }

    @Post('study/:id/with-code')
    @ApiOperation({ summary: 'Get exam session using access code' })
    @ApiParam({ name: 'id', description: 'Exam session ID' })
    @ApiResponse({
        status: 200,
        description: 'Exam session for study',
        type: Object,
    })
    async getWithCode(
        @Param('id') id: string,
        @Body() dto: ExamSessionVerifyAccessCodeDto
    ) {
        return this.examSessionService.getExamSessionWithCode(
            id,
            dto.accessCode
        );
    }

    @Get(':id/sharing')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get sharing settings for an exam session' })
    @ApiParam({ name: 'id', description: 'Exam session ID' })
    @ApiResponse({
        status: 200,
        description: 'Sharing settings',
    })
    async getSharingSettings(
        @Param('id') id: string,
        @Req() req: AuthenticatedRequest
    ) {
        return this.examSessionService.getSharingSettings(id, req.user);
    }

    @Put(':id/sharing')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Update sharing settings for an exam session' })
    @ApiParam({ name: 'id', description: 'Exam session ID' })
    @ApiResponse({
        status: 200,
        description: 'Sharing settings updated',
        type: ExamSessionSharingSettingsResponseDto,
    })
    async updateSharingSettings(
        @Param('id') id: string,
        @Req() req: AuthenticatedRequest,
        @Body() dto: ExamSessionUpdateSharingSettingsDto
    ) {
        return this.examSessionService.updateSharingSettings(id, req.user, dto);
    }

    @Post(':id/generate-code')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Generate a new access code' })
    @ApiParam({ name: 'id', description: 'Exam session ID' })
    @ApiResponse({
        status: 200,
        description: 'New access code generated',
    })
    async generateCode(
        @Param('id') id: string,
        @Req() req: AuthenticatedRequest
    ) {
        const accessCode = this.examSessionService.generateAccessCode();
        await this.examSessionService.updateSharingSettings(id, req.user, {
            isPublic: false,
            accessCode,
            whitelist: [],
        });
        return { accessCode };
    }

    @Get('users/search')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Search users by username for whitelist' })
    @ApiResponse({
        status: 200,
        description: 'List of matching users',
    })
    async searchUsers(
        @Query('q') query: string,
        @Req() req: AuthenticatedRequest
    ) {
        return this.examSessionService.searchUsers(query, req.user.id);
    }
}
