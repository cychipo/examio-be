import { ApiProperty } from '@nestjs/swagger';

export class GenerateContentResponseDto {
    @ApiProperty({ description: 'Nội dung đã tạo' })
    content: string;
}

export class GenerateFromFileResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;

    @ApiProperty({ description: 'Nội dung đã trích xuất từ file' })
    extractedText: string;
}

export class GenerateQuizResponseDto {
    @ApiProperty({ description: 'Danh sách câu hỏi đã tạo', type: Array })
    questions: Array<{
        question: string;
        options: string[];
        answer: string;
    }>;
}

export class GenerateFlashcardsResponseDto {
    @ApiProperty({ description: 'Danh sách flashcards đã tạo', type: Array })
    flashcards: Array<{
        question: string;
        answer: string;
    }>;
}
