import {
    Controller,
    Post,
    Body,
    UseGuards,
    Req,
    Get,
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
import { FlashcardsetService } from './flashcardset.service';
import { CreateFlashcardsetDto } from './dto/create-flashcardset.dto';
import { UpdateFlashcardSetDto } from './dto/update-flashcardset.dto';
import { GetFlashcardsetsDto } from './dto/get-flashcardset.dto';

@ApiTags('Flashcardsets')
@ApiExtraModels(
    CreateFlashcardsetDto,
    UpdateFlashcardSetDto,
    GetFlashcardsetsDto
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
        type: Object,
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
        type: Object,
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
        type: Object,
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
        type: [Object],
    })
    async getFlashcardSets(
        @Req() req: AuthenticatedRequest,
        @Body() getFlashcardsetsDto: GetFlashcardsetsDto
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
        type: Object,
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
        type: Object,
    })
    async getPublicFlashcardSetById(@Body('id') id: string) {
        return this.flashcardsetService.getFlashcardSetPublicById(id);
    }
}
