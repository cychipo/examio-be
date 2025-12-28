import {
    Injectable,
    Inject,
    OnModuleInit,
    ForbiddenException,
    Logger,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, Observable } from 'rxjs';

interface WalletService {
    updateBalance(data: {
        userId: string;
        amount: number;
        transactionType: string;
        description: string;
    }): Observable<{
        success: boolean;
        newBalance: number;
        message: string;
    }>;
}

@Injectable()
export class FinanceClientService implements OnModuleInit {
    private readonly logger = new Logger(FinanceClientService.name);
    private walletService: WalletService;

    constructor(@Inject('FINANCE_PACKAGE') private client: ClientGrpc) {}

    onModuleInit() {
        this.walletService =
            this.client.getService<WalletService>('WalletService');
    }

    async deductCredits(userId: string, amount: number, description: string) {
        if (amount <= 0)
            return {
                success: true,
                newBalance: undefined,
                message: 'No charge',
            }; // No charge

        try {
            const result = await firstValueFrom(
                this.walletService.updateBalance({
                    userId: userId,
                    amount: amount,
                    transactionType: 'SUBTRACT',
                    description: description,
                })
            );

            if (!result.success) {
                // If failed (e.g. not enough balance), throw error to block operation
                throw new ForbiddenException(
                    `Không đủ tín dụng: ${result.message}. Vui lòng nạp thêm.`
                );
            }

            this.logger.log(
                `Deducted ${amount} credits from user ${userId}: ${description}`
            );
            return result;
        } catch (error) {
            this.logger.error(`Failed to deduct credits: ${error.message}`);
            if (error instanceof ForbiddenException) throw error;
            // For connection errors, do we fail open or closed?
            // "tuân thủ đúng". STRICT. Fail closed.
            throw new ForbiddenException(
                'Không thể thực hiện giao dịch tín dụng lúc này.'
            );
        }
    }
}
