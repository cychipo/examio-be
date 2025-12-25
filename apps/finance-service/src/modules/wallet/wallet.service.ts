import {
    Injectable,
    ConflictException,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { GenerateIdService } from '@examio/common';
import { User } from '@prisma/client';
import { WalletRepository } from './wallet.repository';
import { WalletTransactionRepository } from './wallettransaction.repository';
import {
    WalletDetailsDto,
    WALLET_TRANSACTION_TYPE,
    TRANSACTION_TYPE_LABELS,
} from './dto/wallet-details-response.dto';

@Injectable()
export class WalletService {
    constructor(
        private readonly walletRepository: WalletRepository,
        private readonly walletTransactionRepository: WalletTransactionRepository,
        private readonly generateIdService: GenerateIdService
    ) {}

    async createWallet(user: User) {
        // Check if wallet already exists
        const existingWallet = await this.walletRepository.findByUserId(
            user.id,
            true
        );

        if (existingWallet) {
            throw new ConflictException('Người dùng đã có ví rồi');
        }

        // Create wallet using repository
        return this.walletRepository.createForUser(
            user.id,
            20,
            this.generateIdService.generateId()
        );
    }

    async getWallet(user: User) {
        const wallet = await this.walletRepository.findByUserId(user.id, true);

        if (!wallet) {
            throw new NotFoundException('Không tìm thấy ví của người dùng này');
        }

        return wallet;
    }

    /**
     * Get detailed wallet info with paginated transactions
     * Uses cached data from repository for O(1) lookups
     */
    async getWalletDetails(
        user: User,
        page = 1,
        size = 10
    ): Promise<WalletDetailsDto> {
        // Get wallet info (cached)
        const wallet = await this.walletRepository.findByUserId(user.id, true);

        if (!wallet) {
            throw new NotFoundException('Không tìm thấy ví của người dùng này');
        }

        // Get paginated transactions with cache
        const transactionsPaginated =
            await this.walletTransactionRepository.paginateByWalletId(
                wallet.id,
                page,
                size,
                true
            );

        // Get statistics for totals (cached)
        const stats = await this.walletTransactionRepository.getStatistics(
            wallet.id
        );

        // Get usage breakdown by type (cached)
        const usageByType =
            await this.walletTransactionRepository.getUsageBreakdownByType(
                wallet.id
            );

        // Map usage breakdown to expected structure
        const usageBreakdown = {
            examGeneration:
                usageByType[WALLET_TRANSACTION_TYPE.USE_SERVICES] || 0, // All USE_SERVICES for now
            flashcardCreation: 0,
            pdfProcessing: 0,
        };

        // Calculate totals from stats
        const totalPurchased = stats.totalIncome;
        const totalUsed = stats.totalExpense;

        // Transform transactions with Vietnamese labels
        const transformedTransactions = transactionsPaginated.data.map(
            (tx: any) => {
                // Determine specific type from description for AI services
                let typeLabel =
                    TRANSACTION_TYPE_LABELS[tx.type] || 'Không xác định';
                const desc = (tx.description || '').toLowerCase();

                if (tx.type === WALLET_TRANSACTION_TYPE.USE_SERVICES) {
                    if (desc.includes('quiz') || desc.includes('câu hỏi')) {
                        typeLabel =
                            TRANSACTION_TYPE_LABELS[
                                WALLET_TRANSACTION_TYPE.AI_EXAM_GENERATION
                            ];
                    } else if (desc.includes('flashcard')) {
                        typeLabel =
                            TRANSACTION_TYPE_LABELS[
                                WALLET_TRANSACTION_TYPE.AI_FLASHCARD_CREATION
                            ];
                    } else if (desc.includes('ocr') || desc.includes('pdf')) {
                        typeLabel =
                            TRANSACTION_TYPE_LABELS[
                                WALLET_TRANSACTION_TYPE.AI_PDF_PROCESSING
                            ];
                    }
                }

                return {
                    id: tx.id,
                    amount: tx.amount,
                    type: tx.type,
                    typeLabel,
                    direction: tx.direction || 'SUBTRACT',
                    description: tx.description,
                    createdAt: tx.createdAt,
                };
            }
        );

        return {
            id: wallet.id,
            balance: wallet.balance,
            totalPurchased,
            totalUsed,
            usageBreakdown,
            transactions: {
                data: transformedTransactions,
                total: transactionsPaginated.total,
                page: transactionsPaginated.page,
                size: transactionsPaginated.size,
                totalPages: transactionsPaginated.totalPages,
            },
        };
    }

    async deposit(user: User, amount: number) {
        if (amount <= 0) {
            throw new ForbiddenException('Số tiền nạp phải là số dương');
        }

        // Use repository's updateBalance method
        return this.walletRepository.updateBalance(user.id, amount, 'add');
    }

    async deduct(user: User, amount: number) {
        if (amount <= 0) {
            throw new ForbiddenException('Số tiền trừ phải là số dương');
        }

        const wallet = await this.getWallet(user);

        if (wallet.balance < amount) {
            throw new ForbiddenException('Số dư trong ví không đủ');
        }

        // Use repository's updateBalance method
        return this.walletRepository.updateBalance(user.id, amount, 'subtract');
    }
}
