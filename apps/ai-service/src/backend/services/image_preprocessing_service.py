"""
Image Preprocessing Service - Port từ NestJS image-preprocessing.service.ts

Pipeline tối ưu hóa ảnh trước OCR:
1. Grayscale conversion - Chuyển sang ảnh xám
2. CLAHE - Contrast Limited Adaptive Histogram Equalization (tăng tương phản local)
3. Gamma Correction - Điều chỉnh độ sáng
4. Adaptive Thresholding - Binarization cho text rõ hơn
5. Median Blur - Khử nhiễu salt-and-pepper
6. Sharpening - Làm nét

Dependencies:
- opencv-python: pip install opencv-python
- numpy: pip install numpy
"""

import logging
import numpy as np
from typing import Optional
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Check OpenCV availability
try:
    import cv2
    OPENCV_AVAILABLE = True
    logger.info(f"OpenCV available: version {cv2.__version__}")
except ImportError:
    OPENCV_AVAILABLE = False
    logger.warning("OpenCV not available. Install: pip install opencv-python")


@dataclass
class PreprocessingOptions:
    """Options for image preprocessing pipeline"""
    # Grayscale conversion
    grayscale: bool = True

    # CLAHE - Contrast Limited Adaptive Histogram Equalization
    clahe: bool = True
    clahe_clip_limit: float = 2.0
    clahe_tile_size: int = 8

    # Gamma correction (< 1 brightens, > 1 darkens)
    gamma_correction: bool = True
    gamma: float = 0.7

    # Thresholding
    threshold: bool = True
    use_otsu: bool = False
    threshold_block_size: int = 11
    threshold_c: int = 2

    # Denoising
    denoise: bool = True
    denoise_kernel_size: int = 3

    # Sharpening
    sharpen: bool = True


# Preset configurations
DEFAULT_OPTIONS = PreprocessingOptions()

LIGHT_OPTIONS = PreprocessingOptions(
    grayscale=True,
    clahe=True,
    gamma_correction=False,
    threshold=False,
    denoise=True,
    sharpen=False,
)

HEAVY_OPTIONS = PreprocessingOptions(
    grayscale=True,
    clahe=True,
    clahe_clip_limit=3.0,
    gamma_correction=True,
    gamma=0.6,
    threshold=True,
    use_otsu=True,
    denoise=True,
    denoise_kernel_size=5,
    sharpen=True,
)


