import { ApiProperty } from '@nestjs/swagger';

// Transaction Type Constants - matching Prisma schema
export const WALLET_TRANSACTION_TYPE = {
    BUY_CREDITS: 0,
    BUY_SUBSCRIPTION: 1,
    REFUND: 2,
    ADMIN_ADJUSTMENT: 3,
    USE_SERVICES: 4,
    // AI Service subtypes (tracked via description, type = 4)
    AI_EXAM_GENERATION: 5,
    AI_FLASHCARD_CREATION: 6,
    AI_PDF_PROCESSING: 7,
} as const;

export type WalletTransactionType =
    (typeof WALLET_TRANSACTION_TYPE)[keyof typeof WALLET_TRANSACTION_TYPE];

// Vietnamese labels for transaction types
export const TRANSACTION_TYPE_LABELS: Record<number, string> = {
    [WALLET_TRANSACTION_TYPE.BUY_CREDITS]: 'Mua credits',
    [WALLET_TRANSACTION_TYPE.BUY_SUBSCRIPTION]: 'Mua gói đăng ký',
    [WALLET_TRANSACTION_TYPE.REFUND]: 'Hoàn tiền',
    [WALLET_TRANSACTION_TYPE.ADMIN_ADJUSTMENT]: 'Điều chỉnh',
    [WALLET_TRANSACTION_TYPE.USE_SERVICES]: 'Sử dụng dịch vụ',
    [WALLET_TRANSACTION_TYPE.AI_EXAM_GENERATION]: 'Tạo đề thi AI',
    [WALLET_TRANSACTION_TYPE.AI_FLASHCARD_CREATION]: 'Tạo flashcard AI',
    [WALLET_TRANSACTION_TYPE.AI_PDF_PROCESSING]: 'Xử lý PDF AI',
};

export class UsageBreakdownDto {
    @ApiProperty({ description: 'Credit sử dụng cho tạo đề thi' })
    examGeneration: number;

    @ApiProperty({ description: 'Credit sử dụng cho tạo flashcard' })
    flashcardCreation: number;

    @ApiProperty({ description: 'Credit sử dụng cho xử lý PDF' })
    pdfProcessing: number;
}

export class TransactionDto {
    @ApiProperty({ description: 'ID của transaction' })
    id: string;

    @ApiProperty({ description: 'Số credit' })
    amount: number;

    @ApiProperty({
        description: 'Loại transaction: 0=buy credits, 1=buy subscription, 2=refund, 3=admin adjustment, 4=use services',
    })
    type: number;

    @ApiProperty({ description: 'Nhãn loại transaction tiếng Việt' })
    typeLabel: string;

    @ApiProperty({ description: 'Hướng giao dịch: ADD=cộng, SUBTRACT=trừ' })
    direction: string;

    @ApiProperty({ description: 'Mô tả transaction' })
    description: string | null;

    @ApiProperty({ description: 'Ngày tạo' })
    createdAt: Date;
}

export class TransactionPaginationDto {
    @ApiProperty({ description: 'Danh sách giao dịch', type: [TransactionDto] })
    data: TransactionDto[];

    @ApiProperty({ description: 'Tổng số giao dịch' })
    total: number;

    @ApiProperty({ description: 'Trang hiện tại' })
    page: number;

    @ApiProperty({ description: 'Số lượng mỗi trang' })
    size: number;

    @ApiProperty({ description: 'Tổng số trang' })
    totalPages: number;
}

export class WalletDetailsDto {
    @ApiProperty({ description: 'ID của ví' })
    id: string;

    @ApiProperty({ description: 'Số dư hiện tại' })
    balance: number;

    @ApiProperty({ description: 'Tổng credit đã mua' })
    totalPurchased: number;

    @ApiProperty({ description: 'Tổng credit đã sử dụng' })
    totalUsed: number;

    @ApiProperty({ description: 'Phân loại sử dụng theo dịch vụ' })
    usageBreakdown: UsageBreakdownDto;

    @ApiProperty({ description: 'Danh sách giao dịch với phân trang' })
    transactions: TransactionPaginationDto;
}
