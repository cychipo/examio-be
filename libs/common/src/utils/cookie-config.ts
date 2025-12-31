import { CookieOptions } from 'express';

interface CookieConfigOptions {
    feOrigin?: string;
    isProductionBE: boolean;
}

/**
 * Tạo cookie configuration phù hợp với môi trường FE và BE
 *
 * Logic:
 * - FE local + BE production: secure=false, sameSite=lax (để FE local nhận cookie qua HTTPS)
 * - FE production + BE production: secure=true, sameSite=none (cross-domain)
 * - FE local + BE local: secure=false, sameSite=lax (development)
 */
export function getCookieConfig(options: CookieConfigOptions): CookieOptions {
    const { feOrigin, isProductionBE } = options;

    const isLocalFE =
        feOrigin?.includes('localhost') || feOrigin?.includes('127.0.0.1');

    const cookieConfig: CookieOptions = {
        httpOnly: true,
        // Nếu FE local + BE production: không set secure (để FE local nhận được)
        // Nếu cả 2 production: bắt buộc secure
        secure: isProductionBE && !isLocalFE,
        // Nếu FE local: dùng lax để dễ test
        // Nếu production: dùng none để support cross-origin
        sameSite: isProductionBE && !isLocalFE ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/',
    };

    // Chỉ set domain khi cả FE và BE đều production
    if (isProductionBE && !isLocalFE) {
        cookieConfig.domain = '.fayedark.com';
    }

    return cookieConfig;
}
