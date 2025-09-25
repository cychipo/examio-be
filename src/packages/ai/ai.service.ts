import {
    Injectable,
    ConflictException,
    NotFoundException,
    InternalServerErrorException,
    BadRequestException,
} from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { PrismaService } from 'src/prisma/prisma.service';
import { PDFDocument } from 'pdf-lib';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { PROMPT_CONSTANT } from 'src/constants/prompt';
import { R2Service } from '../r2/r2.service';
import { User } from '@prisma/client';

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
    private promptExtractPdf: string;
    constructor() {
        this.prisma = new PrismaService();
        this.generateIdService = new GenerateIdService();
        this.r2Service = new R2Service();
        this.apiKeys =
            process.env.GEMINI_API_KEYS?.split(',').map((key) => key.trim()) ||
            [];
        this.promptExtractPdf = PROMPT_CONSTANT.EXTRACT_TEXT_FROM_PDF;
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
        initialDelay: number = 2000
    ): Promise<T> {
        let lastError: any;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await fn();
            } catch (error: any) {
                lastError = error;

                if (error.status === 429) {
                    console.log(
                        `⚠️ Rate limit hit ở attempt ${attempt}/${maxRetries}`
                    );

                    const currentClient = this.ai;
                    if (currentClient) {
                        const currentKey =
                            this.apiKeys[Math.max(0, this.currentKeyIndex - 1)];
                        this.markKeyAsFailed(currentKey);
                    }

                    try {
                        this.ai = this.createClient();
                        console.log(`🔄 Đã chuyển sang API key mới`);
                    } catch (keyError) {
                        throw new InternalServerErrorException(
                            'Tất cả API keys đều đã hết quota. Vui lòng thử lại sau ít phút.'
                        );
                    }

                    const delayTime = initialDelay * Math.pow(1.5, attempt - 1);
                    console.log(`⏱️ Retry sau ${delayTime}ms với key mới`);

                    if (attempt < maxRetries) {
                        await this.delay(delayTime);
                        continue;
                    }
                } else {
                    throw error;
                }
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

    private async uploadFile(fileBuffer: Blob) {
        const response = await this.ensureClient().files.upload({
            file: fileBuffer,
        });
        return response;
    }

    private async deleteFile(fileName: string) {
        await this.ensureClient().files.delete({
            name: fileName,
        });
    }

    private async splitPdfToChunks(
        buffer: Buffer,
        chunkSize: number
    ): Promise<Buffer[]> {
        const pdfDoc = await PDFDocument.load(buffer);
        const totalPages = pdfDoc.getPageCount();
        const chunks: Buffer[] = [];

        for (let i = 0; i < totalPages; i += chunkSize) {
            const newPdf = await PDFDocument.create();
            const end = Math.min(i + chunkSize, totalPages);
            const pages = await newPdf.copyPages(
                pdfDoc,
                Array.from({ length: end - i }, (_, idx) => i + idx)
            );
            pages.forEach((page) => newPdf.addPage(page));
            const pdfBytes = await newPdf.save();
            chunks.push(Buffer.from(pdfBytes));
        }
        return chunks;
    }

    async embedTextFromFile(file: any, user: User) {
        const supportedMimeTypes = ['application/pdf'];
        if (!supportedMimeTypes.includes(file.mimetype)) {
            throw new BadRequestException('Chỉ hỗ trợ tệp PDF');
        }
        if (file.size > 10 * 1024 * 1024) {
            throw new BadRequestException('Giới hạn kích thước tệp là 10MB');
        }

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

        console.log('Type R2File', typeof r2File);
        console.log('✅ Upload file lên R2 thành công:', r2File);

        const userStorage = await this.prisma.userStorage.create({
            data: {
                id: this.generateIdService.generateId(),
                userId: user.id,
                filename: file.originalname,
                mimetype: file.mimetype,
                size: file.size,
                keyR2: r2Key,
                url: r2File,
            },
        });

        const chunkSize = 5;
        const pdfChunks = await this.splitPdfToChunks(file.buffer, chunkSize);
        console.log(
            `📄 Chia PDF thành ${pdfChunks.length} chunks (${chunkSize} trang/chunk)`
        );

        const results: string[] = [];

        for (let i = 0; i < pdfChunks.length; i++) {
            const chunkBuffer = pdfChunks[i];
            console.log(`🔄 Đang xử lý chunk ${i + 1}/${pdfChunks.length}...`);

            let uploadedFile: any = null;

            try {
                const uint8Array = new Uint8Array(chunkBuffer);
                uploadedFile = await this.uploadFile(
                    new Blob([uint8Array], { type: file.mimetype })
                );

                const result = await this.retryWithBackoff(async () => {
                    const stream =
                        await this.ensureClient().models.generateContentStream({
                            model: this.modalName,
                            contents: {
                                role: 'user',
                                parts: [
                                    {
                                        text: this.promptExtractPdf,
                                    },
                                    {
                                        fileData: {
                                            mimeType: file.mimetype,
                                            fileUri: uploadedFile.uri,
                                        },
                                    },
                                ],
                            },
                            config: {
                                responseMimeType: 'application/json',
                                responseSchema: {
                                    type: 'object',
                                    properties: {
                                        data: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    pageNumber: {
                                                        type: 'number',
                                                    },
                                                    title: { type: 'string' },
                                                    content: { type: 'string' },
                                                },
                                                required: [
                                                    'pageNumber',
                                                    'title',
                                                    'content',
                                                ],
                                            },
                                        },
                                    },
                                    required: ['data'],
                                },
                                candidateCount: 1,
                                maxOutputTokens: parseInt(
                                    process.env.GEMINI_MAX_TOKENS || '2000000'
                                ),
                                temperature: 0.2,
                            },
                        });

                    let fullText = '';
                    for await (const chunk of stream) {
                        const chunkText = chunk.text;
                        if (chunkText) {
                            fullText += chunkText;
                        }
                    }

                    return fullText || '';
                });

                results.push(result);
                console.log(`✅ Hoàn thành chunk ${i + 1}/${pdfChunks.length}`);

                if (i < pdfChunks.length - 1) {
                    console.log('⏱️ Delay 1s trước chunk tiếp theo...');
                    await this.delay(1000);
                }
            } catch (error: any) {
                console.error(`❌ Lỗi xử lý chunk ${i + 1}:`, error.message);

                if (error.status === 429) {
                    const availableKeys = this.apiKeys.filter(
                        (key) => !this.failedKeys.has(key)
                    );
                    if (availableKeys.length === 0) {
                        throw new InternalServerErrorException(
                            `Tất cả ${this.apiKeys.length} API keys đều đã hết quota. Vui lòng thử lại sau ít phút hoặc thêm API keys mới.`
                        );
                    } else {
                        throw new InternalServerErrorException(
                            `API key hiện tại đã hết quota. Còn ${availableKeys.length}/${this.apiKeys.length} keys khả dụng. Vui lòng thử lại.`
                        );
                    }
                } else {
                    throw new InternalServerErrorException(
                        `Lỗi khi xử lý chunk ${i + 1}: ${error.message}`
                    );
                }
            } finally {
                if (uploadedFile?.name) {
                    try {
                        await this.deleteFile(uploadedFile.name);
                    } catch (cleanupError) {
                        console.warn('⚠️ Lỗi khi cleanup file:', cleanupError);
                    }
                }
            }
        }

        const parsedResults = results.map((result, idx) => {
            try {
                return JSON.parse(result);
            } catch (err) {
                console.error(
                    `❌ Lỗi parse JSON chunk ${idx + 1}:`,
                    err,
                    result
                );
                throw new InternalServerErrorException(
                    `Lỗi khi parse JSON chunk ${idx + 1}`
                );
            }
        });

        const allPages = parsedResults.flatMap((chunk) => chunk.data ?? []);
        await this.saveJsonToDb(userStorage.id, allPages[0]);
        return JSON.stringify({ data: allPages }, null, 2);
    }

    private async saveJsonToDb(
        userStorageId: string,
        page: { pageNumber: number; title: string; content: string }
    ) {
        try {
            const pageContent = page.content;

            if (!pageContent.trim()) {
                throw new Error('Content is empty, skip embedding');
            }

            const embeddingResponse = await this.ai.models.embedContent({
                model: 'gemini-embedding-001',
                contents: pageContent,
            });

            const vector =
                embeddingResponse.embeddings &&
                Array.isArray(embeddingResponse.embeddings)
                    ? embeddingResponse.embeddings.map((e) => e.values).flat()
                    : [];

            await this.prisma.$executeRawUnsafe(
                `
            INSERT INTO "Document" ("id", "userStorageId", "pageNumber", "title", "content", "embeddings")
            VALUES ($1, $2, $3, $4, $5, $6::vector)
            `,
                this.generateIdService.generateId(),
                userStorageId,
                page.pageNumber,
                page.title,
                pageContent,
                `[${vector.join(',')}]`
            );

            return { success: true, length: vector.length };
        } catch (err) {
            console.error('Error saving JSON to DB:', err);
            throw new InternalServerErrorException('Không lưu được document');
        }
    }
}
