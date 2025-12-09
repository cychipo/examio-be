import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import * as Tesseract from 'tesseract.js';
import * as pdf2pic from 'pdf2pic';
import { promises as fs } from 'fs';
import { ImagePreprocessingService } from './image-preprocessing.service';

interface OcrOptions {
    /** Use image preprocessing (default: true for enhanced, false for basic) */
    usePreprocessing?: boolean;
    /** Language for OCR (default: 'eng+vie') */
    language?: string;
    /** DPI for PDF rendering (default: 300) */
    density?: number;
}

@Injectable()
export class PdfService {
    private readonly logger = new Logger(PdfService.name);

    constructor(
        private readonly imagePreprocessingService: ImagePreprocessingService
    ) {}

    /**
     * Enhanced OCR with full preprocessing pipeline
     * Recommended for Vietnamese text and scanned documents
     */
    async ocrPdfEnhanced(fileBuffer: Buffer): Promise<string> {
        const tempFiles: string[] = [];

        try {
            this.logger.log('Starting enhanced PDF OCR with preprocessing...');

            // High DPI conversion (300 for optimal OCR quality)
            const convert = pdf2pic.fromBuffer(fileBuffer, {
                density: 300,
                saveFilename: `enhanced_ocr_${Date.now()}_page`,
                savePath: '/tmp/',
                format: 'png',
                width: 2480, // A4 at 300 DPI
                height: 3508,
            });

            const results = await convert.bulk(-1);

            if (!results || results.length === 0) {
                throw new Error('No pages could be converted from PDF');
            }

            this.logger.log(`Converted ${results.length} pages from PDF`);

            const ocrPromises = results
                .filter((result) => result?.path)
                .map(async (result, index) => {
                    try {
                        tempFiles.push(result.path!);

                        // Read original image
                        const imageBuffer = await fs.readFile(result.path!);

                        // Apply preprocessing pipeline
                        this.logger.debug(`Preprocessing page ${index + 1}...`);
                        const processedBuffer =
                            await this.imagePreprocessingService.preprocessImage(
                                imageBuffer
                            );

                        // Save processed image temporarily for Tesseract
                        const processedPath = result.path!.replace(
                            '.png',
                            '_processed.png'
                        );
                        await fs.writeFile(processedPath, processedBuffer);
                        tempFiles.push(processedPath);

                        // OCR with Tesseract
                        this.logger.debug(`Running OCR on page ${index + 1}...`);
                        const {
                            data: { text },
                        } = await Tesseract.recognize(processedPath, 'eng+vie', {
                            logger: (progress) => {
                                if (progress.status === 'recognizing text') {
                                    this.logger.debug(
                                        `Page ${index + 1}: ${Math.round(progress.progress * 100)}%`
                                    );
                                }
                            },
                        });

                        return { pageIndex: index, text };
                    } catch (error) {
                        this.logger.error(
                            `Error processing page ${index + 1}:`,
                            error
                        );
                        return { pageIndex: index, text: '' };
                    }
                });

            const ocrResults = await Promise.all(ocrPromises);
            ocrResults.sort((a, b) => a.pageIndex - b.pageIndex);

            const fullText = ocrResults
                .map((result) => result.text)
                .join('\n')
                .trim();

            this.logger.log(
                `Enhanced OCR completed: ${fullText.length} characters extracted`
            );

            return fullText;
        } catch (error) {
            this.logger.error('Error in ocrPdfEnhanced method:', error);
            throw new InternalServerErrorException(
                'Failed to process enhanced OCR'
            );
        } finally {
            await this.cleanupTempFiles(tempFiles);
        }
    }

    /**
     * Standard OCR without preprocessing (legacy method, now with higher DPI)
     */
    async ocrPdf(fileBuffer: Buffer): Promise<string> {
        const tempFiles: string[] = [];

        try {
            const convert = pdf2pic.fromBuffer(fileBuffer, {
                density: 300, // Increased from 100
                saveFilename: 'page',
                savePath: '/tmp/',
                format: 'png',
                width: 2480,
                height: 3508,
            });

            const results = await convert.bulk(-1);
            let fullText = '';

            for (const result of results) {
                if (!result || !result.path) {
                    console.warn('Skipping result without valid path:', result);
                    continue;
                }

                try {
                    tempFiles.push(result.path);

                    const {
                        data: { text },
                    } = await Tesseract.recognize(result.path, 'eng+vie');

                    fullText += text + '\n';
                } catch (ocrError) {
                    console.error(
                        `Error processing page ${result.path}:`,
                        ocrError
                    );
                    throw new InternalServerErrorException(
                        `Failed to OCR page ${result.path}`
                    );
                }
            }

            return fullText.trim();
        } catch (error) {
            console.error('Error in ocrPdf method:', error);
            throw new InternalServerErrorException('Failed to process OCR');
        } finally {
            await this.cleanupTempFiles(tempFiles);
        }
    }

    private async cleanupTempFiles(filePaths: string[]): Promise<void> {
        for (const filePath of filePaths) {
            try {
                await fs.unlink(filePath);
            } catch (cleanupError) {
                console.warn(
                    `Failed to cleanup temp file ${filePath}:`,
                    cleanupError
                );
            }
        }
    }

    /**
     * Alternative parallel OCR with preprocessing (balances speed and quality)
     */
    async ocrPdfAlternative(fileBuffer: Buffer): Promise<string> {
        try {
            const convert = pdf2pic.fromBuffer(fileBuffer, {
                density: 300, // Increased from 150
                saveFilename: `ocr_${Date.now()}_page`,
                savePath: '/tmp/',
                format: 'png',
                width: 2480,
                height: 3508,
            });

            const results = await convert.bulk(-1);

            if (!results || results.length === 0) {
                throw new Error('No pages could be converted from PDF');
            }

            const ocrPromises = results
                .filter((result) => result?.path)
                .map(async (result, index) => {
                    try {
                        const {
                            data: { text },
                        } = await Tesseract.recognize(result.path!, 'eng+vie', {
                            logger: (progress) => {
                                if (progress.status === 'recognizing text') {
                                    console.log(
                                        `Page ${index + 1}: ${Math.round(progress.progress * 100)}%`
                                    );
                                }
                            },
                        });
                        return { pageIndex: index, text, path: result.path! };
                    } catch (error) {
                        console.error(
                            `Error processing page ${index + 1}:`,
                            error
                        );
                        return {
                            pageIndex: index,
                            text: '',
                            path: result.path!,
                        };
                    }
                });

            const ocrResults = await Promise.all(ocrPromises);

            ocrResults.sort((a, b) => a.pageIndex - b.pageIndex);

            for (const result of ocrResults) {
                try {
                    await fs.unlink(result.path);
                } catch (cleanupError) {
                    console.warn(
                        `Failed to cleanup ${result.path}:`,
                        cleanupError
                    );
                }
            }

            return ocrResults
                .map((result) => result.text)
                .join('\n')
                .trim();
        } catch (error) {
            console.error('Error in ocrPdfAlternative method:', error);
            throw new InternalServerErrorException('Failed to process OCR');
        }
    }
}
