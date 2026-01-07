import { ApiProperty } from '@nestjs/swagger';

export class FlashCardDto {
    @ApiProperty({ description: 'ID của thẻ ghi nhớ' })
    id: string;

    @ApiProperty({ description: 'Câu hỏi' })
    question: string;

    @ApiProperty({ description: 'Câu trả lời' })
    answer: string;

    @ApiProperty({ description: 'ID của bộ thẻ ghi nhớ' })
    flashCardSetId: string;

    @ApiProperty({ description: 'Thời gian tạo' })
    createdAt: Date;

    @ApiProperty({ description: 'Thời gian cập nhật' })
    updatedAt: Date;
}

export class FlashCardSetDto {
    @ApiProperty({ description: 'ID của bộ thẻ ghi nhớ' })
    id: string;

    @ApiProperty({ description: 'Tiêu đề bộ thẻ ghi nhớ' })
    title: string;

    @ApiProperty({ description: 'Mô tả bộ thẻ ghi nhớ', required: false })
    description?: string;

    @ApiProperty({ description: 'Ảnh thumbnail', required: false })
    thumbnail?: string;

    @ApiProperty({ description: 'Các thẻ tag', type: [String] })
    tag: string[];

    @ApiProperty({ description: 'Bộ thẻ ghi nhớ công khai hay không' })
    isPublic: boolean;

    @ApiProperty({ description: 'Bộ thẻ ghi nhớ được ghim hay không' })
    isPinned: boolean;

    @ApiProperty({ description: 'ID người tạo' })
    userId: string;

    @ApiProperty({ description: 'Thời gian tạo' })
    createdAt: Date;

    @ApiProperty({ description: 'Thời gian cập nhật' })
    updatedAt: Date;

    @ApiProperty({
        description: 'Danh sách thẻ ghi nhớ',
        type: [FlashCardDto],
        required: false,
    })
    flashCards?: FlashCardDto[];
}

export class CreateFlashCardSetResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;

    @ApiProperty({
        description: 'Bộ thẻ ghi nhớ đã tạo',
        type: FlashCardSetDto,
    })
    flashcardSet: FlashCardSetDto;
}

export class UpdateFlashCardSetResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;

    @ApiProperty({
        description: 'Bộ thẻ ghi nhớ đã cập nhật',
        type: FlashCardSetDto,
    })
    flashcardSet: FlashCardSetDto;
}

export class GetFlashCardSetsResponseDto {
    @ApiProperty({
        description: 'Danh sách bộ thẻ ghi nhớ',
        type: [FlashCardSetDto],
    })
    flashcardSets: FlashCardSetDto[];

    @ApiProperty({ description: 'Tổng số bộ thẻ ghi nhớ' })
    total: number;

    @ApiProperty({ description: 'Trang hiện tại' })
    page: number;

    @ApiProperty({ description: 'Số lượng mỗi trang' })
    limit: number;

    @ApiProperty({ description: 'Tổng số trang' })
    totalPages: number;
}

export class DeleteFlashCardSetResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;
}

export class SetFlashcardsToFlashcardSetResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;

    @ApiProperty({ description: 'Số lượng thẻ ghi nhớ đã tạo' })
    createdCount: number;

    @ApiProperty({ description: 'Số lượng thẻ ghi nhớ đã cập nhật nhãn' })
    updatedCount: number;

    @ApiProperty({ description: 'Số lượng thẻ ghi nhớ đã bỏ qua do trùng lặp' })
    skippedCount: number;

    @ApiProperty({ description: 'Số lượng bộ thẻ ghi nhớ đã ảnh hưởng' })
    affectedFlashcardSets: number;
}
