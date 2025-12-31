/**
 * Sanitize filename để tránh lỗi format khi lưu vào R2
 * - Chuyển tiếng Việt có dấu thành không dấu
 * - Loại bỏ ký tự đặc biệt
 * - Thay khoảng trắng bằng dấu gạch ngang
 * - Lowercase
 */
export function sanitizeFilename(filename: string): string {
    // Tách tên file và extension
    const lastDotIndex = filename.lastIndexOf('.');
    const name =
        lastDotIndex !== -1 ? filename.substring(0, lastDotIndex) : filename;
    const extension =
        lastDotIndex !== -1 ? filename.substring(lastDotIndex) : '';

    // Bảng chuyển đổi tiếng Việt có dấu sang không dấu
    const vietnameseMap: Record<string, string> = {
        à: 'a',
        á: 'a',
        ả: 'a',
        ã: 'a',
        ạ: 'a',
        ă: 'a',
        ằ: 'a',
        ắ: 'a',
        ẳ: 'a',
        ẵ: 'a',
        ặ: 'a',
        â: 'a',
        ầ: 'a',
        ấ: 'a',
        ẩ: 'a',
        ẫ: 'a',
        ậ: 'a',
        đ: 'd',
        è: 'e',
        é: 'e',
        ẻ: 'e',
        ẽ: 'e',
        ẹ: 'e',
        ê: 'e',
        ề: 'e',
        ế: 'e',
        ể: 'e',
        ễ: 'e',
        ệ: 'e',
        ì: 'i',
        í: 'i',
        ỉ: 'i',
        ĩ: 'i',
        ị: 'i',
        ò: 'o',
        ó: 'o',
        ỏ: 'o',
        õ: 'o',
        ọ: 'o',
        ô: 'o',
        ồ: 'o',
        ố: 'o',
        ổ: 'o',
        ỗ: 'o',
        ộ: 'o',
        ơ: 'o',
        ờ: 'o',
        ớ: 'o',
        ở: 'o',
        ỡ: 'o',
        ợ: 'o',
        ù: 'u',
        ú: 'u',
        ủ: 'u',
        ũ: 'u',
        ụ: 'u',
        ư: 'u',
        ừ: 'u',
        ứ: 'u',
        ử: 'u',
        ữ: 'u',
        ự: 'u',
        ỳ: 'y',
        ý: 'y',
        ỷ: 'y',
        ỹ: 'y',
        ỵ: 'y',
        // Uppercase
        À: 'A',
        Á: 'A',
        Ả: 'A',
        Ã: 'A',
        Ạ: 'A',
        Ă: 'A',
        Ằ: 'A',
        Ắ: 'A',
        Ẳ: 'A',
        Ẵ: 'A',
        Ặ: 'A',
        Â: 'A',
        Ầ: 'A',
        Ấ: 'A',
        Ẩ: 'A',
        Ẫ: 'A',
        Ậ: 'A',
        Đ: 'D',
        È: 'E',
        É: 'E',
        Ẻ: 'E',
        Ẽ: 'E',
        Ẹ: 'E',
        Ê: 'E',
        Ề: 'E',
        Ế: 'E',
        Ể: 'E',
        Ễ: 'E',
        Ệ: 'E',
        Ì: 'I',
        Í: 'I',
        Ỉ: 'I',
        Ĩ: 'I',
        Ị: 'I',
        Ò: 'O',
        Ó: 'O',
        Ỏ: 'O',
        Õ: 'O',
        Ọ: 'O',
        Ô: 'O',
        Ồ: 'O',
        Ố: 'O',
        Ổ: 'O',
        Ỗ: 'O',
        Ộ: 'O',
        Ơ: 'O',
        Ờ: 'O',
        Ớ: 'O',
        Ở: 'O',
        Ỡ: 'O',
        Ợ: 'O',
        Ù: 'U',
        Ú: 'U',
        Ủ: 'U',
        Ũ: 'U',
        Ụ: 'U',
        Ư: 'U',
        Ừ: 'U',
        Ứ: 'U',
        Ử: 'U',
        Ữ: 'U',
        Ự: 'U',
        Ỳ: 'Y',
        Ý: 'Y',
        Ỷ: 'Y',
        Ỹ: 'Y',
        Ỵ: 'Y',
    };

    // Chuyển đổi tiếng Việt có dấu
    let sanitized = name
        .split('')
        .map((char) => vietnameseMap[char] || char)
        .join('');

    // Loại bỏ ký tự đặc biệt, chỉ giữ chữ cái, số, dấu gạch ngang, gạch dưới
    sanitized = sanitized.replace(/[^a-zA-Z0-9-_\s]/g, '');

    // Thay khoảng trắng bằng dấu gạch ngang
    sanitized = sanitized.replace(/\s+/g, '-');

    // Loại bỏ nhiều dấu gạch ngang liên tiếp
    sanitized = sanitized.replace(/-+/g, '-');

    // Loại bỏ dấu gạch ngang ở đầu và cuối
    sanitized = sanitized.replace(/^-+|-+$/g, '');

    // Lowercase
    sanitized = sanitized.toLowerCase();

    // Nếu sau khi sanitize bị rỗng, dùng fallback
    if (!sanitized) {
        sanitized = 'file';
    }

    // Sanitize extension (chỉ giữ chữ cái và số)
    const sanitizedExtension = extension
        .replace(/[^a-zA-Z0-9.]/g, '')
        .toLowerCase();

    return sanitized + sanitizedExtension;
}
