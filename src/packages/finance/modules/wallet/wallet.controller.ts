import {
    Controller,
    Post,
    Body,
    UseGuards,
    Req,
    Get,
    Res,
} from '@nestjs/common';
import {
    ApiTags,
    ApiResponse,
    ApiOperation,
    ApiExtraModels,
    ApiCookieAuth,
} from '@nestjs/swagger';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { WalletService } from './wallet.service';
import { AuthenticatedRequest } from 'src/packages/auth/dto/request-with-auth.dto';

@ApiTags('Wallet')
@ApiExtraModels()
@Controller('wallet')
export class WalletController {
    constructor(private readonly walletService: WalletService) {}

    @Get('info')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Get wallet information' })
    @ApiResponse({
        status: 200,
        description: 'Wallet information retrieved successfully',
        type: Object,
    })
    async getWallet(@Req() req: AuthenticatedRequest) {
        return this.walletService.getWallet(req.user);
    }
}
