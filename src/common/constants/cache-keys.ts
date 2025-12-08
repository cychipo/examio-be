/**
 * Cache keys constants
 * Use these constants when calling cache.set() and cache.del()
 * to ensure consistency and avoid typos
 *
 * Cache Key Pattern: {module}:{userId}:{itemId}:{suffix}
 * Example: quizset:user123:quiz456:questions
 */

export const CACHE_MODULES = {
    // User & Auth
    USER: 'user',
    WALLET: 'wallet',
    WALLET_TRANSACTION: 'wallet_transaction',

    // Quiz & Flashcard Sets
    QUIZSET: 'quizset',
    FLASHCARDSET: 'flashcardset',

    // Exam related
    EXAMROOM: 'examroom',
    EXAMSESSION: 'examsession',
    EXAMATTEMPT: 'examattempt',
    PARTICIPANT: 'participant',

    // Finance
    PAYMENT: 'payment',

    // Statistics
    QUIZ_STATS: 'quiz_stats',
    FLASHCARD_STATS: 'flashcard_stats',

    // AI & Storage
    USER_STORAGE: 'user_storage',
    DOCUMENT: 'document',
    AI_CHAT: 'ai_chat',
} as const;

export type CacheModule = keyof typeof CACHE_MODULES;

/**
 * @deprecated Use getUserCacheKey or getItemCacheKey instead
 * Legacy helper function for backward compatibility
 */
export function getCacheKey(
    type: keyof typeof CACHE_MODULES,
    id: string
): string {
    return `${CACHE_MODULES[type]}:${id}`;
}

/**
 * Generate user-scoped cache key
 * Pattern: {module}:user:{userId}
 * Example: getUserCacheKey('WALLET', 'user123') => 'wallet:user:user123'
 */
export function getUserCacheKey(module: CacheModule, userId: string): string {
    return `${CACHE_MODULES[module]}:user:${userId}`;
}

/**
 * Generate item cache key (scoped by user if provided)
 * Pattern: {module}:user:{userId}:item:{itemId}:{suffix?}
 * Example: getItemCacheKey('QUIZSET', 'user123', 'quiz456', 'questions')
 *          => 'quizset:user:user123:item:quiz456:questions'
 */
export function getItemCacheKey(
    module: CacheModule,
    userId: string,
    itemId: string,
    suffix?: string
): string {
    const baseKey = `${CACHE_MODULES[module]}:user:${userId}:item:${itemId}`;
    return suffix ? `${baseKey}:${suffix}` : baseKey;
}

/**
 * Generate pattern for deleting all user's cache in a module
 * Pattern: {module}:user:{userId}:*
 * Example: getUserCachePattern('QUIZSET', 'user123') => 'quizset:user:user123:*'
 */
export function getUserCachePattern(
    module: CacheModule,
    userId: string
): string {
    return `${CACHE_MODULES[module]}:user:${userId}:*`;
}

/**
 * Generate pattern for deleting specific item's cache
 * Pattern: {module}:user:{userId}:item:{itemId}:*
 */
export function getItemCachePattern(
    module: CacheModule,
    userId: string,
    itemId: string
): string {
    return `${CACHE_MODULES[module]}:user:${userId}:item:${itemId}:*`;
}

/**
 * Generate paginated list cache key
 * Pattern: {module}:user:{userId}:list:{page}:{size}:{hash}
 */
export function getListCacheKey(
    module: CacheModule,
    userId: string,
    page: number,
    size: number,
    filterHash?: string
): string {
    const baseKey = `${CACHE_MODULES[module]}:user:${userId}:list:${page}:${size}`;
    return filterHash ? `${baseKey}:${filterHash}` : baseKey;
}

/**
 * Generate pattern for deleting all lists cache of a user in a module
 * Pattern: {module}:user:{userId}:list:*
 */
export function getListCachePattern(
    module: CacheModule,
    userId: string
): string {
    return `${CACHE_MODULES[module]}:user:${userId}:list:*`;
}

/**
 * Generate public/shared cache key (not user-scoped)
 * Pattern: {module}:public:{itemId}:{suffix?}
 */
export function getPublicCacheKey(
    module: CacheModule,
    itemId: string,
    suffix?: string
): string {
    const baseKey = `${CACHE_MODULES[module]}:public:${itemId}`;
    return suffix ? `${baseKey}:${suffix}` : baseKey;
}

/**
 * Generate pattern for all public cache in a module
 * Pattern: {module}:public:*
 */
export function getPublicCachePattern(module: CacheModule): string {
    return `${CACHE_MODULES[module]}:public:*`;
}

// Backward compatibility - keep old CACHE_KEYS export
export const CACHE_KEYS = CACHE_MODULES;
