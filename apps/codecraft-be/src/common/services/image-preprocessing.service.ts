import { Injectable, Logger } from '@nestjs/common';
import { Jimp } from 'jimp';

// OpenCV.js types - cv is loaded dynamically
declare const cv: any;

interface PreprocessingOptions {
    /** Enable grayscale conversion (default: true) */
    grayscale?: boolean;
    /** Enable CLAHE contrast enhancement (default: true) */
    clahe?: boolean;
    /** CLAHE clip limit (default: 2.0) */
    claheClipLimit?: number;
    /** CLAHE tile grid size (default: 8) */
    claheTileSize?: number;
    /** Enable gamma correction (default: true) */
    gammaCorrection?: boolean;
    /** Gamma value - <1 brightens, >1 darkens (default: 0.7) */
    gamma?: number;
    /** Enable thresholding (default: true) */
    threshold?: boolean;
    /** Use Otsu's method instead of adaptive (default: false) */
    useOtsu?: boolean;
    /** Adaptive threshold block size (default: 11) */
    thresholdBlockSize?: number;
    /** Adaptive threshold C constant (default: 2) */
    thresholdC?: number;
    /** Enable denoising (default: true) */
    denoise?: boolean;
    /** Median blur kernel size (default: 3) */
    denoiseKernelSize?: number;
    /** Enable sharpening (default: true) */
    sharpen?: boolean;
}

const DEFAULT_OPTIONS: PreprocessingOptions = {
    grayscale: true,
    clahe: true,
    claheClipLimit: 2.0,
    claheTileSize: 8,
    gammaCorrection: true,
    gamma: 0.7,
    threshold: true,
    useOtsu: false,
    thresholdBlockSize: 11,
    thresholdC: 2,
    denoise: true,
    denoiseKernelSize: 3,
    sharpen: true,
};

@Injectable()
export class ImagePreprocessingService {
    private readonly logger = new Logger(ImagePreprocessingService.name);
    private cvInstance: any = null;
    private cvReady = false;
    private initPromise: Promise<void> | null = null;

    constructor() {
        // Don't initialize in constructor - lazy load on first use
        this.logger.log('ImagePreprocessingService created (OpenCV will be loaded on first use)');
    }

    /**
     * Initialize OpenCV.js asynchronously with timeout
     */
    private async initOpenCV(): Promise<void> {
        // Return existing promise if already initializing
        if (this.initPromise) {
            return this.initPromise;
        }

        this.initPromise = this.doInitOpenCV();
        return this.initPromise;
    }

    private async doInitOpenCV(): Promise<void> {
        try {
            this.logger.log('Loading OpenCV.js...');
            const opencvModule = await import('@techstark/opencv-js');
            this.cvInstance = opencvModule.default || opencvModule;

            // Check if already initialized (common in Node.js)
            if (this.cvInstance && typeof this.cvInstance.Mat === 'function') {
                this.cvReady = true;
                this.logger.log('OpenCV.js loaded and ready (already initialized)');
                return;
            }

            // Wait for OpenCV to be ready with timeout
            if (this.cvInstance.onRuntimeInitialized !== undefined) {
                await Promise.race([
                    new Promise<void>((resolve) => {
                        const originalCallback = this.cvInstance.onRuntimeInitialized;
                        this.cvInstance.onRuntimeInitialized = () => {
                            if (originalCallback) originalCallback();
                            this.cvReady = true;
                            this.logger.log('OpenCV.js runtime initialized');
                            resolve();
                        };
                    }),
                    new Promise<void>((_, reject) => {
                        setTimeout(() => {
                            // Check one more time if it's ready despite timeout
                            if (this.cvInstance && typeof this.cvInstance.Mat === 'function') {
                                this.cvReady = true;
                                this.logger.log('OpenCV.js ready after timeout check');
                            } else {
                                reject(new Error('OpenCV.js initialization timeout'));
                            }
                        }, 10000);
                    }),
                ]);
            } else {
                // No callback defined, assume ready
                this.cvReady = true;
                this.logger.log('OpenCV.js loaded (no callback needed)');
            }
        } catch (error) {
            this.logger.error('Failed to initialize OpenCV.js:', error);
            this.initPromise = null; // Allow retry
            throw error;
        }
    }

    /**
     * Ensure OpenCV is ready before processing
     */
    private async ensureOpenCVReady(): Promise<any> {
        if (!this.cvReady) {
            await this.initOpenCV();
        }
        return this.cvInstance;
    }

