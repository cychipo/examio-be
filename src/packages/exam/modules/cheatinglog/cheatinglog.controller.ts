import {
    Controller,
    Post,
    Get,
    Body,
    Param,
    UseGuards,
    Req,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiCookieAuth,
    ApiParam,
} from '@nestjs/swagger';
import { CheatingLogService } from './cheatinglog.service';
import { CreateCheatingLogDto } from './dto/create-cheatinglog.dto';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { AuthenticatedRequest } from 'src/packages/auth/dto/request-with-auth.dto';

@ApiTags('Cheating Logs')
@Controller('cheatinglogs')
export class CheatingLogController {
    constructor(private readonly cheatingLogService: CheatingLogService) {}

    @Post()
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Log a cheating violation' })
    async logViolation(
        @Req() req: AuthenticatedRequest,
        @Body() dto: CreateCheatingLogDto
    ) {
        return this.cheatingLogService.logViolation(req.user, dto);
    }

    @Get('attempt/:id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get cheating logs for an attempt (host only)' })
    @ApiParam({ name: 'id', description: 'Exam attempt ID' })
    async getAttemptLogs(
        @Req() req: AuthenticatedRequest,
        @Param('id') attemptId: string
    ) {
        return this.cheatingLogService.getAttemptLogs(attemptId, req.user);
    }

    @Get('session/:id/stats')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get cheating stats for a session (host only)' })
    @ApiParam({ name: 'id', description: 'Exam session ID' })
    async getSessionStats(
        @Req() req: AuthenticatedRequest,
        @Param('id') sessionId: string
    ) {
        return this.cheatingLogService.getSessionStats(sessionId, req.user);
    }

    @Get('session/:sessionId/user/:userId')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary:
            'Get all attempts for a user in a session with cheating logs (host only)',
    })
    @ApiParam({ name: 'sessionId', description: 'Exam session ID' })
    @ApiParam({ name: 'userId', description: 'User ID' })
    async getUserAttemptsWithLogs(
        @Req() req: AuthenticatedRequest,
        @Param('sessionId') sessionId: string,
        @Param('userId') userId: string
    ) {
        return this.cheatingLogService.getUserAttemptsWithLogs(
            sessionId,
            userId,
            req.user
        );
    }
}
