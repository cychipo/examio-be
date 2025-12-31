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
    ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard, AuthenticatedRequest } from '@examio/common';
import { ExamRoomService } from './examroom.service';
import { CreateExamRoomDto } from './dto/create-examroom.dto';
import { UpdateExamRoomDto } from './dto/update-examroom.dto';
import { GetExamRoomsDto } from './dto/get-examroom.dto';

@ApiTags('ExamRooms')
@ApiExtraModels(CreateExamRoomDto, UpdateExamRoomDto, GetExamRoomsDto)
@Controller('examrooms')
export class ExamRoomController {
    constructor(private readonly examRoomService: ExamRoomService) {}

    @Post()
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Create a new exam room' })
    @ApiResponse({
        status: 201,
        description: 'Exam room created successfully',
        type: Object,
    })
    async createExamRoom(
        @Req() req: AuthenticatedRequest,
        @Body() createExamRoomDto: CreateExamRoomDto
    ) {
        return this.examRoomService.createExamRoom(req.user, createExamRoomDto);
    }

    @Get('detail/:id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get an exam room by ID' })
    @ApiParam({ name: 'id', description: 'Exam room ID' })
    @ApiResponse({
        status: 200,
        description: 'Exam room retrieved successfully',
        type: Object,
    })
    async getExamRoomById(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.examRoomService.getExamRoomById(id, req.user);
    }

    @Put(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Update an exam room by ID' })
    @ApiParam({ name: 'id', description: 'Exam room ID' })
    @ApiResponse({
        status: 200,
        description: 'Exam room updated successfully',
        type: Object,
    })
    async updateExamRoom(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Body() updateExamRoomDto: UpdateExamRoomDto
    ) {
        return this.examRoomService.updateExamRoom(
            id,
            req.user,
            updateExamRoomDto
        );
    }

    @Get('list')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get a list of exam rooms' })
    @ApiResponse({
        status: 200,
        description: 'Exam rooms retrieved successfully',
        type: [Object],
    })
    async getExamRooms(
        @Req() req: AuthenticatedRequest,
        @Query() getExamRoomsDto: GetExamRoomsDto
    ) {
        return this.examRoomService.getExamRooms(req.user, getExamRoomsDto);
    }

    @Get('list-all')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get all exam rooms without pagination' })
    @ApiResponse({
        status: 200,
        description: 'All exam rooms retrieved successfully',
        type: [Object],
    })
    async getAllExamRooms(@Req() req: AuthenticatedRequest) {
        return this.examRoomService.getAllExamRooms(req.user);
    }

    @Delete(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Delete an exam room by ID' })
    @ApiParam({ name: 'id', description: 'Exam room ID' })
    @ApiResponse({
        status: 200,
        description: 'Exam room deleted successfully',
        type: Object,
    })
    async deleteExamRoom(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.examRoomService.deleteExamRoom(id, req.user);
    }

    @Get('get-public/:id')
    @ApiOperation({ summary: 'Get a public exam room by ID' })
    @ApiParam({ name: 'id', description: 'Exam room ID' })
    @ApiResponse({
        status: 200,
        description: 'Public exam room retrieved successfully',
        type: Object,
    })
    async getPublicExamRoomById(@Param('id') id: string) {
        return this.examRoomService.getExamRoomPublicById(id);
    }

    @Get(':id/sessions')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get exam sessions for an exam room' })
    @ApiParam({ name: 'id', description: 'Exam room ID' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiResponse({
        status: 200,
        description: 'Exam sessions retrieved successfully',
        type: Object,
    })
    async getExamSessions(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Query('page') page?: number,
        @Query('limit') limit?: number
    ) {
        return this.examRoomService.getExamSessions(
            id,
            req.user,
            page ? Number(page) : 1,
            limit ? Number(limit) : 10
        );
    }
}
