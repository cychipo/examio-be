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
} from '@nestjs/common';
import {
    ApiTags,
    ApiResponse,
    ApiOperation,
    ApiExtraModels,
    ApiCookieAuth,
} from '@nestjs/swagger';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { AuthenticatedRequest } from 'src/packages/auth/dto/request-with-auth.dto';
import { QuizsetService } from './quizset.service';
import { CreateQuizsetDto } from './dto/create-quizset.dto';
import { UpdateQuizSetDto } from './dto/update-quizset.dto';
import { GetQuizsetsDto } from './dto/get-quizset.dto';

@ApiTags('Quizsets')
@ApiExtraModels(CreateQuizsetDto, UpdateQuizSetDto, GetQuizsetsDto)
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
        type: Object,
    })
    async createQuizSet(
        @Req() req: AuthenticatedRequest,
        @Body() createQuizsetDto: CreateQuizsetDto
    ) {
        return this.quizsetService.createQuizSet(req.user, createQuizsetDto);
    }

    @Get('get-by-id/:id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get a quiz set by ID' })
    @ApiResponse({
        status: 200,
        description: 'Quiz set retrieved successfully',
        type: Object,
    })
    async getQuizSetById(
        @Req() req: AuthenticatedRequest,
        @Body('id') id: string
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
        type: Object,
    })
    async updateQuizSet(
        @Req() req: AuthenticatedRequest,
        @Body('id') id: string,
        @Body() updateQuizSetDto: UpdateQuizSetDto
    ) {
        return this.quizsetService.updateQuizSet(
            id,
            req.user,
            updateQuizSetDto
        );
    }

    @Get('list')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get a list of quiz sets' })
    @ApiResponse({
        status: 200,
        description: 'Quiz sets retrieved successfully',
        type: [Object],
    })
    async getQuizSets(
        @Req() req: AuthenticatedRequest,
        @Body() getQuizsetsDto: GetQuizsetsDto
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
        type: Object,
    })
    async deleteQuizSet(
        @Req() req: AuthenticatedRequest,
        @Body('id') id: string
    ) {
        return this.quizsetService.deleteQuizSet(id, req.user);
    }

    @Get('get-public/:id')
    @ApiOperation({ summary: 'Get a public quiz set by ID' })
    @ApiResponse({
        status: 200,
        description: 'Public quiz set retrieved successfully',
        type: Object,
    })
    async getPublicQuizSetById(@Body('id') id: string) {
        return this.quizsetService.getQuizSetPublicById(id);
    }
}