    /**
     * Main preprocessing method - applies full pipeline to image buffer
     * @param imageBuffer - Input image buffer (PNG/JPG)
     * @param options - Preprocessing options
     * @returns Processed image buffer
     */
    async preprocessImage(
        imageBuffer: Buffer,
        options: PreprocessingOptions = {}
    ): Promise<Buffer> {
        const opts = { ...DEFAULT_OPTIONS, ...options };
        const cv = await this.ensureOpenCVReady();

        this.logger.log('Starting image preprocessing pipeline...');

        // Load image using Jimp (v1 API)
        const image = await Jimp.fromBuffer(imageBuffer);
        const width = image.width;
        const height = image.height;

        // Convert Jimp image to OpenCV Mat
        const imageData = new Uint8ClampedArray(image.bitmap.data);
        let mat = cv.matFromImageData({
            data: imageData,
            width: width,
            height: height,
        });

        try {
            // Step 1: Convert to grayscale
            if (opts.grayscale) {
                this.logger.debug('Applying grayscale conversion...');
                mat = this.applyGrayscale(cv, mat);
            }

            // Step 2: Apply CLAHE (Contrast Limited Adaptive Histogram Equalization)
            if (opts.clahe) {
                this.logger.debug('Applying CLAHE...');
                mat = this.applyCLAHE(
                    cv,
                    mat,
                    opts.claheClipLimit!,
                    opts.claheTileSize!
                );
            }

            // Step 3: Apply Gamma Correction
            if (opts.gammaCorrection) {
                this.logger.debug(`Applying gamma correction (γ=${opts.gamma})...`);
                mat = this.applyGammaCorrection(cv, mat, opts.gamma!);
            }

            // Step 4: Apply Thresholding
            if (opts.threshold) {
                this.logger.debug(
                    `Applying ${opts.useOtsu ? "Otsu's" : 'adaptive'} thresholding...`
                );
                mat = this.applyThreshold(
                    cv,
                    mat,
                    opts.useOtsu!,
                    opts.thresholdBlockSize!,
                    opts.thresholdC!
                );
            }

            // Step 5: Apply Denoising
            if (opts.denoise) {
                this.logger.debug('Applying median blur denoising...');
                mat = this.applyDenoise(cv, mat, opts.denoiseKernelSize!);
            }

            // Step 6: Apply Sharpening
            if (opts.sharpen) {
                this.logger.debug('Applying sharpening kernel...');
                mat = this.applySharpen(cv, mat);
            }

            // Convert back to buffer
            const processedBuffer = await this.matToBuffer(cv, mat, image);
            this.logger.log('Image preprocessing completed successfully');

            return processedBuffer;
        } finally {
            // Cleanup
            mat.delete();
        }
    }

    /**
     * Convert RGBA to Grayscale
     */
    private applyGrayscale(cv: any, src: any): any {
        const dst = new cv.Mat();

        // Check if already grayscale
        if (src.channels() === 1) {
            src.copyTo(dst);
            return dst;
        }

        // Convert based on number of channels
        if (src.channels() === 4) {
            cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);
        } else if (src.channels() === 3) {
            cv.cvtColor(src, dst, cv.COLOR_RGB2GRAY);
        } else {
            src.copyTo(dst);
        }

