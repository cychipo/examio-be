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
    UseInterceptors,
    UploadedFile,
    Headers,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
    ApiTags,
    ApiResponse,
    ApiOperation,
    ApiExtraModels,
    ApiCookieAuth,
    ApiParam,
    ApiHeader,
} from '@nestjs/swagger';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { AuthenticatedRequest } from 'src/packages/auth/dto/request-with-auth.dto';
import { FlashcardsetService } from './flashcardset.service';
import { CreateFlashcardsetDto } from './dto/create-flashcardset.dto';
import { UpdateFlashcardSetDto } from './dto/update-flashcardset.dto';
import { GetFlashcardsetsDto } from './dto/get-flashcardset.dto';
import { SetFlashcardToFlashcardsetDto } from './dto/set-flashcard-to-flashcardset-dto';
import { SaveHistoryToFlashcardsetDto } from './dto/save-history-to-flashcardset.dto';
import {
    FlashcardSetUpdateSharingSettingsDto,
    FlashcardSetVerifyAccessCodeDto,
    FlashcardSetAccessCheckResponseDto,
    FlashcardSetVerifyCodeResponseDto,
    FlashcardSetSharingSettingsResponseDto,
    FlashcardSetPublicInfoDto,
} from './dto/sharing.dto';
import {
    CreateFlashCardSetResponseDto,
    UpdateFlashCardSetResponseDto,
    GetFlashCardSetsResponseDto,
    DeleteFlashCardSetResponseDto,
    SetFlashcardsToFlashcardSetResponseDto,
    FlashCardSetDto,
} from './dto/flashcardset-response.dto';
import {
    CreateFlashcardDto,
    UpdateFlashcardDto,
    CreateFlashcardResponseDto,
    UpdateFlashcardResponseDto,
    DeleteFlashcardResponseDto,
} from './dto/flashcard.dto';
import { OptionalAuthGuard } from 'src/common/guard/optional-auth.guard';

@ApiTags('Flashcardsets')
@ApiExtraModels(
    CreateFlashcardsetDto,
    UpdateFlashcardSetDto,
    GetFlashcardsetsDto,
    CreateFlashCardSetResponseDto,
    UpdateFlashCardSetResponseDto,
    GetFlashCardSetsResponseDto,
    DeleteFlashCardSetResponseDto,
    SetFlashcardsToFlashcardSetResponseDto,
    FlashCardSetDto
)
@Controller('flashcardsets')
export class FlashcardsetController {
    constructor(private readonly flashcardsetService: FlashcardsetService) {}

    @Post()
    @UseGuards(AuthGuard)
    @UseInterceptors(FileInterceptor('thumbnail'))
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Create a new flashcard set' })
    @ApiResponse({
        status: 201,
        description: 'Flashcard set created successfully',
        type: CreateFlashCardSetResponseDto,
    })
    async createFlashcardSet(
        @Req() req: AuthenticatedRequest,
        @Body() createFlashcardsetDto: CreateFlashcardsetDto,
        @UploadedFile() thumbnail?: Express.Multer.File
    ) {
        return this.flashcardsetService.createFlashcardSet(
            req.user,
            createFlashcardsetDto,
            thumbnail
        );
    }

    @Get('stats')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get flashcard set statistics' })
    @ApiResponse({
        status: 200,
        description: 'Flashcard set statistics retrieved successfully',
    })
    async getFlashcardSetStats(@Req() req: AuthenticatedRequest) {
        return this.flashcardsetService.getFlashcardSetStats(req.user);
    }