class ImagePreprocessingService:
    """
    Image preprocessing service for OCR optimization.
    Port từ NestJS image-preprocessing.service.ts

    Pipeline steps:
    1. Grayscale conversion
    2. CLAHE (Contrast Limited Adaptive Histogram Equalization)
    3. Gamma Correction
    4. Adaptive/Otsu Thresholding
    5. Median Blur Denoising
    6. Sharpening
    """

    def __init__(self):
        if not OPENCV_AVAILABLE:
            raise RuntimeError("OpenCV not available. Install: pip install opencv-python")
        logger.info("ImagePreprocessingService initialized")

    def preprocess_image(
        self,
        image: np.ndarray,
        options: Optional[PreprocessingOptions] = None
    ) -> np.ndarray:
        """
        Main preprocessing method - applies full pipeline to image.

        Args:
            image: Input image as numpy array (from cv2.imread or similar)
            options: Preprocessing options

        Returns:
            Processed image as numpy array
        """
        opts = options or DEFAULT_OPTIONS

        logger.debug("Starting image preprocessing pipeline...")

        processed = image.copy()

        # Step 1: Convert to grayscale
        if opts.grayscale:
            logger.debug("Applying grayscale conversion...")
            processed = self._apply_grayscale(processed)

        # Step 2: Apply CLAHE
        if opts.clahe:
            logger.debug("Applying CLAHE...")
            processed = self._apply_clahe(
                processed,
                opts.clahe_clip_limit,
                opts.clahe_tile_size
            )

        # Step 3: Apply Gamma Correction
        if opts.gamma_correction:
            logger.debug(f"Applying gamma correction (γ={opts.gamma})...")
            processed = self._apply_gamma_correction(processed, opts.gamma)

        # Step 4: Apply Thresholding
        if opts.threshold:
            method = "Otsu's" if opts.use_otsu else "adaptive"
            logger.debug(f"Applying {method} thresholding...")
            processed = self._apply_threshold(
                processed,
                opts.use_otsu,
                opts.threshold_block_size,
                opts.threshold_c
            )

        # Step 5: Apply Denoising
        if opts.denoise:
            logger.debug("Applying median blur denoising...")
            processed = self._apply_denoise(processed, opts.denoise_kernel_size)

        # Step 6: Apply Sharpening
        if opts.sharpen:
            logger.debug("Applying sharpening kernel...")
            processed = self._apply_sharpen(processed)

        logger.debug("Image preprocessing completed")
        return processed

    def _apply_grayscale(self, image: np.ndarray) -> np.ndarray:
        """Convert image to grayscale"""
        if len(image.shape) == 2:
            # Already grayscale
            return image

        if image.shape[2] == 4:
            # RGBA -> Grayscale
            return cv2.cvtColor(image, cv2.COLOR_RGBA2GRAY)
        elif image.shape[2] == 3:
            # RGB/BGR -> Grayscale
            return cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        return image

    def _apply_clahe(
        self,
        image: np.ndarray,
        clip_limit: float,
        tile_size: int
    ) -> np.ndarray:
        """
        Apply CLAHE - Contrast Limited Adaptive Histogram Equalization.
        Tăng tương phản locally, tốt cho văn bản với ánh sáng không đều.
        """
        # Ensure grayscale
        if len(image.shape) == 3:
            image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        # Create CLAHE object
        clahe = cv2.createCLAHE(
            clipLimit=clip_limit,
            tileGridSize=(tile_size, tile_size)
        )

        return clahe.apply(image)

    def _apply_gamma_correction(
        self,
        image: np.ndarray,
        gamma: float
    ) -> np.ndarray:
        """
        Apply Gamma Correction: output = input^gamma
        gamma < 1: làm sáng hơn (tốt cho ảnh tối)
        gamma > 1: làm tối hơn
        """
        # Build lookup table
        inv_gamma = 1.0 / gamma
        table = np.array([
            np.clip(pow(i / 255.0, inv_gamma) * 255.0, 0, 255)
            for i in range(256)
        ]).astype("uint8")

        # Apply LUT
        return cv2.LUT(image, table)

    def _apply_threshold(
        self,
        image: np.ndarray,
        use_otsu: bool,
        block_size: int,
        c: int
    ) -> np.ndarray:
        """
        Apply Thresholding - Adaptive or Otsu's method.
        Chuyển ảnh sang binary, làm text nổi bật hơn.
        """
        # Ensure grayscale
        if len(image.shape) == 3:
            image = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

        if use_otsu:
            # Otsu's binarization - tự động xác định ngưỡng tối ưu
            _, result = cv2.threshold(
                image, 0, 255,
                cv2.THRESH_BINARY + cv2.THRESH_OTSU
            )
        else:
            # Adaptive thresholding - tốt cho ánh sáng không đều
            # Block size must be odd
            if block_size % 2 == 0:
                block_size += 1

            result = cv2.adaptiveThreshold(
                image,
                255,
                cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                cv2.THRESH_BINARY,
                block_size,
                c
            )

        return result

    def _apply_denoise(
        self,
        image: np.ndarray,
        kernel_size: int
    ) -> np.ndarray:
        """
        Apply Denoising using Median Blur.
        Hiệu quả với nhiễu salt-and-pepper.
        """
        # Ensure kernel size is odd
        if kernel_size % 2 == 0:
            kernel_size += 1

        return cv2.medianBlur(image, kernel_size)

    def _apply_sharpen(self, image: np.ndarray) -> np.ndarray:
        """
        Apply Sharpening using convolution with a 3x3 sharpening kernel.
        Kernel: [0, -1, 0]
                [-1, 5, -1]
                [0, -1, 0]
        """
        kernel = np.array([
            [0, -1, 0],
            [-1, 5, -1],
            [0, -1, 0]
        ], dtype=np.float32)

        return cv2.filter2D(image, -1, kernel)

    def preprocess_image_light(self, image: np.ndarray) -> np.ndarray:
        """Lightweight preprocessing for fast OCR"""
        return self.preprocess_image(image, LIGHT_OPTIONS)

    def preprocess_image_heavy(self, image: np.ndarray) -> np.ndarray:
        """Heavy preprocessing for difficult/scanned documents"""
        return self.preprocess_image(image, HEAVY_OPTIONS)

    def preprocess_from_bytes(
        self,
        image_bytes: bytes,
        options: Optional[PreprocessingOptions] = None
    ) -> bytes:
        """
        Preprocess image from bytes and return processed bytes.
        Convenient for integration with OCR pipelines.
        """
        # Decode image
        nparr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if image is None:
            raise ValueError("Could not decode image from bytes")

        # Process
        processed = self.preprocess_image(image, options)

        # Encode back to PNG
        _, encoded = cv2.imencode('.png', processed)
        return encoded.tobytes()

    def preprocess_from_file(
        self,
        file_path: str,
        options: Optional[PreprocessingOptions] = None
    ) -> np.ndarray:
        """
        Load image from file, preprocess, and return.
        """
        image = cv2.imread(file_path)
        if image is None:
            raise ValueError(f"Could not read image from {file_path}")

        return self.preprocess_image(image, options)


# Singleton instance
image_preprocessing_service = ImagePreprocessingService() if OPENCV_AVAILABLE else None


def get_image_preprocessing_service() -> ImagePreprocessingService:
    """Get the singleton instance of ImagePreprocessingService"""
    if image_preprocessing_service is None:
        raise RuntimeError("OpenCV not available. Install: pip install opencv-python")
    return image_preprocessing_service
