import {
    Injectable,
    NotFoundException,
    InternalServerErrorException,
    BadRequestException,
} from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { PrismaService } from 'src/prisma/prisma.service';
import { PDFDocument } from 'pdf-lib';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { PromptUtils } from 'src/utils/prompt';
import { R2Service } from '../r2/r2.service';
import { User } from '@prisma/client';
import { TYPE_RESULT } from './constant/type-result';
import { PdfService } from 'src/common/services/pdf.service';
import { WALLET_TYPE } from '../finance/types/wallet';
import { Job, JobStatus, JobType } from './dto/job.dto';
import {
    getUserCacheKey,
    CACHE_MODULES,
} from 'src/common/constants/cache-keys';
import { RedisService } from 'src/packages/redis/redis.service';

@Injectable()
export class AIService {
    private apiKeys: string[];
    private currentKeyIndex: number = 0;
    // Model rotation support
    private modelNames: string[];
    private currentModelIndex: number = 0;
    private failedModelsPerKey: Map<string, Set<string>> = new Map(); // key -> failed models
    private modelResetTime: number = Date.now() + 60000;
    private ai: GoogleGenAI;
    private failedKeys: Set<string> = new Set();
    private keyResetTime: number = Date.now() + 60000;
    private jobQueue: Map<string, Job> = new Map();

    // --- VECTOR SEARCH CONFIG ---
    public static readonly VECTOR_SEARCH_CONFIG = {
        TOP_K: 15,
        SIMILARITY_THRESHOLD: 0.7,
        MAX_KEYWORDS: 10,
        EMBEDDING_MODEL: 'gemini-embedding-001',
    };

    /**
     * Helper: Create embedding vector for multiple keywords (comma-separated)
     * - Cleans, normalizes, and combines keywords
     * - Uses retryWithBackoff for reliability
     * - Returns embedding vector as number[]
     */
    private async createKeywordEmbedding(keywords: string): Promise<number[]> {
        if (!keywords || typeof keywords !== 'string') {
            throw new BadRequestException(
                'Từ khóa không hợp lệ. Vui lòng sử dụng định dạng: keyword1, keyword2'
            );
        }
        // Split, clean, and validate
        let keywordList = keywords
            .split(',')
            .map((k) => k.trim())
            .filter((k) => k.length > 0);
        if (keywordList.length === 0) {
            throw new BadRequestException(
                'Từ khóa không hợp lệ. Vui lòng sử dụng định dạng: keyword1, keyword2'
            );
        }
        if (keywordList.length > AIService.VECTOR_SEARCH_CONFIG.MAX_KEYWORDS) {
            throw new BadRequestException(
                `Quá nhiều từ khóa. Tối đa ${AIService.VECTOR_SEARCH_CONFIG.MAX_KEYWORDS} từ khóa`
            );
        }
        // Combine into single string for embedding
        const combined = keywordList.join(' ');
        try {
            const embeddingResponse = await this.retryWithBackoff(() =>
                this.ensureClient().models.embedContent({
                    model: AIService.VECTOR_SEARCH_CONFIG.EMBEDDING_MODEL,
                    contents: combined,
                })
            );
            const vector =
                embeddingResponse.embeddings &&
                Array.isArray(embeddingResponse.embeddings)
                    ? embeddingResponse.embeddings.map((e) => e.values).flat()
                    : [];
            if (!vector.length) {
                throw new Error('Empty embedding vector');
            }
            if (vector.length === 0) {
                throw new Error('Empty embedding vector');
            }
            return vector.filter((v): v is number => typeof v === 'number');
        } catch (err) {
            console.error('❌ Error creating keyword embedding:', err);
            throw new InternalServerErrorException(
                'Không tạo được embedding cho từ khóa'
            );
        }
    }

    /**
     * Helper: Find similar document chunks using vector search (pgvector)
     * - Uses raw SQL with cosine similarity
     * - Filters by similarity threshold, orders by similarity, limits to topK
     * - Returns filtered document chunks
     */
    private async findSimilarDocuments(
        userStorageIds: string | string[],
        keywordEmbedding: number[],
        topK?: number,
        similarityThreshold?: number
    ): Promise<any[]> {
        if (!Array.isArray(keywordEmbedding) || !keywordEmbedding.length) {
            throw new BadRequestException('Embedding vector không hợp lệ');
        }

        // Normalize ids to array
        const ids = Array.isArray(userStorageIds)
            ? userStorageIds
            : [userStorageIds];

        // Set defaults if not provided
        const finalTopK =
            typeof topK === 'number'
                ? topK
                : AIService.VECTOR_SEARCH_CONFIG.TOP_K;
        const finalThreshold =
            typeof similarityThreshold === 'number'
                ? similarityThreshold
                : AIService.VECTOR_SEARCH_CONFIG.SIMILARITY_THRESHOLD;
        try {
            // Use $1: embedding, $2: userStorageIds array, $3: threshold, $4: topK
            // Using = ANY($2::text[]) to match any of the provided IDs
            const result = await this.prisma.$queryRawUnsafe(
                `SELECT id, "userStorageId", "pageRange", title, content, "createdAt", "updatedAt",
                    1 - (embeddings <=> $1::vector) as similarity_score
                 FROM "Document"
                 WHERE "userStorageId" = ANY($2::text[])
                   AND 1 - (embeddings <=> $1::vector) > $3
                 ORDER BY embeddings <=> $1::vector ASC
                 LIMIT $4;`,
                `[${keywordEmbedding.join(',')}]`,
                ids,
                finalThreshold,
                finalTopK
            );
            return Array.isArray(result) ? result : [];
        } catch (err) {
            console.error('❌ Error in findSimilarDocuments:', err);
            throw new InternalServerErrorException(
                'Không thể thực hiện truy vấn vector search'
            );
        }
    }

    constructor(
        private readonly prisma: PrismaService,
        private readonly generateIdService: GenerateIdService,
        private readonly r2Service: R2Service,
        private readonly pdfService: PdfService,
        private readonly redisService: RedisService
    ) {
        this.apiKeys =
            process.env.GEMINI_API_KEYS?.split(',').map((key) => key.trim()) ||
            [];
        this.modelNames = process.env.GEMINI_MODAL_NAME?.split(',').map((m) =>
            m.trim()
        ) || ['gemini-2.0-flash'];
    }

    /**
     * Public method for semantic document search
     * Creates embedding from query and finds similar document chunks
     * @param userStorageId Document ID
     * @param query User's question/query text
     * @param topK Number of chunks to return (default: 5)
     * @returns Combined content from most relevant chunks
     */
    async searchDocumentsByQuery(
        userStorageIds: string | string[],
        query: string,
        topK: number = 5
    ): Promise<string | null> {
        try {
            // Create embedding for the query
            const queryEmbedding = await this.createQueryEmbedding(query);

            // Find similar documents
            const similarDocs = await this.findSimilarDocuments(
                userStorageIds,
                queryEmbedding,
                topK,
                0.5 // Lower threshold for chat context to get more relevant results
            );

            if (!similarDocs.length) {
                return null;
            }

            // Combine content from similar chunks
            let combinedContent = '';
            for (const doc of similarDocs) {
                const chunk = `[Trang ${doc.pageRange}]: ${doc.content}\n\n`;
                if (combinedContent.length + chunk.length > 6000) break;
                combinedContent += chunk;
            }

            return combinedContent.trim() || null;
        } catch (error) {
            console.error('[AIService] searchDocumentsByQuery error:', error);
            return null;
        }
    }

    /**
     * Create embedding for a query string (simpler than keyword embedding)
     */
    private async createQueryEmbedding(query: string): Promise<number[]> {
        const embeddingResponse = await this.retryWithBackoff(() =>
            this.ensureClient().models.embedContent({
                model: AIService.VECTOR_SEARCH_CONFIG.EMBEDDING_MODEL,
                contents: query,
            })
        );

        const vector =
            embeddingResponse.embeddings &&
            Array.isArray(embeddingResponse.embeddings)
                ? embeddingResponse.embeddings.map((e) => e.values).flat()
                : [];

        if (!vector.length) {
            throw new Error('Empty embedding vector');
        }

        return vector.filter((v): v is number => typeof v === 'number');
    }

    private getNextApiKey(): string {
        if (!this.apiKeys.length) {
            throw new NotFoundException('Không có API keys được cấu hình');
        }

        if (Date.now() > this.keyResetTime) {
            console.log('🔄 Reset danh sách failed keys...');
            this.failedKeys.clear();
            this.keyResetTime = Date.now() + 60000;
        }

        const availableKeys = this.apiKeys.filter(
            (key) => !this.failedKeys.has(key)
        );

        if (availableKeys.length === 0) {
            throw new NotFoundException(
                'Tất cả API keys đều đã hết quota. Vui lòng chờ hoặc thêm keys mới.'
            );
        }

        const keyIndex = this.currentKeyIndex % availableKeys.length;
        const selectedKey = availableKeys[keyIndex];
        this.currentKeyIndex =
            (this.currentKeyIndex + 1) % availableKeys.length;

        console.log(
            `🔑 Sử dụng API key ${keyIndex + 1}/${availableKeys.length} (${availableKeys.length} khả dụng)`
        );
        return selectedKey;
    }