    @Get(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get a flashcard set by ID' })
    @ApiResponse({
        status: 200,
        description: 'Flashcard set retrieved successfully',
        type: FlashCardSetDto,
    })
    async getFlashcardSetById(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.flashcardsetService.getFlashcardSetById(id, req.user);
    }

    @Put(':id')
    @UseGuards(AuthGuard)
    @UseInterceptors(FileInterceptor('thumbnail'))
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Update a flashcard set by ID' })
    @ApiResponse({
        status: 200,
        description: 'Flashcard set updated successfully',
        type: UpdateFlashCardSetResponseDto,
    })
    async updateFlashcardSet(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string,
        @Body() updateFlashcardSetDto: UpdateFlashcardSetDto,
        @UploadedFile() thumbnail?: Express.Multer.File
    ) {
        return this.flashcardsetService.updateFlashcardSet(
            id,
            req.user,
            updateFlashcardSetDto,
            thumbnail
        );
    }

    @Get()
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get a list of flashcard sets' })
    @ApiResponse({
        status: 200,
        description: 'Flashcard sets retrieved successfully',
        type: GetFlashCardSetsResponseDto,
    })
    async getFlashcardSets(
        @Req() req: AuthenticatedRequest,
        @Query() getFlashcardsetsDto: GetFlashcardsetsDto
    ) {
        return this.flashcardsetService.getFlashcardSets(
            req.user,
            getFlashcardsetsDto
        );
    }

    @Delete(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Delete a flashcard set by ID' })
    @ApiResponse({
        status: 200,
        description: 'Flashcard set deleted successfully',
        type: DeleteFlashCardSetResponseDto,
    })
    async deleteFlashcardSet(
        @Req() req: AuthenticatedRequest,
        @Param('id') id: string
    ) {
        return this.flashcardsetService.deleteFlashcardSet(id, req.user);
    }

    @Get('public/:id')
    @ApiOperation({ summary: 'Get a public flashcard set by ID' })
    @ApiResponse({
        status: 200,
        description: 'Public flashcard set retrieved successfully',
        type: FlashCardSetDto,
    })
    async getPublicFlashcardSetById(@Param('id') id: string) {
        return this.flashcardsetService.getFlashcardSetPublicById(id);
    }

    @Post('set-flashcards-to-flashcardset')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Set flashcards to a flashcard set' })
    @ApiResponse({
        status: 200,
        description: 'Flashcards set to flashcard set successfully',
        type: SetFlashcardsToFlashcardSetResponseDto,
    })
    async setFlashcardsToFlashcardset(
        @Req() req: AuthenticatedRequest,
        @Body() dto: SetFlashcardToFlashcardsetDto
    ) {
        return this.flashcardsetService.setFlashcardsToFlashcardSet(
            req.user,
            dto
        );
    }

    @Post('save-history-to-flashcardset')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Save history generated flashcards to flashcard set',
    })
    @ApiResponse({
        status: 200,
        description: 'Save history to flashcard set successfully',
        type: SetFlashcardsToFlashcardSetResponseDto,
    })
    async saveHistoryToFlashcardset(
        @Req() req: AuthenticatedRequest,
        @Body() dto: SaveHistoryToFlashcardsetDto
    ) {
        return this.flashcardsetService.saveHistoryToFlashcardSet(
            req.user,
            dto
        );
    }

    // ==================== FLASHCARD CRUD ENDPOINTS ====================

    @Post(':flashcardSetId/flashcards')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Add a flashcard to a flashcard set' })
    @ApiParam({ name: 'flashcardSetId', description: 'Flashcard set ID' })
    @ApiResponse({
        status: 201,
        description: 'Flashcard added successfully',
        type: CreateFlashcardResponseDto,
    })
    async addFlashcard(
        @Req() req: AuthenticatedRequest,
        @Param('flashcardSetId') flashcardSetId: string,
        @Body() dto: CreateFlashcardDto
    ) {
        return this.flashcardsetService.addFlashcardToFlashcardSet(
            flashcardSetId,
            req.user,
            dto
        );
    }

    @Put(':flashcardSetId/flashcards/:flashcardId')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Update a flashcard in a flashcard set' })
    @ApiParam({ name: 'flashcardSetId', description: 'Flashcard set ID' })
    @ApiParam({ name: 'flashcardId', description: 'Flashcard ID' })
    @ApiResponse({
        status: 200,
        description: 'Flashcard updated successfully',
        type: UpdateFlashcardResponseDto,
    })
    async updateFlashcard(
        @Req() req: AuthenticatedRequest,
        @Param('flashcardSetId') flashcardSetId: string,
        @Param('flashcardId') flashcardId: string,
        @Body() dto: UpdateFlashcardDto
    ) {
        return this.flashcardsetService.updateFlashcardInFlashcardSet(
            flashcardSetId,
            flashcardId,
            req.user,
            dto
        );
    }

    @Delete(':flashcardSetId/flashcards/:flashcardId')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Delete a flashcard from a flashcard set' })
    @ApiParam({ name: 'flashcardSetId', description: 'Flashcard set ID' })
    @ApiParam({ name: 'flashcardId', description: 'Flashcard ID' })
    @ApiResponse({
        status: 200,
        description: 'Flashcard deleted successfully',
        type: DeleteFlashcardResponseDto,
    })
    async deleteFlashcard(
        @Req() req: AuthenticatedRequest,
        @Param('flashcardSetId') flashcardSetId: string,
        @Param('flashcardId') flashcardId: string
    ) {
        return this.flashcardsetService.deleteFlashcardFromFlashcardSet(
            flashcardSetId,
            flashcardId,
            req.user
        );
    }

