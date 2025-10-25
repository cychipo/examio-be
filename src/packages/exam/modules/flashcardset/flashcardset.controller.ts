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
} from '@nestjs/swagger';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { AuthenticatedRequest } from 'src/packages/auth/dto/request-with-auth.dto';
import { FlashcardsetService } from './flashcardset.service';
import { CreateFlashcardsetDto } from './dto/create-flashcardset.dto';
import { UpdateFlashcardSetDto } from './dto/update-flashcardset.dto';
import { GetFlashcardsetsDto } from './dto/get-flashcardset.dto';
import { SetFlashcardToFlashcardsetDto } from './dto/set-flashcard-to-flashcardset-dto';
import {
    CreateFlashCardSetResponseDto,
    UpdateFlashCardSetResponseDto,
    GetFlashCardSetsResponseDto,
    DeleteFlashCardSetResponseDto,
    SetFlashcardsToFlashcardSetResponseDto,
    FlashCardSetDto,
} from './dto/flashcardset-response.dto';

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
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Create a new flashcard set' })
    @ApiResponse({
        status: 201,
        description: 'Flashcard set created successfully',
        type: CreateFlashCardSetResponseDto,
    })
    async createFlashcardSet(
        @Req() req: AuthenticatedRequest,
        @Body() createFlashcardsetDto: CreateFlashcardsetDto
    ) {
        return this.flashcardsetService.createFlashcardSet(
            req.user,
            createFlashcardsetDto
        );
    }

    @Get('get-by-id/:id')
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
        @Body('id') id: string
    ) {
        return this.flashcardsetService.getFlashcardSetById(id, req.user);
    }

    @Put(':id')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Update a flashcard set by ID' })
    @ApiResponse({
        status: 200,
        description: 'Flashcard set updated successfully',
        type: UpdateFlashCardSetResponseDto,
    })
    async updateFlashcardSet(
        @Req() req: AuthenticatedRequest,
        @Body('id') id: string,
        @Body() updateFlashcardSetDto: UpdateFlashcardSetDto
    ) {
        return this.flashcardsetService.updateFlashcardSet(
            id,
            req.user,
            updateFlashcardSetDto
        );
    }

    @Get('list')
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
        @Param() getFlashcardsetsDto: GetFlashcardsetsDto
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
        @Body('id') id: string
    ) {
        return this.flashcardsetService.deleteFlashcardSet(id, req.user);
    }

    @Get('get-public/:id')
    @ApiOperation({ summary: 'Get a public flashcard set by ID' })
    @ApiResponse({
        status: 200,
        description: 'Public flashcard set retrieved successfully',
        type: FlashCardSetDto,
    })
    async getPublicFlashcardSetById(@Body('id') id: string) {
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
}
