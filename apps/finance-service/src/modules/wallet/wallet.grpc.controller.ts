import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { PrismaService } from '@examio/database';
import { GenerateIdService } from '@examio/common';

// gRPC DTOs matching wallet.proto
interface CreateWalletRequest {
    user_id: string;
    initial_balance: number;
}

interface GetWalletRequest {
    user_id: string;
}

interface UpdateBalanceRequest {
    user_id: string;
    amount: number;
    transaction_type: string;
    description: string;
}

@Controller()
export class WalletGrpcController {
    constructor(
        private readonly prisma: PrismaService,
        private readonly generateIdService: GenerateIdService
    ) {}

    @GrpcMethod('WalletService', 'CreateWallet')
    async createWallet(data: CreateWalletRequest) {
        try {
            const wallet = await this.prisma.wallet.create({
                data: {
                    id: this.generateIdService.generateId(),
                    userId: data.user_id,
                    balance: data.initial_balance || 20,
                },
            });

            return {
                success: true,
                wallet_id: wallet.id,
                message: 'Wallet created successfully',
            };
        } catch (error) {
            return {
                success: false,
                message: `Failed to create wallet: ${error.message}`,
            };
        }
    }

    @GrpcMethod('WalletService', 'GetWallet')
    async getWallet(data: GetWalletRequest) {
        const wallet = await this.prisma.wallet.findUnique({
            where: { userId: data.user_id },
        });

        if (!wallet) {
            return {
                wallet_id: '',
                user_id: data.user_id,
                balance: 0,
            };
        }

        return {
            wallet_id: wallet.id,
            user_id: wallet.userId,
            balance: wallet.balance,
        };
    }

    @GrpcMethod('WalletService', 'UpdateBalance')
    async updateBalance(data: UpdateBalanceRequest) {
        try {
            const wallet = await this.prisma.wallet.findUnique({
                where: { userId: data.user_id },
            });

            if (!wallet) {
                return {
                    success: false,
                    new_balance: 0,
                    message: 'Wallet not found',
                };
            }

            const newBalance =
                data.transaction_type === 'ADD'
                    ? wallet.balance + data.amount
                    : wallet.balance - data.amount;

            await this.prisma.wallet.update({
                where: { userId: data.user_id },
                data: { balance: newBalance },
            });

            // Create transaction record
            await this.prisma.walletTransaction.create({
                data: {
                    id: this.generateIdService.generateId(),
                    walletId: wallet.id,
                    amount: data.amount,
                    type: data.transaction_type === 'ADD' ? 0 : 4,
                    direction: data.transaction_type,
                    description: data.description,
                },
            });

            return {
                success: true,
                new_balance: newBalance,
                message: 'Balance updated successfully',
            };
        } catch (error) {
            return {
                success: false,
                new_balance: 0,
                message: `Failed to update balance: ${error.message}`,
            };
        }
    }
}
