/**
 * SePay Webhook Data Types
 * Cấu trúc dữ liệu webhook từ SePay khi có giao dịch chuyển khoản
 */

export interface SepayWebhook {
    /** ID giao dịch nội bộ của SePay */
    id: string;

    /** Gateway ngân hàng (VD: "MB", "Vietcombank") */
    gateway: string;

    /** Ngày giờ giao dịch */
    transactionDate: string;

    /** Số tài khoản nhận */
    accountNumber: string;

    /** Mã giao dịch ngân hàng */
    code: string | null;

    /** Nội dung chuyển khoản - chứa FAYEDU{paymentId} */
    content: string;

    /** Loại giao dịch: 'in' = tiền vào, 'out' = tiền ra */
    transferType: 'in' | 'out';

    /** Số tiền giao dịch */
    transferAmount: number;

    /** Số dư tích lũy */
    accumulated: number;

    /** Tài khoản phụ (nếu có) */
    subAccount: string | null;

    /** Mã tham chiếu */
    referenceCode: string;

    /** Mô tả giao dịch */
    description: string;
}