    private markKeyAsFailed(apiKey: string) {
        this.failedKeys.add(apiKey);
        console.log(
            `❌ Đánh dấu API key đã fail. Tổng failed: ${this.failedKeys.size}/${this.apiKeys.length}`
        );
    }

    private createClient(): GoogleGenAI {
        const apiKey = this.getNextApiKey();
        return new GoogleGenAI({ apiKey });
    }

    private ensureClient() {
        if (!this.ai) {
            this.ai = this.createClient();
        }
        return this.ai;
    }

    /**
     * Get the current model name for API calls
     * Models are rotated when errors occur (priority over key rotation)
     */
    private getNextModel(): string {
        if (!this.modelNames.length) {
            return 'gemini-2.0-flash';
        }

        // Reset failed models if time expired
        if (Date.now() > this.modelResetTime) {
            console.log('🔄 Reset danh sách failed models...');
            this.failedModelsPerKey.clear();
            this.modelResetTime = Date.now() + 60000;
        }

        const currentKey =
            this.apiKeys[this.currentKeyIndex % this.apiKeys.length] ||
            'default';
        const failedModels =
            this.failedModelsPerKey.get(currentKey) || new Set();

        const availableModels = this.modelNames.filter(
            (model) => !failedModels.has(model)
        );

        if (availableModels.length === 0) {
            // All models failed for this key, reset and use first model
            this.currentModelIndex = 0;
            return this.modelNames[0];
        }

        const modelIndex = this.currentModelIndex % availableModels.length;
        const selectedModel = availableModels[modelIndex];

        console.log(
            `🤖 Sử dụng model ${modelIndex + 1}/${availableModels.length}: ${selectedModel}`
        );
        return selectedModel;
    }

    /**
     * Mark current model as failed for current key
     * When all models fail for a key, rotate to next key and reset model index
     */
    private markModelAsFailed(model: string): boolean {
        const currentKey =
            this.apiKeys[Math.max(0, this.currentKeyIndex - 1)] || 'default';

        if (!this.failedModelsPerKey.has(currentKey)) {
            this.failedModelsPerKey.set(currentKey, new Set());
        }
        this.failedModelsPerKey.get(currentKey)!.add(model);

        const failedModels = this.failedModelsPerKey.get(currentKey)!;
        console.log(
            `❌ Đánh dấu model "${model}" đã fail cho key hiện tại. Tổng failed: ${failedModels.size}/${this.modelNames.length}`
        );

        // Check if all models failed for this key
        if (failedModels.size >= this.modelNames.length) {
            console.log(
                '⚠️ Tất cả models đều fail cho key hiện tại, chuyển sang key tiếp theo...'
            );
            this.currentModelIndex = 0; // Reset model index for next key
            return true; // Signal to rotate key
        }

        // Rotate to next model
        this.currentModelIndex =
            (this.currentModelIndex + 1) % this.modelNames.length;
        return false; // Don't rotate key yet
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    private async retryWithBackoff<T>(
        fn: () => Promise<T>,
        maxRetries: number = 5,
        initialDelay: number = 1000
    ): Promise<T> {
        let lastError: any;
        const jitter = () => Math.floor(Math.random() * 300);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error: any) {
                lastError = error;

                const status =
                    error?.status ?? error?.error?.code ?? error?.error?.status;
                const is429 = status === 429 || status === 'TOO_MANY_REQUESTS';
                const is503 =
                    status === 503 ||
                    (typeof status === 'string' &&
                        status.toUpperCase().includes('UNAVAILABLE')) ||
                    error?.message?.includes('UNAVAILABLE') ||
                    error?.message?.includes('Service Unavailable');

                // 429 -> mark key failed and rotate to next key
                if (is429) {
                    try {
                        const currentKey =
                            this.apiKeys[Math.max(0, this.currentKeyIndex - 1)];
                        if (currentKey) this.markKeyAsFailed(currentKey);
                    } catch (e) {
                        console.warn(
                            'Không lấy được currentKey để mark failed',
                            e
                        );
                    }

                    // try to create new client (may throw if no keys left)
                    try {
                        this.ai = this.createClient();
                    } catch (e) {
                        throw new InternalServerErrorException(
                            'Tất cả API keys đều đã hết quota.'
                        );
                    }

                    const delayTime =
                        initialDelay * Math.pow(1.5, attempt - 1) + jitter();
                    if (attempt < maxRetries) {
                        await this.delay(delayTime);
                        continue;
                    }
                }

                // 503 / UNAVAILABLE -> transient, retry with backoff but DO NOT mark key as failed
                if (is503) {
                    const delayTime =
                        initialDelay * Math.pow(1.6, attempt - 1) + jitter();
                    if (attempt < maxRetries) {
                        await this.delay(delayTime);
                        continue;
                    }
                }

                // non-retryable
                throw error;
            }
        }