    // ==================== SHARING & ACCESS ENDPOINTS ====================

    @Get('study/:id/access')
    @UseGuards(OptionalAuthGuard)
    @ApiOperation({ summary: 'Check access for a flashcard set' })
    @ApiParam({ name: 'id', description: 'Flashcard set ID' })
    @ApiResponse({
        status: 200,
        description: 'Access check result',
        type: FlashcardSetAccessCheckResponseDto,
    })
    async checkAccess(
        @Param('id') id: string,
        @Req() req: AuthenticatedRequest
    ) {
        return this.flashcardsetService.checkAccess(id, req.user?.id);
    }

    @Get('study/:id/info')
    @ApiOperation({ summary: 'Get public info for a flashcard set' })
    @ApiParam({ name: 'id', description: 'Flashcard set ID' })
    @ApiResponse({
        status: 200,
        description: 'Flashcard set public info',
        type: FlashcardSetPublicInfoDto,
    })
    async getPublicInfo(@Param('id') id: string) {
        return this.flashcardsetService.getFlashcardSetPublicInfo(id);
    }

    @Get('study/:id')
    @UseGuards(OptionalAuthGuard)
    @ApiOperation({ summary: 'Get flashcard set for study with access check' })
    @ApiParam({ name: 'id', description: 'Flashcard set ID' })
    @ApiResponse({
        status: 200,
        description: 'Flashcard set for study',
        type: FlashCardSetDto,
    })
    async getForStudy(
        @Param('id') id: string,
        @Req() req: AuthenticatedRequest
    ) {
        return this.flashcardsetService.getFlashcardSetForStudy(
            id,
            req.user?.id
        );
    }

    @Post('study/:id/verify-code')
    @ApiOperation({ summary: 'Verify access code for a private flashcard set' })
    @ApiParam({ name: 'id', description: 'Flashcard set ID' })
    @ApiResponse({
        status: 200,
        description: 'Code verification result',
        type: FlashcardSetVerifyCodeResponseDto,
    })
    async verifyCode(
        @Param('id') id: string,
        @Body() dto: FlashcardSetVerifyAccessCodeDto
    ) {
        return this.flashcardsetService.verifyAccessCode(id, dto.accessCode);
    }

    @Post('study/:id/with-code')
    @ApiOperation({ summary: 'Get flashcard set using access code' })
    @ApiParam({ name: 'id', description: 'Flashcard set ID' })
    @ApiResponse({
        status: 200,
        description: 'Flashcard set for study',
        type: FlashCardSetDto,
    })
    async getWithCode(
        @Param('id') id: string,
        @Body() dto: FlashcardSetVerifyAccessCodeDto
    ) {
        return this.flashcardsetService.getFlashcardSetWithCode(
            id,
            dto.accessCode
        );
    }

    @Get(':id/sharing')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get sharing settings for a flashcard set' })
    @ApiParam({ name: 'id', description: 'Flashcard set ID' })
    @ApiResponse({
        status: 200,
        description: 'Sharing settings',
    })
    async getSharingSettings(
        @Param('id') id: string,
        @Req() req: AuthenticatedRequest
    ) {
        return this.flashcardsetService.getSharingSettings(id, req.user);
    }

    @Put(':id/sharing')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Update sharing settings for a flashcard set' })
    @ApiParam({ name: 'id', description: 'Flashcard set ID' })
    @ApiResponse({
        status: 200,
        description: 'Sharing settings updated',
        type: FlashcardSetSharingSettingsResponseDto,
    })
    async updateSharingSettings(
        @Param('id') id: string,
        @Req() req: AuthenticatedRequest,
        @Body() dto: FlashcardSetUpdateSharingSettingsDto
    ) {
        return this.flashcardsetService.updateSharingSettings(
            id,
            req.user,
            dto
        );
    }

    @Post(':id/generate-code')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Generate a new access code' })
    @ApiParam({ name: 'id', description: 'Flashcard set ID' })
    @ApiResponse({
        status: 200,
        description: 'New access code generated',
    })
    async generateCode(
        @Param('id') id: string,
        @Req() req: AuthenticatedRequest
    ) {
        const accessCode = this.flashcardsetService.generateAccessCode();
        await this.flashcardsetService.updateSharingSettings(id, req.user, {
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
        return this.flashcardsetService.searchUsers(query, req.user.id);
    }
}
