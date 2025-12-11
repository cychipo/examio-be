import {
    Controller,
    Post,
    Get,
    Body,
    Param,
    Query,
    UseGuards,
    Req,
} from '@nestjs/common';
import {
    ApiTags,
    ApiOperation,
    ApiResponse,
    ApiCookieAuth,
    ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { AuthenticatedRequest } from 'src/packages/auth/dto/request-with-auth.dto';
import { PaymentService, CreatePaymentDto } from './payment.service';
import { SubscriptionService } from './subscription.service';

@ApiTags('Payment')
@Controller('payment')
export class PaymentController {
    constructor(
        private readonly paymentService: PaymentService,
        private readonly subscriptionService: SubscriptionService
    ) {}

    @Post('create')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Tạo thanh toán và lấy QR code' })
    @ApiResponse({
        status: 200,
        description: 'QR code và thông tin thanh toán',
    })
    async createPayment(
        @Req() req: AuthenticatedRequest,
        @Body() dto: CreatePaymentDto
    ) {
        return this.paymentService.createPayment(req.user, dto);
    }

    @Get('status/:paymentId')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Kiểm tra trạng thái thanh toán' })
    @ApiResponse({ status: 200, description: 'Trạng thái thanh toán' })
    async getPaymentStatus(
        @Req() req: AuthenticatedRequest,
        @Param('paymentId') paymentId: string
    ) {
        return this.paymentService.getPaymentStatus(paymentId, req.user.id);
    }

    @Get('history')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Lịch sử thanh toán' })
    @ApiQuery({ name: 'page', required: false, type: Number })
    @ApiQuery({ name: 'size', required: false, type: Number })
    @ApiResponse({ status: 200, description: 'Danh sách thanh toán' })
    async getPaymentHistory(
        @Req() req: AuthenticatedRequest,
        @Query('page') page?: number,
        @Query('size') size?: number
    ) {
        return this.paymentService.getPaymentHistory(
            req.user.id,
            page || 1,
            size || 10
        );
    }

    @Get('subscription')
    @UseGuards(AuthGuard)
    @ApiCookieAuth('cookie-auth')
    @ApiOperation({ summary: 'Lấy thông tin gói đăng ký hiện tại' })
    @ApiResponse({ status: 200, description: 'Thông tin gói đăng ký' })
    async getSubscription(@Req() req: AuthenticatedRequest) {
        return this.subscriptionService.getSubscription(req.user.id);
    }

    @Get('subscription/plans')
    @ApiOperation({ summary: 'Lấy danh sách các gói đăng ký' })
    @ApiResponse({ status: 200, description: 'Danh sách gói đăng ký' })
    async getSubscriptionPlans() {
        return this.subscriptionService.getAllPlans();
    }
}