        throw lastError;
    }

    async generateContent(prompt: string): Promise<string | undefined> {
        const response = await this.retryWithBackoff(async () => {
            return this.ensureClient().models.generateContent({
                model: this.getNextModel(),
                contents: prompt,
            });
        });
        return response.text;
    }

    /**
     * Generate content with streaming support
     * @param prompt Text prompt
     * @returns AsyncGenerator yielding text chunks
     */
    async *generateContentStream(
        prompt: string
    ): AsyncGenerator<string, void, unknown> {
        const response = await this.ensureClient().models.generateContentStream(
            {
                model: this.getNextModel(),
                contents: prompt,
            }
        );

        for await (const chunk of response) {
            if (chunk.text) {
                yield chunk.text;
            }
        }
    }

    /**
     * Generate content with image input using streaming
     */
    async *generateContentWithImageStream(
        prompt: string,
        base64ImageData: string,
        mimeType: string
    ): AsyncGenerator<string, void, unknown> {
        const response = await this.ensureClient().models.generateContentStream(
            {
                model: 'gemini-2.5-flash',
                contents: [
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64ImageData,
                        },
                    },
                    { text: prompt },
                ],
            }
        );

        for await (const chunk of response) {
            if (chunk.text) {
                yield chunk.text;
            }
        }
    }

    /**
     * Chat with conversation history using streaming
     * Uses ai.chats.create for context-aware responses
     * @param message Current user message
     * @param history Array of previous messages in format { role: 'user' | 'model', content: string }
     * @param systemPrompt Optional system instruction
     */
    async *generateChatWithHistoryStream(
        message: string,
        history: Array<{ role: 'user' | 'model'; content: string }>,
        systemPrompt?: string
    ): AsyncGenerator<string, void, unknown> {
        // Convert history to Gemini format
        const formattedHistory = history.map((msg) => ({
            role: msg.role,
            parts: [{ text: msg.content }],
        }));

        // Create chat session with history
        const chat = this.ensureClient().chats.create({
            model: this.getNextModel(),
            history: formattedHistory,
            config: systemPrompt
                ? { systemInstruction: systemPrompt }
                : undefined,
        });

        // Send message and stream response
        const response = await chat.sendMessageStream({ message });

        for await (const chunk of response) {
            if (chunk.text) {
                yield chunk.text;
            }
        }
    }

    /**
     * Generate content with image input
     * @param prompt Text prompt
     * @param base64ImageData Base64 encoded image data
     * @param mimeType Image MIME type (e.g., 'image/jpeg', 'image/png')
     */
    async generateContentWithImage(
        prompt: string,
        base64ImageData: string,
        mimeType: string
    ): Promise<string | undefined> {
        const response = await this.retryWithBackoff(async () => {
            return this.ensureClient().models.generateContent({
                model: 'gemini-2.5-flash', // Use vision-capable model
                contents: [
                    {
                        inlineData: {
                            mimeType: mimeType,
                            data: base64ImageData,
                        },
                    },
                    { text: prompt },
                ],
            });
        });
        return response.text;
    }

    private async splitPdfToChunks(
        buffer: Buffer,
        chunkSize: number
    ): Promise<Buffer[]> {
        try {
            console.log('🔧 Starting PDF splitting...');

            if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
                throw new Error('Invalid buffer provided');
            }

            const pdfDoc = await PDFDocument.load(buffer);
            const totalPages = pdfDoc.getPageCount();

            if (totalPages === 0) {
                throw new Error('PDF has no pages');
            }

            const chunks: Buffer[] = [];

            for (let i = 0; i < totalPages; i += chunkSize) {
                const end = Math.min(i + chunkSize, totalPages);

                try {
                    const newPdf = await PDFDocument.create();
                    const pages = await newPdf.copyPages(
                        pdfDoc,
                        Array.from({ length: end - i }, (_, idx) => i + idx)
                    );
                    pages.forEach((page) => newPdf.addPage(page));
                    const pdfBytes = await newPdf.save();
                    const chunkBuffer = Buffer.from(pdfBytes);

                    if (chunkBuffer.length > 0) {
                        chunks.push(chunkBuffer);
                    }
                } catch (chunkError) {
                    console.error(
                        `❌ Error creating chunk ${i + 1}-${end}:`,
                        chunkError
                    );
                    continue;
                }
            }

            if (chunks.length === 0) {
                throw new Error('No valid chunks created');
            }

            console.log(`🎯 Successfully created ${chunks.length} chunks`);
            return chunks;
        } catch (error) {
            console.error('❌ Error splitting PDF:', error);
            throw new InternalServerErrorException(
                `Failed to split PDF: ${error.message}`
            );
        }
    }

    // ================== CREDIT CALCULATION HELPERS ==================

    /**
     * Calculate OCR cost based on file size
     * Formula: max(2, ceil(file_size_MB))
     */
    private calculateOcrCost(fileSize: number): number {
        return Math.max(2, Math.ceil(fileSize / (1024 * 1024)));
    }

    /**
     * Calculate question/flashcard generation cost
     * Formula: ceil(count / 10) - 10 questions = 1 token
     */
    private calculateQuestionCost(count: number): number {
        return Math.ceil(count / 10);
    }

    /**
     * Check if user has enough credit for total cost
     */
    private async checkUserBalance(
        userId: string,
        totalCost: number
    ): Promise<void> {
        const wallet = await this.prisma.wallet.findUnique({
            where: { userId },
        });
        if (!wallet || wallet.balance < totalCost) {
            throw new BadRequestException(
                `Không đủ tín dụng. Cần ${totalCost} tokens, hiện có ${wallet?.balance || 0} tokens`
            );
        }
    }

    /**
     * Charge for OCR + embedding (only if not already charged)
     * Sets creditCharged = true on UserStorage
     */
    private async chargeForOcr(
        userId: string,
        fileSize: number,
        userStorageId: string,
        filename: string
    ): Promise<number> {
        // Check if already charged
        const userStorage = await this.prisma.userStorage.findUnique({
            where: { id: userStorageId },
        });

        if (userStorage?.creditCharged) {
            console.log(
                `[chargeForOcr] Already charged for ${userStorageId}, skipping`
            );
            return 0;
        }

        const cost = this.calculateOcrCost(fileSize);

        await this.prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.findUnique({
                where: { userId },
            });

            if (!wallet || wallet.balance < cost) {
                throw new BadRequestException('Không đủ tín dụng');
            }

            await tx.wallet.update({
                where: { userId },
                data: { balance: { decrement: cost } },
            });

            await tx.walletTransaction.create({
                data: {
                    id: this.generateIdService.generateId(),
                    walletId: wallet.id,
                    amount: cost,
                    type: WALLET_TYPE.OCR_EMBEDDING,
                    direction: 'SUBTRACT',
                    description: `Xử lý OCR và lưu trữ file "${filename}" (${(fileSize / (1024 * 1024)).toFixed(2)} MB)`,
                },
            });

            // Mark as charged
            await tx.userStorage.update({
                where: { id: userStorageId },
                data: { creditCharged: true },
            });
        });

        // Invalidate cache
        await this.invalidateUserCache(userId);

        console.log(
            `[chargeForOcr] Charged ${cost} tokens for OCR of ${filename}`
        );
        return cost;
    }

    /**
     * Charge for quiz/flashcard generation based on actual result count
     * Uses proportional pricing: ceil(count / 10)
     */
    private async chargeForQuestions(
        userId: string,
        actualCount: number,
        isFlashcard: boolean,
        userStorageId: string,
        filename: string
    ): Promise<number> {
        if (actualCount <= 0) {
            console.log(`[chargeForQuestions] No results, skipping charge`);
            return 0; // No charge if no results
        }

        const cost = this.calculateQuestionCost(actualCount);
        const type = isFlashcard
            ? WALLET_TYPE.FLASHCARD_GENERATION
            : WALLET_TYPE.QUIZ_GENERATION;
        const typeName = isFlashcard ? 'flashcard' : 'câu hỏi';

        await this.prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.findUnique({
                where: { userId },
            });

            if (!wallet || wallet.balance < cost) {
                throw new BadRequestException('Không đủ tín dụng');
            }

            await tx.wallet.update({
                where: { userId },
                data: { balance: { decrement: cost } },
            });

            await tx.walletTransaction.create({
                data: {
                    id: this.generateIdService.generateId(),
                    walletId: wallet.id,
                    amount: cost,
                    type: type,
                    direction: 'SUBTRACT',
                    description: `Tạo ${actualCount} ${typeName} từ file "${filename}"`,
                },
            });
        });

        // Invalidate cache
        await this.invalidateUserCache(userId);

        console.log(
            `[chargeForQuestions] Charged ${cost} tokens for ${actualCount} ${typeName}`
        );
        return cost;
    }

    /**
     * Invalidate user and wallet cache
     */
    private async invalidateUserCache(userId: string): Promise<void> {
        await this.redisService.del(getUserCacheKey('USER', userId));
        await this.redisService.del(getUserCacheKey('WALLET', userId));
        await this.redisService.delPattern(`user:*${userId}*`);
        await this.redisService.delPattern(`wallet:*${userId}*`);
    }

    /**
     * @deprecated Use chargeForOcr and chargeForQuestions instead
     * Kept for backward compatibility during transition
     */
    private async decrementUserCredit(userId: string, fileSize: number) {
        const cost = Math.max(2, Math.ceil(fileSize / (1024 * 1024)));

        await this.prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.findUnique({
                where: { userId },
            });

            if (!wallet || wallet.balance < cost) {
                throw new BadRequestException('Not enough credits');
            }

            await tx.wallet.update({
                where: { userId },
                data: { balance: { decrement: cost } },
            });

            await tx.walletTransaction.create({
                data: {
                    id: this.generateIdService.generateId(),
                    walletId: wallet.id,
                    amount: cost,
                    type: WALLET_TYPE.USE_SERVICES,
                    description: `Sử dụng dịch vụ AI với file ${(fileSize / (1024 * 1024)).toFixed(2)} MB`,
                },
            });
        });

        await this.invalidateUserCache(userId);
    }

    async handleActionsWithFile(
        file: any,
        user: User,
        typeResult: number,
        quantityFlashcard?: number,
        quantityQuizz?: number,
        isNarrowSearch: boolean = false,
        keyword?: string
    ) {
        // Calculate expected costs upfront
        const requestedQuantity =
            Number(typeResult) === TYPE_RESULT.QUIZZ
                ? quantityQuizz || 40
                : quantityFlashcard || 40;
        const ocrCost = this.calculateOcrCost(file.size);
        const questionCost = this.calculateQuestionCost(requestedQuantity);
        const totalCost = ocrCost + questionCost;

        // Check total balance upfront
        await this.checkUserBalance(user.id, totalCost);

        // Validate keyword for narrow search
        if (isNarrowSearch === true) {
            if (!keyword || keyword.trim().length === 0) {
                throw new BadRequestException(
                    'Khi isNarrowSearch là true, keyword không được để trống'
                );
            }
            const keywordList = keyword
                .split(',')
                .map((k) => k.trim())
                .filter((k) => k.length > 0);
            if (keywordList.length === 0) {
                throw new BadRequestException(
                    'Từ khóa không hợp lệ. Vui lòng sử dụng định dạng: keyword1, keyword2'
                );
            }
            if (
                keywordList.length > AIService.VECTOR_SEARCH_CONFIG.MAX_KEYWORDS
            ) {
                throw new BadRequestException(
                    `Quá nhiều từ khóa. Tối đa ${AIService.VECTOR_SEARCH_CONFIG.MAX_KEYWORDS} từ khóa`
                );
            }
        }

        try {
            console.log('🚀 Starting handleActionsWithFile...');
            this.validatePdfFile(file);
            const userStorage = await this.uploadAndCreateUserStorage(
                file,
                user
            );

            // OCR + embedding
            await this.extractAndSavePdfChunks(file, userStorage.id);

            // Charge for OCR after successful extraction
            await this.chargeForOcr(
                user.id,
                file.size,
                userStorage.id,
                userStorage.filename
            );

            let result;
            let actualCount = 0;
            const isFlashcard = Number(typeResult) === TYPE_RESULT.FLASHCARD;

            if (Number(typeResult) === TYPE_RESULT.QUIZZ) {
                const quiz = await this.generateQuizChunkBased(
                    userStorage.id,
                    quantityQuizz || 40,
                    isNarrowSearch,
                    keyword
                );
                actualCount = quiz.length;

                result = await this.saveQuizzesToHistory(
                    quiz,
                    user.id,
                    userStorage.id
                );
            } else if (isFlashcard) {
                const flashcards = await this.generateFlashcardsChunkBased(
                    userStorage.id,
                    quantityFlashcard || 40,
                    isNarrowSearch,
                    keyword
                );
                actualCount = flashcards.length;

                result = await this.saveFlashcardsToHistory(
                    flashcards,
                    user.id,
                    userStorage.id
                );
            } else {
                throw new BadRequestException(
                    `Invalid typeResult: ${typeResult}`
                );
            }

            // Charge for questions/flashcards based on ACTUAL count returned
            await this.chargeForQuestions(
                user.id,
                actualCount,
                isFlashcard,
                userStorage.id,
                userStorage.filename
            );

            return result;
        } catch (error) {
            console.error('❌ Error in handleActionsWithFile:', error);
            throw error;
        }
    }

    /**
     * Lưu danh sách quiz vào bảng HistoryGeneratedQuizz (upsert - thay thế nếu đã tồn tại)
     */
    private async saveQuizzesToHistory(
        quizzes: any[],
        userId: string,
        userStorageId: string
    ) {
        // Check if history already exists for this user + storage
        const existingHistory =
            await this.prisma.historyGeneratedQuizz.findFirst({
                where: {
                    userId: userId,
                    userStorageId: userStorageId,
                },
            });

        let savedHistory;
        if (existingHistory) {
            // Update existing history
            savedHistory = await this.prisma.historyGeneratedQuizz.update({
                where: { id: existingHistory.id },
                data: {
                    quizzes: quizzes,
                    updatedAt: new Date(),
                },
            });
            console.log(
                `✅ Đã cập nhật ${quizzes.length} câu hỏi vào history record ${existingHistory.id}`
            );
        } else {
            // Create new history
            savedHistory = await this.prisma.historyGeneratedQuizz.create({
                data: {
                    id: this.generateIdService.generateId(),
                    userId: userId,
                    userStorageId: userStorageId,
                    quizzes: quizzes,
                },
            });
            console.log(
                `✅ Đã tạo mới ${quizzes.length} câu hỏi vào history record`
            );
        }

        return savedHistory;
    }

    /**
     * Lưu danh sách flashcards vào bảng HistoryGeneratedFlashcard (upsert - thay thế nếu đã tồn tại)
     */
    private async saveFlashcardsToHistory(
        flashcards: any[],
        userId: string,
        userStorageId: string
    ) {
        // Check if history already exists for this user + storage
        const existingHistory =
            await this.prisma.historyGeneratedFlashcard.findFirst({
                where: {
                    userId: userId,
                    userStorageId: userStorageId,
                },
            });

        let savedHistory;
        if (existingHistory) {
            // Update existing history
            savedHistory = await this.prisma.historyGeneratedFlashcard.update({
                where: { id: existingHistory.id },
                data: {
                    flashcards: flashcards,
                    updatedAt: new Date(),
                },
            });
            console.log(
                `✅ Đã cập nhật ${flashcards.length} flashcards vào history record ${existingHistory.id}`
            );
        } else {
            // Create new history
            savedHistory = await this.prisma.historyGeneratedFlashcard.create({
                data: {
                    id: this.generateIdService.generateId(),
                    userId: userId,
                    userStorageId: userStorageId,
                    flashcards: flashcards,
                },
            });
            console.log(
                `✅ Đã tạo mới ${flashcards.length} flashcards vào history record`
            );
        }

        return savedHistory;
    }

    /**
     * Create a new job and add to queue
     */
    async createJob(
        file: Express.Multer.File,
        user: User,
        typeResult: number,
        quantityFlashcard?: number,
        quantityQuizz?: number,
        isNarrowSearch?: boolean,
        keyword?: string
    ): Promise<string> {
        // Check credits before creating job
        const cost = Math.max(2, Math.ceil(file.size / (1024 * 1024))); // 2 credit per MB
        const wallet = await this.prisma.wallet.findUnique({
            where: { userId: user.id },
        });

        if (!wallet || wallet.balance < cost) {
            throw new BadRequestException('Không đủ tín dụng');
        }

        const jobId = this.generateIdService.generateId();
        const job: Job = {
            id: jobId,
            status: JobStatus.PENDING,
            type:
                typeResult === TYPE_RESULT.QUIZZ
                    ? JobType.QUIZ
                    : typeResult === TYPE_RESULT.FLASHCARD
                      ? JobType.FLASHCARD
                      : JobType.KNOWLEDGE_BASE,
            userId: user.id,
            file,
            params: {
                typeResult,
                quantityFlashcard,
                quantityQuizz,
                isNarrowSearch,
                keyword,
            },
            progress: 0,
            createdAt: new Date(),
        };
        this.jobQueue.set(jobId, job);
        console.log(`✅ Created job ${jobId} for user ${user.id}`);

        // Start processing async
        this.processJobAsync(jobId).catch((error) => {
            console.error(`❌ Error processing job ${jobId}:`, error);
        });

        return jobId;
    }

    /**
     * Process job asynchronously
     */
    private async processJobAsync(jobId: string): Promise<void> {
        const job = this.jobQueue.get(jobId);
        if (!job) {
            console.error(`Job ${jobId} not found`);
            return;
        }

        if (!job.file) {
            console.error(`Job ${jobId} has no file`);
            job.status = JobStatus.FAILED;
            job.error = 'No file provided';
            this.jobQueue.set(jobId, job);
            return;
        }

        try {
            // Calculate expected costs upfront
            const requestedQuantity =
                Number(job.params.typeResult) === TYPE_RESULT.QUIZZ
                    ? job.params.quantityQuizz || 40
                    : Number(job.params.typeResult) === TYPE_RESULT.FLASHCARD
                      ? job.params.quantityFlashcard || 40
                      : 0;
            const ocrCost = this.calculateOcrCost(job.file.size);
            const questionCost = this.calculateQuestionCost(requestedQuantity);
            const totalCost = ocrCost + questionCost;

            // Check total balance upfront
            await this.checkUserBalance(job.userId, totalCost);

            // Update status to processing
            job.status = JobStatus.PROCESSING;
            job.startedAt = new Date();
            job.progress = 10;
            this.jobQueue.set(jobId, job);

            console.log(`🚀 Processing job ${jobId}...`);

            // Get user info
            const user = await this.prisma.user.findUnique({
                where: { id: job.userId },
            });

            if (!user) {
                throw new NotFoundException('User not found');
            }

            // Validate and upload
            this.validatePdfFile(job.file);

            // Validate page count
            const pdfDoc = await PDFDocument.load(job.file.buffer);
            const pageCount = pdfDoc.getPageCount();
            if (pageCount > 50) {
                throw new BadRequestException(
                    `File PDF có ${pageCount} trang. Giới hạn tối đa là 50 trang.`
                );
            }

            job.progress = 20;
            this.jobQueue.set(jobId, job);

            const userStorage = await this.uploadAndCreateUserStorage(
                job.file,
                user
            );
            job.progress = 40;
            this.jobQueue.set(jobId, job);

            await this.extractAndSavePdfChunks(job.file, userStorage.id);
            job.progress = 60;
            this.jobQueue.set(jobId, job);

            // Charge for OCR after successful extraction
            await this.chargeForOcr(
                user.id,
                job.file.size,
                userStorage.id,
                userStorage.filename
            );

            let actualCount = 0;
            const isFlashcard =
                Number(job.params.typeResult) === TYPE_RESULT.FLASHCARD;

            // Generate based on type
            if (Number(job.params.typeResult) === TYPE_RESULT.QUIZZ) {
                const quiz = await this.generateQuizChunkBased(
                    userStorage.id,
                    job.params.quantityQuizz || 40,
                    job.params.isNarrowSearch || false,
                    job.params.keyword
                );
                actualCount = quiz.length;
                job.progress = 80;
                this.jobQueue.set(jobId, job);

                const savedQuizzes = await this.saveQuizzesToHistory(
                    quiz,
                    user.id,
                    userStorage.id
                );
                job.progress = 90;
                this.jobQueue.set(jobId, job);

                job.result = {
                    type: JobType.QUIZ,
                    quizzes: savedQuizzes.quizzes as any[],
                    historyId: savedQuizzes.id,
                    fileInfo: {
                        id: userStorage.id,
                        filename: userStorage.filename,
                    },
                };
            } else if (isFlashcard) {
                const flashcards = await this.generateFlashcardsChunkBased(
                    userStorage.id,
                    job.params.quantityFlashcard || 40,
                    job.params.isNarrowSearch || false,
                    job.params.keyword
                );
                actualCount = flashcards.length;
                job.progress = 80;
                this.jobQueue.set(jobId, job);

                const savedFlashcards = await this.saveFlashcardsToHistory(
                    flashcards,
                    user.id,
                    userStorage.id
                );
                job.progress = 90;
                this.jobQueue.set(jobId, job);

                job.result = {
                    type: JobType.FLASHCARD,
                    flashcards: savedFlashcards.flashcards as any[],
                    historyId: savedFlashcards.id,
                    fileInfo: {
                        id: userStorage.id,
                        filename: userStorage.filename,
                    },
                };
            } else if (
                Number(job.params.typeResult) === TYPE_RESULT.KNOWLEDGE_BASE
            ) {
                // Knowledge base only needs OCR, no question generation
                job.progress = 90;
                this.jobQueue.set(jobId, job);

                job.result = {
                    type: JobType.KNOWLEDGE_BASE,
                    fileInfo: {
                        id: userStorage.id,
                        filename: userStorage.filename,
                    },
                };
            }

            // Charge for questions/flashcards based on ACTUAL count (skip for knowledge base)
            if (actualCount > 0) {
                await this.chargeForQuestions(
                    user.id,
                    actualCount,
                    isFlashcard,
                    userStorage.id,
                    userStorage.filename
                );
            }

            // Mark as completed
            job.status = JobStatus.COMPLETED;
            job.progress = 100;
            job.completedAt = new Date();
            this.jobQueue.set(jobId, job);

            console.log(`✅ Job ${jobId} completed successfully`);
        } catch (error) {
            console.error(`❌ Job ${jobId} failed:`, error);
            job.status = JobStatus.FAILED;
            job.error =
                error instanceof Error ? error.message : 'Unknown error';
            job.completedAt = new Date();
            this.jobQueue.set(jobId, job);
            // Note: OCR may have been charged, but questions were not charged since they failed
        }
    }

    /**
     * Get job status
     */
    getJobStatus(jobId: string) {
        const job = this.jobQueue.get(jobId);
        if (!job) {
            throw new NotFoundException(`Job ${jobId} not found`);
        }

        return {
            jobId: job.id,
            status: job.status,
            progress: job.progress,
            message:
                job.status === JobStatus.COMPLETED
                    ? 'Job completed successfully'
                    : job.status === JobStatus.FAILED
                      ? job.error
                      : job.status === JobStatus.PROCESSING
                        ? 'Processing...'
                        : 'Waiting in queue',
            error: job.error,
            result: job.result,
        };
    }

    /**
     * Cancel a job with rollback
     */
    async cancelJob(jobId: string, userId: string) {
        const job = this.jobQueue.get(jobId);
        if (!job) {
            throw new NotFoundException(`Job ${jobId} not found`);
        }

        if (job.userId !== userId) {
            throw new BadRequestException('Unauthorized to cancel this job');
        }

        if (
            job.status === JobStatus.COMPLETED ||
            job.status === JobStatus.FAILED
        ) {
            throw new BadRequestException(
                'Cannot cancel completed or failed job'
            );
        }

        // Rollback any data created during job processing
        try {
            await this.prisma.$transaction(async (tx) => {
                // If job has result with historyId, delete the history record
                if (job.result?.historyId) {
                    if (job.type === JobType.QUIZ) {
                        await tx.historyGeneratedQuizz.deleteMany({
                            where: { id: job.result.historyId },
                        });
                    } else {
                        await tx.historyGeneratedFlashcard.deleteMany({
                            where: { id: job.result.historyId },
                        });
                    }
                    console.log(
                        `🗑️ Rolled back history ${job.result.historyId}`
                    );
                }

                // If job created a new file (not regenerate), delete userStorage and documents
                if (job.result?.fileInfo?.id && !job.params.uploadId) {
                    // Delete documents first
                    await tx.document.deleteMany({
                        where: { userStorageId: job.result.fileInfo.id },
                    });
                    // Delete userStorage
                    await tx.userStorage.deleteMany({
                        where: { id: job.result.fileInfo.id },
                    });
                    console.log(
                        `🗑️ Rolled back storage ${job.result.fileInfo.id}`
                    );
                }
            });
        } catch (error) {
            console.error(`Error rolling back job ${jobId}:`, error);
            // Continue to cancel job even if rollback fails
        }

        job.status = JobStatus.FAILED;
        job.error = 'Job canceled by user';
        job.completedAt = new Date();
        this.jobQueue.set(jobId, job);

        console.log(
            `🚫 Job ${jobId} canceled and rolled back by user ${userId}`
        );
        return { success: true, message: 'Job canceled and data rolled back' };
    }

    private validatePdfFile(file: any) {
        if (!file) {
            throw new BadRequestException('Chưa cung cấp file');
        }

        const supportedMimeTypes = ['application/pdf'];
        if (!file.mimetype || !supportedMimeTypes.includes(file.mimetype)) {
            throw new BadRequestException('Chỉ hỗ trợ tệp PDF');
        }

        if (!file.buffer || file.buffer.length === 0) {
            throw new BadRequestException('Buffer file không hợp lệ');
        }

        if (file.size > 10 * 1024 * 1024) {
            throw new BadRequestException('Giới hạn kích thước tệp là 10MB');
        }

        try {
            const pdfSignature = file.buffer.slice(0, 4).toString();
            if (pdfSignature !== '%PDF') {
                throw new BadRequestException('File không phải PDF hợp lệ');
            }
        } catch (error) {
            throw new BadRequestException('Cannot validate PDF format');
        }
    }

    /**
     * Normalize filename - remove Vietnamese diacritics and special characters
     */
    private normalizeFilename(filename: string): string {
        // Normalize Vietnamese characters
        const normalized = filename
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'D')
            .replace(/[^a-zA-Z0-9._-]/g, '_') // Replace special chars with underscore
            .replace(/_+/g, '_') // Remove multiple underscores
            .replace(/^_|_$/g, ''); // Remove leading/trailing underscores

        return normalized || 'file';
    }

    /**
     * Upload image for AI chat and return URL
     */
    async uploadChatImage(
        file: Express.Multer.File,
        userId: string
    ): Promise<{ url: string }> {
        if (!file) {
            throw new BadRequestException('Chưa cung cấp hình ảnh');
        }

        const supportedMimeTypes = [
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
        ];
        if (!file.mimetype || !supportedMimeTypes.includes(file.mimetype)) {
            throw new BadRequestException(
                'Chỉ hỗ trợ ảnh định dạng JPEG, PNG, GIF, WebP'
            );
        }

        if (file.size > 5 * 1024 * 1024) {
            throw new BadRequestException('Giới hạn kích thước ảnh là 5MB');
        }

        const r2Key = `chat-images/${userId}/${this.generateIdService.generateId()}`;
        const r2File = await this.r2Service.uploadFile(
            r2Key,
            file.buffer,
            file.mimetype
        );

        if (!r2File) {
            throw new InternalServerErrorException(
                'Không upload được ảnh lên R2'
            );
        }

        return {
            url: `https://examio-r2.fayedark.com/${r2File}`,
        };
    }

    /**
     * Quick upload file - only uploads to R2 and creates UserStorage record
     * Does NOT perform OCR or vectorization. This is done on-demand when chat messages are sent.
     */
    async quickUploadFile(
        file: Express.Multer.File,
        user: User
    ): Promise<{ id: string; filename: string; url: string }> {
        // Validate PDF file
        this.validatePdfFile(file);

        // Validate page count
        const pdfDoc = await PDFDocument.load(file.buffer);
        const pageCount = pdfDoc.getPageCount();
        if (pageCount > 50) {
            throw new BadRequestException(
                `File PDF có ${pageCount} trang. Giới hạn tối đa là 50 trang.`
            );
        }

        // Check credit (2 credits per MB minimum)
        const cost = Math.max(2, Math.ceil(file.size / (1024 * 1024)));
        const wallet = await this.prisma.wallet.findUnique({
            where: { userId: user.id },
        });

        if (!wallet || wallet.balance < cost) {
            throw new BadRequestException('Không đủ tín dụng');
        }

        // Upload to R2
        const r2Key = this.generateIdService.generateId();
        const r2File = await this.r2Service.uploadFile(
            r2Key,
            file.buffer,
            file.mimetype
        );
        if (!r2File) {
            throw new InternalServerErrorException(
                'Không upload được file lên R2'
            );
        }

        // Fix Vietnamese filename encoding issue
        const originalFilename = Buffer.from(
            file.originalname,
            'latin1'
        ).toString('utf8');

        // Create UserStorage with processingStatus = PENDING
        const userStorage = await this.prisma.userStorage.create({
            data: {
                id: this.generateIdService.generateId(),
                userId: user.id,
                filename: originalFilename,
                mimetype: file.mimetype,
                size: file.size,
                keyR2: r2Key,
                url: `https://examio-r2.fayedark.com/${r2File}`,
                processingStatus: 'PENDING', // Mark as pending for on-demand processing
            },
        });

        console.log(
            `✅ Quick upload: ${userStorage.filename} (${userStorage.id}) - status: PENDING`
        );

        return {
            id: userStorage.id,
            filename: userStorage.filename,
            url: userStorage.url,
        };
    }

    /**
     * Process document on-demand - performs OCR and vectorization for documents with PENDING status
     * Called when user sends first message with an unprocessed document
     */
    async processDocumentOnDemand(userStorageId: string): Promise<boolean> {
        // Find the document
        const userStorage = await this.prisma.userStorage.findFirst({
            where: { id: userStorageId },
        });

        if (!userStorage) {
            console.error(
                `[processDocumentOnDemand] UserStorage not found: ${userStorageId}`
            );
            return false;
        }

        // Check if already processed or currently processing
        if (userStorage.processingStatus === 'COMPLETED') {
            console.log(
                `[processDocumentOnDemand] Document already processed: ${userStorageId}`
            );
            return true;
        }

        if (userStorage.processingStatus === 'PROCESSING') {
            console.log(
                `[processDocumentOnDemand] Document currently processing: ${userStorageId}`
            );
            // Wait for a bit and check again (simple polling)
            for (let i = 0; i < 30; i++) {
                // Max 60 seconds wait
                await this.delay(2000);
                const refreshed = await this.prisma.userStorage.findFirst({
                    where: { id: userStorageId },
                });
                if (refreshed?.processingStatus === 'COMPLETED') {
                    return true;
                }
                if (refreshed?.processingStatus === 'FAILED') {
                    return false;
                }
            }
            return false;
        }

        try {
            // Mark as processing
            await this.prisma.userStorage.update({
                where: { id: userStorageId },
                data: { processingStatus: 'PROCESSING' },
            });

            console.log(
                `🚀 [processDocumentOnDemand] Starting OCR/vectorization for: ${userStorage.filename}`
            );

            // Fetch file from R2 (returns a stream, need to convert to Buffer)
            const fileStream = await this.r2Service.getFile(userStorage.keyR2);
            if (!fileStream) {
                throw new Error('Could not fetch file from R2');
            }

            // Convert stream to Buffer
            const chunks: Buffer[] = [];
            for await (const chunk of fileStream as AsyncIterable<Buffer>) {
                chunks.push(Buffer.from(chunk));
            }
            const fileBuffer = Buffer.concat(chunks);

            // Create a mock file object for extractAndSavePdfChunks
            const mockFile = {
                buffer: fileBuffer,
                mimetype: userStorage.mimetype,
                originalname: userStorage.filename,
                size: userStorage.size,
            };

            // Perform OCR and vectorization
            await this.extractAndSavePdfChunks(mockFile, userStorageId);

            // Charge for OCR (uses creditCharged flag to prevent double charging)
            // AI Teacher only charges for OCR/embedding, not for chat
            await this.chargeForOcr(
                userStorage.userId,
                userStorage.size,
                userStorageId,
                userStorage.filename
            );

            // Mark as completed
            await this.prisma.userStorage.update({
                where: { id: userStorageId },
                data: { processingStatus: 'COMPLETED' },
            });

            console.log(
                `✅ [processDocumentOnDemand] Completed: ${userStorage.filename}`
            );
            return true;
        } catch (error) {
            console.error(
                `❌ [processDocumentOnDemand] Failed for ${userStorageId}:`,
                error
            );

            // Mark as failed
            await this.prisma.userStorage.update({
                where: { id: userStorageId },
                data: { processingStatus: 'FAILED' },
            });

            return false;
        }
    }

    /**
     * Check if documents need on-demand processing
     */
    async checkAndProcessDocuments(documentIds: string[]): Promise<void> {
        if (!documentIds.length) return;

        // Find documents that need processing
        const pendingDocs = await this.prisma.userStorage.findMany({
            where: {
                id: { in: documentIds },
                processingStatus: { in: ['PENDING', 'FAILED'] },
            },
        });

        if (pendingDocs.length === 0) {
            console.log(
                '[checkAndProcessDocuments] All documents already processed'
            );
            return;
        }

        console.log(
            `[checkAndProcessDocuments] Processing ${pendingDocs.length} pending documents`
        );

        // Process each document (sequentially to avoid overwhelming the system)
        for (const doc of pendingDocs) {
            await this.processDocumentOnDemand(doc.id);
        }
    }

    private async uploadAndCreateUserStorage(file: any, user: User) {
        const r2Key = this.generateIdService.generateId();
        const r2File = await this.r2Service.uploadFile(
            r2Key,
            file.buffer,
            file.mimetype
        );
        if (!r2File) {
            throw new InternalServerErrorException(
                'Không upload được file lên R2'
            );
        }

        // Fix Vietnamese filename encoding issue
        // Multer receives filenames in latin1 encoding, need to convert to utf8
        const originalFilename = Buffer.from(
            file.originalname,
            'latin1'
        ).toString('utf8');

        return await this.prisma.userStorage.create({
            data: {
                id: this.generateIdService.generateId(),
                userId: user.id,
                filename: originalFilename, // Now properly encoded
                mimetype: file.mimetype,
                size: file.size,
                keyR2: r2Key,
                url: `https://examio-r2.fayedark.com/${r2File}`,
            },
        });
    }

    private async extractAndSavePdfChunks(file: any, userStorageId: string) {
        try {
            console.log('📄 Starting PDF extraction process...');

            const chunkSize = 10;
            const pdfChunks = await this.splitPdfToChunks(
                file.buffer,
                chunkSize
            );

            let successCount = 0;
            let errorCount = 0;

            for (let i = 0; i < pdfChunks.length; i++) {
                try {
                    // OCR chunk
                    const ocrText = await this.pdfService.ocrPdf(pdfChunks[i]);

                    if (!ocrText || ocrText.trim().length === 0) {
                        console.warn(`⚠️ Empty OCR result for chunk ${i + 1}`);
                        errorCount++;
                        continue;
                    }

                    // Save to database
                    try {
                        await this.saveJsonToDb(userStorageId, {
                            pageRange: `${i + 1}`,
                            title: `Chunk ${i + 1}`,
                            content: ocrText,
                        });
                        successCount++;
                    } catch (saveError) {
                        console.error(
                            `❌ Failed to save chunk ${i + 1}, retrying once...`
                        );
                        // Retry once với delay
                        await this.delay(2000);
                        try {
                            await this.saveJsonToDb(userStorageId, {
                                pageRange: `${i + 1}`,
                                title: `Chunk ${i + 1}`,
                                content: ocrText,
                            });
                            successCount++;
                        } catch (retryError) {
                            console.error(
                                `❌ Final failure for chunk ${i + 1}:`,
                                retryError
                            );
                            errorCount++;
                        }
                    }
                } catch (chunkError) {
                    errorCount++;
                    continue;
                }
            }

            if (successCount === 0) {
                throw new InternalServerErrorException(
                    'Không thể xử lý chunk nào thành công'
                );
            }
        } catch (error) {
            console.error('❌ Error in extractAndSavePdfChunks:', error);
            throw new InternalServerErrorException(
                `Failed to extract PDF: ${error.message}`
            );
        }
    }

    private async saveJsonToDb(
        userStorageId: string,
        page: { pageRange: string; title: string; content: string }
    ) {
        try {
            const pageContent = page.content;

            if (!pageContent || !pageContent.trim()) {
                console.warn('⚠️ Content is empty, skipping...');
                return { success: false, reason: 'Empty content' };
            }

            // Create embedding với retry
            const embeddingResponse = await this.retryWithBackoff(() =>
                this.ensureClient().models.embedContent({
                    model: 'gemini-embedding-001',
                    contents: pageContent,
                })
            );

            const vector =
                embeddingResponse.embeddings &&
                Array.isArray(embeddingResponse.embeddings)
                    ? embeddingResponse.embeddings.map((e) => e.values).flat()
                    : [];

            if (vector.length === 0) {
                console.warn('⚠️ Empty embedding vector received');
                throw new Error('Empty embedding vector');
            }

            // Save to database
            await this.prisma.$executeRawUnsafe(
                `
            INSERT INTO "Document" ("id", "userStorageId", "pageRange", "title", "content", "embeddings")
            VALUES ($1, $2, $3, $4, $5, $6::vector)
            `,
                this.generateIdService.generateId(),
                userStorageId,
                page.pageRange,
                page.title,
                pageContent,
                `[${vector.join(',')}]`
            );

            return { success: true, length: vector.length };
        } catch (err) {
            console.error(`❌ Error saving chunk ${page.pageRange}:`, err);
            throw new InternalServerErrorException(
                `Failed to save document: ${err.message}`
            );
        }
    }
    /**
     * Tạo danh sách câu hỏi trắc nghiệm từ file PDF đã được chunk và lưu vào DB
     * - Truy vấn toàn bộ chunk theo userStorageId
     * - Sinh câu hỏi cho từng chunk
     * - Gom, shuffle, giới hạn số lượng
     * - Trả về danh sách câu hỏi
     */
    /**
     * Sinh câu hỏi trắc nghiệm từ các chunk theo logic groupChunks:
     * - Nếu số câu hỏi >= số chunk: phân bổ đều cho từng chunk
     * - Nếu số câu hỏi < số chunk: gộp chunk lại thành numQuestions nhóm, mỗi nhóm sinh 1 câu hỏi
     */
    async generateQuizChunkBased(
        userStorageId: string,
        numQuestions: number = 40,
        isNarrowSearch: boolean = false,
        keyword?: string
    ) {
        // 1. Lấy danh sách chunk (Document) theo search type
        let chunks: any[];
        if (isNarrowSearch === true && keyword) {
            // Vector search mode
            const keywordEmbedding = await this.createKeywordEmbedding(keyword);
            chunks = await this.findSimilarDocuments(
                userStorageId,
                keywordEmbedding,
                AIService.VECTOR_SEARCH_CONFIG.TOP_K,
                AIService.VECTOR_SEARCH_CONFIG.SIMILARITY_THRESHOLD
            );
            if (!chunks.length) {
                throw new NotFoundException(
                    `Không tìm thấy nội dung phù hợp với từ khóa: ${keyword}`
                );
            }
        } else {
            // Default: lấy tất cả chunk
            chunks = await this.prisma.document.findMany({
                where: { userStorageId },
                orderBy: { id: 'asc' },
                select: {
                    id: true,
                    userStorageId: true,
                    pageRange: true,
                    title: true,
                    content: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
        }

        if (!chunks.length) {
            throw new NotFoundException(
                'Không tìm thấy chunk nào cho userStorageId này'
            );
        }

        // groupChunks logic
        function groupChunks<T>(chunks: T[], numGroups: number): T[][] {
            if (numGroups <= 0) return [];
            if (numGroups >= chunks.length) {
                return chunks.map((c) => [c]);
            }
            const groups: T[][] = [];
            const size = Math.ceil(chunks.length / numGroups);
            for (let i = 0; i < chunks.length; i += size) {
                groups.push(chunks.slice(i, i + size));
            }
            while (groups.length > numGroups) {
                const last = groups.pop()!;
                groups[groups.length - 1] =
                    groups[groups.length - 1].concat(last);
            }
            return groups;
        }

        // Sửa type cho groups: Document[][]
        type DocumentType = (typeof chunks)[0];
        let groups: DocumentType[][];
        let questionsPerGroup: number[];
        // Adaptive quantity logic for vector search
        let adaptiveNumQuestions = numQuestions;
        if (adaptiveNumQuestions >= chunks.length) {
            groups = chunks.map((c) => [c]);
            const base = Math.floor(adaptiveNumQuestions / chunks.length);
            const extra = adaptiveNumQuestions % chunks.length;
            questionsPerGroup = groups.map(
                (_, i) => base + (i < extra ? 1 : 0)
            );
        } else {
            groups = groupChunks(chunks, adaptiveNumQuestions);
            questionsPerGroup = Array(groups.length).fill(1);
        }

        // Sinh câu hỏi cho từng group
        const allQuestions: any[] = [];
        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            const numForThisGroup = questionsPerGroup[i];
            if (numForThisGroup <= 0) continue;
            // Gộp content các chunk trong group
            const mergedContent = group.map((c) => c.content).join('\n\n');
            const mergedPageRange = group.map((c) => c.pageRange).join(',');
            let text = '[]';
            try {
                const result = await this.retryWithBackoff(() =>
                    this.ensureClient().models.generateContent({
                        model: this.getNextModel(),
                        contents: [
                            {
                                role: 'user',
                                parts: [
                                    {
                                        text: new PromptUtils().generateQuizzPrompt(
                                            {
                                                pageRange: mergedPageRange,
                                                numForThisChunk:
                                                    numForThisGroup,
                                                content: {
                                                    content: mergedContent,
                                                },
                                            }
                                        ),
                                    },
                                ],
                            },
                        ],
                        config: {
                            responseMimeType: 'application/json',
                            responseSchema: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        question: { type: 'string' },
                                        options: {
                                            type: 'array',
                                            items: { type: 'string' },
                                            minItems: 4,
                                            maxItems: 4,
                                        },
                                        answer: { type: 'string' },
                                        sourcePageRange: { type: 'string' },
                                    },
                                    required: [
                                        'question',
                                        'options',
                                        'answer',
                                        'sourcePageRange',
                                    ],
                                },
                            },
                            candidateCount: 1,
                            maxOutputTokens: parseInt(
                                process.env.GEMINI_MAX_TOKENS || '2000000'
                            ),
                            temperature: 0.3,
                        },
                    })
                );
                text = result.text || '[]';
            } catch (err) {
                console.error('Lỗi gọi model group:', err);
            }
            let parsed: any[] = [];
            try {
                parsed = JSON.parse(text);
            } catch (err) {
                console.error('Lỗi parse JSON câu hỏi group:', err, text);
            }
            allQuestions.push(...parsed);
        }

        // Shuffle ngẫu nhiên
        allQuestions.sort(() => Math.random() - 0.5);
        // Lấy tối đa adaptiveNumQuestions câu
        const finalQuestions = allQuestions.slice(0, adaptiveNumQuestions);
        console.log('Đã sinh tổng cộng câu hỏi:', finalQuestions.length);
        return finalQuestions;
    }

    /**
     * Sinh flashcards từ các chunk theo logic groupChunks:
     * - Nếu số flashcards >= số chunk: phân bổ đều cho từng chunk
     * - Nếu số flashcards < số chunk: gộp chunk lại thành numFlashcards nhóm, mỗi nhóm sinh flashcard tương ứng
     */
    async generateFlashcardsChunkBased(
        userStorageId: string,
        numFlashcards: number = 40,
        isNarrowSearch: boolean = false,
        keyword?: string
    ) {
        // 1. Lấy danh sách chunk (Document) theo search type
        let chunks: any[];
        if (isNarrowSearch === true && keyword) {
            // Vector search mode
            const keywordEmbedding = await this.createKeywordEmbedding(keyword);
            chunks = await this.findSimilarDocuments(
                userStorageId,
                keywordEmbedding,
                AIService.VECTOR_SEARCH_CONFIG.TOP_K,
                AIService.VECTOR_SEARCH_CONFIG.SIMILARITY_THRESHOLD
            );
            if (!chunks.length) {
                throw new NotFoundException(
                    `Không tìm thấy nội dung phù hợp với từ khóa: ${keyword}`
                );
            }
        } else {
            // Default: lấy tất cả chunk
            chunks = await this.prisma.document.findMany({
                where: { userStorageId },
                orderBy: { id: 'asc' },
                select: {
                    id: true,
                    userStorageId: true,
                    pageRange: true,
                    title: true,
                    content: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
        }

        if (!chunks.length) {
            throw new NotFoundException(
                'Không tìm thấy chunk nào cho userStorageId này'
            );
        }

        // groupChunks logic (tái sử dụng từ generateQuizChunkBased)
        function groupChunks<T>(chunks: T[], numGroups: number): T[][] {
            if (numGroups <= 0) return [];
            if (numGroups >= chunks.length) {
                return chunks.map((c) => [c]);
            }
            const groups: T[][] = [];
            const size = Math.ceil(chunks.length / numGroups);
            for (let i = 0; i < chunks.length; i += size) {
                groups.push(chunks.slice(i, i + size));
            }
            while (groups.length > numGroups) {
                const last = groups.pop()!;
                groups[groups.length - 1] =
                    groups[groups.length - 1].concat(last);
            }
            return groups;
        }

        // Sử dụng type cho groups: Document[][]
        type DocumentType = (typeof chunks)[0];
        let groups: DocumentType[][];
        let flashcardsPerGroup: number[];

        // Adaptive quantity logic for vector search
        let adaptiveNumFlashcards = numFlashcards;

        if (adaptiveNumFlashcards >= chunks.length) {
            groups = chunks.map((c) => [c]);
            const base = Math.floor(adaptiveNumFlashcards / chunks.length);
            const extra = adaptiveNumFlashcards % chunks.length;
            flashcardsPerGroup = groups.map(
                (_, i) => base + (i < extra ? 1 : 0)
            );
        } else {
            groups = groupChunks(chunks, adaptiveNumFlashcards);
            flashcardsPerGroup = Array(groups.length).fill(1);
        }

        // Sinh flashcards cho từng group
        const allFlashcards: any[] = [];
        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            const numForThisGroup = flashcardsPerGroup[i];
            if (numForThisGroup <= 0) continue;

            // Gộp content các chunk trong group
            const mergedContent = group.map((c) => c.content).join('\n\n');
            const mergedPageRange = group.map((c) => c.pageRange).join(',');

            let text = '[]';
            try {
                const result = await this.retryWithBackoff(() =>
                    this.ensureClient().models.generateContent({
                        model: this.getNextModel(),
                        contents: [
                            {
                                role: 'user',
                                parts: [
                                    {
                                        text: new PromptUtils().generateFlashcardPrompt(
                                            {
                                                pageRange: mergedPageRange,
                                                numForThisChunk:
                                                    numForThisGroup,
                                                content: {
                                                    content: mergedContent,
                                                },
                                            }
                                        ),
                                    },
                                ],
                            },
                        ],
                        config: {
                            responseMimeType: 'application/json',
                            responseSchema: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    properties: {
                                        question: { type: 'string' },
                                        answer: { type: 'string' },
                                        sourcePageRange: { type: 'string' },
                                    },
                                    required: [
                                        'question',
                                        'answer',
                                        'sourcePageRange',
                                    ],
                                },
                            },
                            candidateCount: 1,
                            maxOutputTokens: parseInt(
                                process.env.GEMINI_MAX_TOKENS || '2000000'
                            ),
                            temperature: 0.3,
                        },
                    })
                );
                text = result.text || '[]';
            } catch (err) {
                console.error(`❌ Lỗi gọi model group ${i + 1}:`, err);
                // Continue with other groups even if one fails
                continue;
            }

            let parsed: any[] = [];
            try {
                parsed = JSON.parse(text);
                if (!Array.isArray(parsed)) {
                    console.warn(
                        `⚠️ Response không phải array cho group ${i + 1}`
                    );
                    parsed = [];
                }
            } catch (err) {
                console.error(
                    `❌ Lỗi parse JSON flashcards group ${i + 1}:`,
                    err
                );
                console.error('Raw response:', text);
                parsed = [];
            }

            allFlashcards.push(...parsed);
        }

        // Shuffle ngẫu nhiên để tránh bias theo thứ tự chunk
        allFlashcards.sort(() => Math.random() - 0.5);

        // Lấy tối đa adaptiveNumFlashcards flashcards
        const finalFlashcards = allFlashcards.slice(0, adaptiveNumFlashcards);

        console.log(
            `🎯 Đã tạo ${finalFlashcards.length}/${adaptiveNumFlashcards} flashcards từ ${chunks.length} chunks`
        );

        return finalFlashcards;
    }

    /**
     * Lấy danh sách các file đã upload gần đây
     * @param includeHistory - Nếu false, không trả về quiz/flashcard history
     */
    async getRecentUploads(
        userId: string,
        limit: number = 10,
        includeHistory: boolean = true
    ) {
        const uploads = await this.prisma.userStorage.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: includeHistory
                ? {
                      historyGeneratedQuizz: {
                          orderBy: { createdAt: 'desc' },
                          take: 1,
                      },
                      historyGeneratedFlashcard: {
                          orderBy: { createdAt: 'desc' },
                          take: 1,
                      },
                  }
                : undefined,
        });

        return uploads.map((upload: any) => ({
            id: upload.id,
            filename: upload.filename,
            url: upload.url,
            size: upload.size,
            mimetype: upload.mimetype,
            createdAt: upload.createdAt,
            ...(includeHistory && {
                quizHistory: upload.historyGeneratedQuizz?.[0] || null,
                flashcardHistory: upload.historyGeneratedFlashcard?.[0] || null,
            }),
        }));
    }

    /**
     * Lấy chi tiết một upload với generated content
     */
    async getUploadDetail(uploadId: string, userId: string) {
        const upload = await this.prisma.userStorage.findFirst({
            where: { id: uploadId, userId },
            include: {
                historyGeneratedQuizz: {
                    orderBy: { createdAt: 'desc' },
                },
                historyGeneratedFlashcard: {
                    orderBy: { createdAt: 'desc' },
                },
            },
        });

        if (!upload) {
            throw new NotFoundException('Không tìm thấy file');
        }

        return {
            id: upload.id,
            filename: upload.filename,
            url: upload.url,
            size: upload.size,
            mimetype: upload.mimetype,
            createdAt: upload.createdAt,
            quizHistories: upload.historyGeneratedQuizz,
            flashcardHistories: upload.historyGeneratedFlashcard,
        };
    }

    /**
     * Xóa upload và tất cả data liên quan (R2, documents, history)
     */
    async deleteUpload(uploadId: string, userId: string) {
        const upload = await this.prisma.userStorage.findFirst({
            where: { id: uploadId, userId },
        });

        if (!upload) {
            throw new NotFoundException('Không tìm thấy file');
        }

        // 1. Xóa file từ R2
        try {
            await this.r2Service.deleteFile(upload.keyR2);
            console.log(`✅ Deleted file from R2: ${upload.keyR2}`);
        } catch (error) {
            console.error(`❌ Failed to delete from R2: ${error}`);
            // Continue với xóa DB dù R2 fail
        }

        // 2. Xóa từ database (cascade sẽ xóa documents và history)
        await this.prisma.userStorage.delete({
            where: { id: uploadId },
        });

        console.log(`✅ Deleted upload: ${uploadId}`);

        return { success: true, message: 'Đã xóa file thành công' };
    }

    /**
     * Create job for regenerate from existing upload (uses job queue)
     */
    async regenerateFromUpload(
        uploadId: string,
        user: User,
        typeResult: number,
        quantityFlashcard?: number,
        quantityQuizz?: number,
        isNarrowSearch?: boolean,
        keyword?: string
    ) {
        const numFlashcards = quantityFlashcard || 10;
        const numQuizzes = quantityQuizz || 10;

        // Regenerate only charges for questions (OCR was already done)
        const requestedQuantity =
            typeResult === TYPE_RESULT.FLASHCARD ? numFlashcards : numQuizzes;
        const questionCost = this.calculateQuestionCost(requestedQuantity);

        // Check balance for question generation only
        await this.checkUserBalance(user.id, questionCost);

        const upload = await this.prisma.userStorage.findFirst({
            where: { id: uploadId, userId: user.id },
        });

        if (!upload) {
            throw new NotFoundException('Không tìm thấy file');
        }

        // Kiểm tra có documents không
        const documentCount = await this.prisma.document.count({
            where: { userStorageId: uploadId },
        });

        if (documentCount === 0) {
            throw new BadRequestException(
                'Không tìm thấy nội dung file. Vui lòng upload lại.'
            );
        }

        // Create job for regenerate
        const jobId = this.generateIdService.generateId();
        const job: Job = {
            id: jobId,
            status: JobStatus.PENDING,
            type:
                typeResult === TYPE_RESULT.QUIZZ
                    ? JobType.QUIZ
                    : JobType.FLASHCARD,
            userId: user.id,
            file: null as any, // No file needed for regenerate
            params: {
                typeResult,
                quantityFlashcard,
                quantityQuizz,
                isNarrowSearch,
                keyword,
                uploadId, // Pass uploadId for regenerate
            },
            progress: 0,
            createdAt: new Date(),
        };
        this.jobQueue.set(jobId, job);
        console.log(`✅ Created regenerate job ${jobId} for user ${user.id}`);

        // Start processing async
        this.processRegenerateJobAsync(jobId, uploadId).catch((error) => {
            console.error(
                `❌ Error processing regenerate job ${jobId}:`,
                error
            );
        });

        return { jobId };
    }

    /**
     * Process regenerate job asynchronously
     */
    private async processRegenerateJobAsync(
        jobId: string,
        uploadId: string
    ): Promise<void> {
        const job = this.jobQueue.get(jobId);
        if (!job) {
            console.error(`Job ${jobId} not found`);
            return;
        }

        try {
            // Update status to processing
            job.status = JobStatus.PROCESSING;
            job.startedAt = new Date();
            job.progress = 20;
            this.jobQueue.set(jobId, job);

            console.log(`🚀 Processing regenerate job ${jobId}...`);

            const upload = await this.prisma.userStorage.findFirst({
                where: { id: uploadId, userId: job.userId },
            });

            if (!upload) {
                throw new NotFoundException('Không tìm thấy file');
            }

            job.progress = 40;
            this.jobQueue.set(jobId, job);

            let actualCount = 0;
            const isFlashcard =
                Number(job.params.typeResult) === TYPE_RESULT.FLASHCARD;

            // Generate based on type
            if (isFlashcard) {
                const flashcards = await this.generateFlashcardsChunkBased(
                    uploadId,
                    job.params.quantityFlashcard || 10,
                    job.params.isNarrowSearch || false,
                    job.params.keyword
                );
                actualCount = flashcards.length;
                job.progress = 80;
                this.jobQueue.set(jobId, job);

                const savedFlashcards = await this.saveFlashcardsToHistory(
                    flashcards,
                    job.userId,
                    uploadId
                );
                job.progress = 90;
                this.jobQueue.set(jobId, job);

                job.result = {
                    type: JobType.FLASHCARD,
                    flashcards: savedFlashcards.flashcards as any[],
                    historyId: savedFlashcards.id,
                    fileInfo: {
                        id: upload.id,
                        filename: upload.filename,
                    },
                };
            } else {
                const quizzes = await this.generateQuizChunkBased(
                    uploadId,
                    job.params.quantityQuizz || 10,
                    job.params.isNarrowSearch || false,
                    job.params.keyword
                );
                actualCount = quizzes.length;
                job.progress = 80;
                this.jobQueue.set(jobId, job);

                const savedQuizzes = await this.saveQuizzesToHistory(
                    quizzes,
                    job.userId,
                    uploadId
                );
                job.progress = 90;
                this.jobQueue.set(jobId, job);

                job.result = {
                    type: JobType.QUIZ,
                    quizzes: savedQuizzes.quizzes as any[],
                    historyId: savedQuizzes.id,
                    fileInfo: {
                        id: upload.id,
                        filename: upload.filename,
                    },
                };
            }

            // Charge for questions/flashcards based on ACTUAL count
            await this.chargeForQuestions(
                job.userId,
                actualCount,
                isFlashcard,
                uploadId,
                upload.filename
            );

            // Mark as completed
            job.status = JobStatus.COMPLETED;
            job.progress = 100;
            job.completedAt = new Date();
            this.jobQueue.set(jobId, job);

            console.log(`✅ Regenerate job ${jobId} completed successfully`);
        } catch (error) {
            console.error(`❌ Regenerate job ${jobId} failed:`, error);
            job.status = JobStatus.FAILED;
            job.error =
                error instanceof Error ? error.message : 'Unknown error';
            job.completedAt = new Date();
            this.jobQueue.set(jobId, job);
        }
    }
}
