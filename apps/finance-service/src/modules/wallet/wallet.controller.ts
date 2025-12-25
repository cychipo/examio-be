import { Controller, UseGuards, Req, Get, Query } from '@nestjs/common';
import {
    ApiTags,
    ApiResponse,
    ApiOperation,
    ApiExtraModels,
    ApiCookieAuth,
    ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { WalletService } from './wallet.service';
import { AuthenticatedRequest } from 'src/packages/auth/dto/request-with-auth.dto';
import { WalletDto } from './dto/wallet-response.dto';
import { WalletDetailsDto } from './dto/wallet-details-response.dto';
import { GetTransactionsDto } from './dto/get-transactions.dto';

@ApiTags('Wallet')
@ApiExtraModels(WalletDto, WalletDetailsDto)
@Controller('wallet')
export class WalletController {
    constructor(private readonly walletService: WalletService) {}

    @Get('info')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Lấy thông tin ví' })
    @ApiResponse({
        status: 200,
        description: 'Thông tin ví lấy thành công',
        type: WalletDto,
    })
    async getWallet(@Req() req: AuthenticatedRequest) {
        return this.walletService.getWallet(req.user);
    }

    @Get('details')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({
        summary: 'Lấy thông tin chi tiết ví với lịch sử giao dịch',
    })
    @ApiQuery({
        name: 'page',
        required: false,
        type: Number,
        description: 'Trang hiện tại',
    })
    @ApiQuery({
        name: 'size',
        required: false,
        type: Number,
        description: 'Số lượng mỗi trang',
    })
    @ApiResponse({
        status: 200,
        description: 'Thông tin chi tiết ví với phân trang giao dịch',
        type: WalletDetailsDto,
    })
    async getWalletDetails(
        @Req() req: AuthenticatedRequest,
        @Query() query: GetTransactionsDto
    ) {
        return this.walletService.getWalletDetails(
            req.user,
            query.page || 1,
            query.size || 10
        );
    }
}
