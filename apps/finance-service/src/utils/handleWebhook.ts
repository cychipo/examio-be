import { PAYMENT_SYSTEM_CODE } from '../config';

/**
 * Trích xuất paymentId từ nội dung chuyển khoản
 * Format: FAYEDU{paymentId}
 *
 * @param content - Nội dung chuyển khoản từ webhook
 * @returns paymentId hoặc null nếu không tìm thấy
 */
export function getPaymentIdFromWebhook(content: string): string | null {
    if (!content) return null;

    // Tìm pattern FAYEDU{id} trong content
    // ID có thể chứa chữ và số (nanoid format)
    const regex = new RegExp(`${PAYMENT_SYSTEM_CODE}([A-Za-z0-9_-]+)`, 'i');
    const match = content.match(regex);

    return match ? match[1].toLocaleLowerCase() : null;
}
