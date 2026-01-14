import { Controller, Get, UseGuards, Req, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { StatisticsService } from './statistics.service';
import { AuthGuard, AuthenticatedRequest } from '@examio/common';

@ApiTags('Statistics')
@Controller('statistics')
@ApiBearerAuth('access-token')
export class StatisticsController {
    constructor(private readonly statisticsService: StatisticsService) {}

    @Get('teacher')
    @UseGuards(AuthGuard)
    @ApiOperation({ summary: 'Get dashboard statistics for teachers' })
    @ApiQuery({ name: 'range', enum: ['7d', '30d'], required: false })
    async getTeacherStats(
        @Req() req: AuthenticatedRequest,
        @Query('range') range: '7d' | '30d' = '7d'
    ) {
        return this.statisticsService.getTeacherDashboardStats(req.user, range);
    }

    @Get('student')
    @UseGuards(AuthGuard)
    @ApiOperation({ summary: 'Get dashboard statistics for students' })
    @ApiQuery({ name: 'range', enum: ['7d', '30d'], required: false })
    async getStudentStats(
        @Req() req: AuthenticatedRequest,
        @Query('range') range: '7d' | '30d' = '7d'
    ) {
        return this.statisticsService.getStudentDashboardStats(req.user, range);
    }
}
