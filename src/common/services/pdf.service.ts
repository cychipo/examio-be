import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as Tesseract from 'tesseract.js';
import * as pdf2pic from 'pdf2pic';
import { promises as fs } from 'fs';

@Injectable()
export class PdfService {
    async ocrPdf(fileBuffer: Buffer): Promise<string> {
        const tempFiles: string[] = [];

        try {
            const convert = pdf2pic.fromBuffer(fileBuffer, {
                density: 100,
                saveFilename: 'page',
                savePath: '/tmp/',
                format: 'png',
                width: 600,
                height: 600,
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

    async ocrPdfAlternative(fileBuffer: Buffer): Promise<string> {
        try {
            const convert = pdf2pic.fromBuffer(fileBuffer, {
                density: 150,
                saveFilename: `ocr_${Date.now()}_page`,
                savePath: '/tmp/',
                format: 'png',
                width: 800,
                height: 800,
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
