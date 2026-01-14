import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { StudentService } from './student.service';
import { AuthGuard, AuthenticatedRequest } from '@examio/common';

@ApiTags('Student')
@Controller('student')
@ApiBearerAuth('access-token')
export class StudentController {
    constructor(private readonly studentService: StudentService) {}

    @Get('recent-flashcards')
    @UseGuards(AuthGuard)
    @ApiOperation({ summary: 'Get recent flashcard sets viewed by student' })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    async getRecentFlashcards(
        @Req() req: AuthenticatedRequest,
        @Query('limit') limit?: string
    ) {
        const parsedLimit = limit ? parseInt(limit, 10) : 10;
        return this.studentService.getRecentFlashcards(req.user.id, parsedLimit);
    }

    @Get('recent-exams')
    @UseGuards(AuthGuard)
    @ApiOperation({ summary: 'Get recent exam attempts by student' })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    async getRecentExams(
        @Req() req: AuthenticatedRequest,
        @Query('limit') limit?: string
    ) {
        const parsedLimit = limit ? parseInt(limit, 10) : 10;
        return this.studentService.getRecentExams(req.user.id, parsedLimit);
    }
}
