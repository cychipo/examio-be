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

@Injectable()
export class AIService {
    private apiKeys: string[];
    private currentKeyIndex: number = 0;
    private r2Service: R2Service;
    private readonly modalName =
        process.env.GEMINI_MODAL_NAME || 'gemini-2.0-flash';
    private ai: GoogleGenAI;
    private prisma: PrismaService;
    private failedKeys: Set<string> = new Set();
    private keyResetTime: number = Date.now() + 60000;
    private generateIdService: GenerateIdService = new GenerateIdService();
    private readonly pdfService: PdfService;

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
        userStorageId: string,
        keywordEmbedding: number[],
        topK?: number,
        similarityThreshold?: number
    ): Promise<any[]> {
        if (!Array.isArray(keywordEmbedding) || !keywordEmbedding.length) {
            throw new BadRequestException('Embedding vector không hợp lệ');
        }
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
            // Use $1: embedding, $2: userStorageId, $3: threshold, $4: topK
            const result = await this.prisma.$queryRawUnsafe(
                `SELECT id, "userStorageId", "pageRange", title, content, "createdAt", "updatedAt",
                    1 - (embeddings <=> $1::vector) as similarity_score
                 FROM "Document"
                 WHERE "userStorageId" = $2
                   AND 1 - (embeddings <=> $1::vector) > $3
                 ORDER BY embeddings <=> $1::vector ASC
                 LIMIT $4;`,
                `[${keywordEmbedding.join(',')}]`,
                userStorageId,
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

    constructor() {
        this.prisma = new PrismaService();
        this.generateIdService = new GenerateIdService();
        this.r2Service = new R2Service();
        this.apiKeys =
            process.env.GEMINI_API_KEYS?.split(',').map((key) => key.trim()) ||
            [];
        this.pdfService = new PdfService();
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
        const response = await this.ensureClient().models.generateContent({
            model: this.modalName,
            contents: prompt,
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

    private async decrementUserCredit(userId: string, fileSize: number) {
        const cost = Math.max(1, Math.ceil(fileSize / (1024 * 1024))); // 1 credit per MB
        await this.prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.update({
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
        // Validate keyword for narrow search
        if (isNarrowSearch === true) {
            if (!keyword || keyword.trim().length === 0) {
                throw new BadRequestException(
                    'Khi isNarrowSearch là true, keyword không được để trống'
                );
            }
            // Validate multiple keywords (max, format)
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

            await this.extractAndSavePdfChunks(file, userStorage.id);

            if (Number(typeResult) === TYPE_RESULT.QUIZZ) {
                const quiz = await this.generateQuizChunkBased(
                    userStorage.id,
                    quantityQuizz || 40,
                    isNarrowSearch,
                    keyword
                );

                // Lưu vào bảng HistoryGeneratedQuizz
                const savedQuizzes = await this.saveQuizzesToHistory(
                    quiz,
                    user.id,
                    userStorage.id
                );

                await this.decrementUserCredit(user.id, file.size);
                return savedQuizzes;
            } else if (Number(typeResult) === TYPE_RESULT.FLASHCARD) {
                const flashcards = await this.generateFlashcardsChunkBased(
                    userStorage.id,
                    quantityFlashcard || 40,
                    isNarrowSearch,
                    keyword
                );

                // Lưu vào bảng HistoryGeneratedFlashcard
                const savedFlashcards = await this.saveFlashcardsToHistory(
                    flashcards,
                    user.id,
                    userStorage.id
                );

                await this.decrementUserCredit(user.id, file.size);
                return savedFlashcards;
            } else {
                throw new BadRequestException(
                    `Invalid typeResult: ${typeResult}`
                );
            }
        } catch (error) {
            console.error('❌ Error in handleActionsWithFile:', error);
            throw error;
        }
    }

    /**
     * Lưu danh sách quiz vào bảng HistoryGeneratedQuizz (1 record cho cả batch)
     */
    private async saveQuizzesToHistory(
        quizzes: any[],
        userId: string,
        userStorageId: string
    ) {
        const savedHistory = await this.prisma.historyGeneratedQuizz.create({
            data: {
                id: this.generateIdService.generateId(),
                userId: userId,
                userStorageId: userStorageId,
                quizzes: quizzes, // Lưu toàn bộ mảng vào JSON field
            },
        });

        console.log(`✅ Đã lưu ${quizzes.length} câu hỏi vào 1 history record`);
        return savedHistory;
    }

    /**
     * Lưu danh sách flashcards vào bảng HistoryGeneratedFlashcard (1 record cho cả batch)
     */
    private async saveFlashcardsToHistory(
        flashcards: any[],
        userId: string,
        userStorageId: string
    ) {
        const savedHistory = await this.prisma.historyGeneratedFlashcard.create(
            {
                data: {
                    id: this.generateIdService.generateId(),
                    userId: userId,
                    userStorageId: userStorageId,
                    flashcards: flashcards, // Lưu toàn bộ mảng vào JSON field
                },
            }
        );

        console.log(
            `✅ Đã lưu ${flashcards.length} flashcards vào 1 history record`
        );
        return savedHistory;
    }

    private validatePdfFile(file: any) {
        if (!file) {
            throw new BadRequestException('No file provided');
        }

        const supportedMimeTypes = ['application/pdf'];
        if (!file.mimetype || !supportedMimeTypes.includes(file.mimetype)) {
            throw new BadRequestException('Chỉ hỗ trợ tệp PDF');
        }

        if (!file.buffer || file.buffer.length === 0) {
            throw new BadRequestException('File buffer không hợp lệ');
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

        // Keep original filename for display, but normalize for storage key
        const originalFilename = file.originalname;

        return await this.prisma.userStorage.create({
            data: {
                id: this.generateIdService.generateId(),
                userId: user.id,
                filename: originalFilename, // Keep original for display
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
                        model: this.modalName,
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
                        model: this.modalName,
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
     * Lấy danh sách các file đã upload gần đây kèm theo lịch sử generate quiz/flashcard
     */
    async getRecentUploads(userId: string, limit: number = 10) {
        const uploads = await this.prisma.userStorage.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: limit,
            include: {
                historyGeneratedQuizz: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                },
                historyGeneratedFlashcard: {
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                },
            },
        });

        return uploads.map((upload) => ({
            id: upload.id,
            filename: upload.filename,
            url: upload.url,
            size: upload.size,
            mimetype: upload.mimetype,
            createdAt: upload.createdAt,
            quizHistory: upload.historyGeneratedQuizz[0] || null,
            flashcardHistory: upload.historyGeneratedFlashcard[0] || null,
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
     * Regenerate quiz/flashcard từ file đã upload (không cần upload lại)
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

        // Generate dựa trên type - sử dụng methods có sẵn
        if (typeResult === TYPE_RESULT.FLASHCARD) {
            const numFlashcards = quantityFlashcard || 10;
            const flashcards = await this.generateFlashcardsChunkBased(
                uploadId,
                numFlashcards,
                isNarrowSearch || false,
                keyword
            );

            // Lưu history
            await this.saveFlashcardsToHistory(flashcards, user.id, uploadId);

            // Trừ credit
            await this.decrementUserCredit(user.id, numFlashcards);

            return {
                type: 'flashcard',
                data: flashcards,
                fileInfo: {
                    id: upload.id,
                    filename: upload.filename,
                },
            };
        } else {
            const numQuizzes = quantityQuizz || 10;
            const quizzes = await this.generateQuizChunkBased(
                uploadId,
                numQuizzes,
                isNarrowSearch || false,
                keyword
            );

            // Lưu history
            await this.saveQuizzesToHistory(quizzes, user.id, uploadId);

            // Trừ credit
            await this.decrementUserCredit(user.id, numQuizzes);

            return {
                type: 'quiz',
                data: quizzes,
                fileInfo: {
                    id: upload.id,
                    filename: upload.filename,
                },
            };
        }
    }
}
