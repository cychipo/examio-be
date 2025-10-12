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
import { ParticipantService } from './participant.service';
import { CreateParticipantDto } from './dto/create-participant.dto';
import { UpdateParticipantDto } from './dto/update-participant.dto';
import { GetParticipantsDto } from './dto/get-participant.dto';

@ApiTags('ExamSessionParticipants')
@ApiExtraModels(CreateParticipantDto, UpdateParticipantDto, GetParticipantsDto)
@Controller('participants')
export class ParticipantController {
    constructor(private readonly participantService: ParticipantService) {}

    @Post('join')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Join an exam session' })
    @ApiResponse({
        status: 201,
        description: 'Joined exam session successfully',
        type: Object,
    })
    async joinExamSession(
        @Req() req: AuthenticatedRequest,
        @Body() createParticipantDto: CreateParticipantDto
    ) {
        return this.participantService.joinExamSession(
            req.user,
            createParticipantDto
        );
    }

    @Get('get-by-id/:id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get a participant by ID' })
    @ApiParam({ name: 'id', description: 'Participant ID' })
    @ApiResponse({
        status: 200,
        description: 'Participant retrieved successfully',
        type: Object,
    })
    async getParticipantById(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.participantService.getParticipantById(id, req.user);
    }

    @Put(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Update participant status (approve/reject)' })
    @ApiParam({ name: 'id', description: 'Participant ID' })
    @ApiResponse({
        status: 200,
        description: 'Participant updated successfully',
        type: Object,
    })
    async updateParticipant(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Body() updateParticipantDto: UpdateParticipantDto
    ) {
        return this.participantService.updateParticipant(
            id,
            req.user,
            updateParticipantDto
        );
    }

    @Get('list')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get a list of participants' })
    @ApiResponse({
        status: 200,
        description: 'Participants retrieved successfully',
        type: [Object],
    })
    async getParticipants(
        @Req() req: AuthenticatedRequest,
        @Body() getParticipantsDto: GetParticipantsDto
    ) {
        return this.participantService.getParticipants(
            req.user,
            getParticipantsDto
        );
    }

    @Post('leave/:id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Leave an exam session' })
    @ApiParam({ name: 'id', description: 'Participant ID' })
    @ApiResponse({
        status: 200,
        description: 'Left exam session successfully',
        type: Object,
    })
    async leaveExamSession(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.participantService.leaveExamSession(id, req.user);
    }

    @Delete(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Remove a participant (host only)' })
    @ApiParam({ name: 'id', description: 'Participant ID' })
    @ApiResponse({
        status: 200,
        description: 'Participant removed successfully',
        type: Object,
    })
    async removeParticipant(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.participantService.removeParticipant(id, req.user);
    }
}
