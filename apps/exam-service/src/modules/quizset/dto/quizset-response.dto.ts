import { ApiProperty } from '@nestjs/swagger';

export class QuizQuestionDto {
    @ApiProperty({ description: 'ID của câu hỏi' })
    id: string;

    @ApiProperty({ description: 'Nội dung câu hỏi' })
    question: string;

    @ApiProperty({ description: 'Các lựa chọn', type: [String] })
    options: string[];

    @ApiProperty({ description: 'Câu trả lời đúng' })
    answer: string;

    @ApiProperty({ description: 'ID của bộ câu hỏi' })
    quizSetId: string;

    @ApiProperty({ description: 'Thời gian tạo' })
    createdAt: Date;

    @ApiProperty({ description: 'Thời gian cập nhật' })
    updatedAt: Date;
}

export class QuizSetDto {
    @ApiProperty({ description: 'ID của bộ câu hỏi' })
    id: string;

    @ApiProperty({ description: 'Tiêu đề bộ câu hỏi' })
    title: string;

    @ApiProperty({ description: 'Mô tả bộ câu hỏi', required: false })
    description?: string;

    @ApiProperty({ description: 'Ảnh thumbnail', required: false })
    thumbnail?: string;

    @ApiProperty({ description: 'Các thẻ tag', type: [String] })
    tags: string[];

    @ApiProperty({ description: 'Bộ câu hỏi công khai hay không' })
    isPublic: boolean;

    @ApiProperty({ description: 'Bộ câu hỏi được ghim hay không' })
    isPinned: boolean;

    @ApiProperty({ description: 'ID người tạo' })
    userId: string;

    @ApiProperty({ description: 'Thời gian tạo' })
    createdAt: Date;

    @ApiProperty({ description: 'Thời gian cập nhật' })
    updatedAt: Date;

    @ApiProperty({
        description: 'Danh sách câu hỏi',
        type: [QuizQuestionDto],
        required: false,
    })
    questions?: QuizQuestionDto[];
}

export class QuizSetWithoutQuestionsDto {
    @ApiProperty({ description: 'ID của bộ câu hỏi' })
    id: string;

    @ApiProperty({ description: 'Tiêu đề bộ câu hỏi' })
    title: string;

    @ApiProperty({ description: 'Mô tả bộ câu hỏi', required: false })
    description?: string;

    @ApiProperty({ description: 'Ảnh thumbnail', required: false })
    thumbnail?: string;

    @ApiProperty({ description: 'Các thẻ tag', type: [String] })
    tags: string[];

    @ApiProperty({ description: 'Bộ câu hỏi công khai hay không' })
    isPublic: boolean;

    @ApiProperty({ description: 'Bộ câu hỏi được ghim hay không' })
    isPinned: boolean;

    @ApiProperty({ description: 'ID người tạo' })
    userId: string;

    @ApiProperty({ description: 'Thời gian tạo' })
    createdAt: Date;

    @ApiProperty({ description: 'Thời gian cập nhật' })
    updatedAt: Date;
}

export class CreateQuizSetResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;

    @ApiProperty({
        description: 'Bộ câu hỏi đã tạo',
        type: QuizSetWithoutQuestionsDto,
    })
    quizSet: QuizSetWithoutQuestionsDto;
}

export class UpdateQuizSetResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;

    @ApiProperty({ description: 'Bộ câu hỏi đã cập nhật', type: QuizSetDto })
    quizSet: QuizSetDto;
}

export class GetQuizSetsResponseDto {
    @ApiProperty({ description: 'Danh sách bộ câu hỏi', type: [QuizSetDto] })
    quizSets: QuizSetDto[];

    @ApiProperty({ description: 'Tổng số bộ câu hỏi' })
    total: number;

    @ApiProperty({ description: 'Trang hiện tại' })
    page: number;

    @ApiProperty({ description: 'Số lượng mỗi trang' })
    limit: number;

    @ApiProperty({ description: 'Tổng số trang' })
    totalPages: number;
}

export class DeleteQuizSetResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;
}

export class SetQuizzesToQuizSetResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;

    @ApiProperty({ description: 'Số lượng câu hỏi đã tạo' })
    createdCount: number;
}