        src.delete();
        return dst;
    }

    /**
     * Apply CLAHE - Contrast Limited Adaptive Histogram Equalization
     */
    private applyCLAHE(
        cv: any,
        src: any,
        clipLimit: number,
        tileSize: number
    ): any {
        const dst = new cv.Mat();

        // Ensure input is grayscale
        let graySrc = src;
        if (src.channels() > 1) {
            graySrc = new cv.Mat();
            cv.cvtColor(src, graySrc, cv.COLOR_RGBA2GRAY);
            src.delete();
        }

        // Create CLAHE object
        const clahe = new cv.CLAHE(clipLimit, new cv.Size(tileSize, tileSize));
        clahe.apply(graySrc, dst);

        // Cleanup
        clahe.delete();
        if (graySrc !== src) {
            graySrc.delete();
        }

        return dst;
    }

    /**
     * Apply Gamma Correction: output = input^gamma
     * gamma < 1 brightens, gamma > 1 darkens
     */
    private applyGammaCorrection(cv: any, src: any, gamma: number): any {
        const dst = new cv.Mat();

        // Build lookup table for gamma correction
        const lookUpTable = new cv.Mat(1, 256, cv.CV_8U);
        const data = lookUpTable.data;

        for (let i = 0; i < 256; i++) {
            data[i] = Math.min(255, Math.max(0, Math.pow(i / 255.0, gamma) * 255.0));
        }

        // Apply LUT
        cv.LUT(src, lookUpTable, dst);

        // Cleanup
        lookUpTable.delete();
        src.delete();

        return dst;
    }

    /**
     * Apply Thresholding - Adaptive or Otsu's method
     */
    private applyThreshold(
        cv: any,
        src: any,
        useOtsu: boolean,
        blockSize: number,
        C: number
    ): any {
        const dst = new cv.Mat();

        // Ensure grayscale input
        let graySrc = src;
        if (src.channels() > 1) {
            graySrc = new cv.Mat();
            cv.cvtColor(src, graySrc, cv.COLOR_RGBA2GRAY);
            src.delete();
        }

        if (useOtsu) {
            // Otsu's binarization - automatically determines optimal threshold
            cv.threshold(graySrc, dst, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
        } else {
            // Adaptive thresholding - good for uneven lighting
            cv.adaptiveThreshold(
                graySrc,
                dst,
                255,
                cv.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv.THRESH_BINARY,
                blockSize,
                C
            );
        }

        if (graySrc !== src) {
            graySrc.delete();
        }

        return dst;
    }

    /**
     * Apply Denoising using Median Blur
     * Effective for salt-and-pepper noise
     */
    private applyDenoise(cv: any, src: any, kernelSize: number): any {
        const dst = new cv.Mat();

        // Ensure kernel size is odd
        const ksize = kernelSize % 2 === 0 ? kernelSize + 1 : kernelSize;

        cv.medianBlur(src, dst, ksize);
        src.delete();

        return dst;
    }

    /**
     * Apply Sharpening using convolution with a 3x3 sharpening kernel
     * Kernel: [0, -1, 0]
     *         [-1, 5, -1]
     *         [0, -1, 0]
     */
    private applySharpen(cv: any, src: any): any {
        const dst = new cv.Mat();

        // Define sharpening kernel
        const kernel = cv.matFromArray(3, 3, cv.CV_32FC1, [
            0, -1, 0,
            -1, 5, -1,
            0, -1, 0,
        ]);

        // Apply convolution
        cv.filter2D(
            src,
            dst,
            cv.CV_8U,
            kernel,
            new cv.Point(-1, -1),
            0,
            cv.BORDER_DEFAULT
        );

        // Cleanup
        kernel.delete();
        src.delete();

        return dst;
    }

    /**
     * Convert OpenCV Mat back to Buffer
     */
    private async matToBuffer(cv: any, mat: any, originalImage: any): Promise<Buffer> {
        // Ensure mat is in correct format for output
        let outputMat = mat;

        if (mat.channels() === 1) {
            // Convert grayscale back to RGBA for compatibility
            outputMat = new cv.Mat();
            cv.cvtColor(mat, outputMat, cv.COLOR_GRAY2RGBA);
        }

        // Create new Jimp image with processed data (Jimp v1 API)
        const width = outputMat.cols;
        const height = outputMat.rows;
        const data = Buffer.from(outputMat.data);

        // Create raw Jimp image from bitmap data
        const processedImage = new Jimp({ width, height, data });

        // Cleanup if we created a new mat
        if (outputMat !== mat) {
            outputMat.delete();
        }

        // Return as PNG buffer
        return await processedImage.getBuffer('image/png');
    }

    /**
     * Lightweight preprocessing for fast OCR (fewer steps)
     */
    async preprocessImageLight(imageBuffer: Buffer): Promise<Buffer> {
        return this.preprocessImage(imageBuffer, {
            grayscale: true,
            clahe: true,
            gammaCorrection: false,
            threshold: false,
            denoise: true,
            sharpen: false,
        });
    }

    /**
     * Heavy preprocessing for difficult/scanned documents
     */
    async preprocessImageHeavy(imageBuffer: Buffer): Promise<Buffer> {
        return this.preprocessImage(imageBuffer, {
            grayscale: true,
            clahe: true,
            claheClipLimit: 3.0,
            gammaCorrection: true,
            gamma: 0.6,
            threshold: true,
            useOtsu: true,
            denoise: true,
            denoiseKernelSize: 5,
            sharpen: true,
        });
    }
}
