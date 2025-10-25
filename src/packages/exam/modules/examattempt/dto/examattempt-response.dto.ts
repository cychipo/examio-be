import { ApiProperty } from '@nestjs/swagger';

export class ExamAttemptDto {
    @ApiProperty({ description: 'ID lần thi' })
    id: string;

    @ApiProperty({ description: 'ID phiên thi' })
    examSessionId: string;

    @ApiProperty({ description: 'ID người thi' })
    userId: string;

    @ApiProperty({ description: 'Thời gian bắt đầu' })
    startedAt: Date;

    @ApiProperty({ description: 'Thời gian hoàn thành', required: false })
    completedAt?: Date;

    @ApiProperty({ description: 'Điểm số', required: false })
    score?: number;

    @ApiProperty({ description: 'Câu trả lời', type: Object, required: false })
    answers?: any;

    @ApiProperty({ description: 'Trạng thái' })
    status: string;

    @ApiProperty({ description: 'Thời gian tạo' })
    createdAt: Date;

    @ApiProperty({ description: 'Thời gian cập nhật' })
    updatedAt: Date;
}

export class CreateExamAttemptResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;

    @ApiProperty({ description: 'Lần thi đã tạo', type: ExamAttemptDto })
    examAttempt: ExamAttemptDto;
}

export class UpdateExamAttemptResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;

    @ApiProperty({ description: 'Lần thi đã cập nhật', type: ExamAttemptDto })
    examAttempt: ExamAttemptDto;
}

export class GetExamAttemptsResponseDto {
    @ApiProperty({ description: 'Danh sách lần thi', type: [ExamAttemptDto] })
    examAttempts: ExamAttemptDto[];

    @ApiProperty({ description: 'Tổng số lần thi' })
    total: number;

    @ApiProperty({ description: 'Trang hiện tại' })
    page: number;

    @ApiProperty({ description: 'Số lượng mỗi trang' })
    limit: number;

    @ApiProperty({ description: 'Tổng số trang' })
    totalPages: number;
}

export class DeleteExamAttemptResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;
}
