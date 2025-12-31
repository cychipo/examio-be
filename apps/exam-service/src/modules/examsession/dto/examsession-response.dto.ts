import { ApiProperty } from '@nestjs/swagger';

export class ExamSessionDto {
    @ApiProperty({ description: 'ID phiên thi' })
    id: string;

    @ApiProperty({ description: 'ID phòng thi' })
    examRoomId: string;

    @ApiProperty({ description: 'Thời gian bắt đầu' })
    startTime: Date;

    @ApiProperty({ description: 'Thời gian kết thúc', required: false })
    endTime?: Date;

    @ApiProperty({ description: 'Thời gian làm bài (phút)', required: false })
    duration?: number;

    @ApiProperty({ description: 'Đã kích hoạt chưa' })
    isActive: boolean;

    @ApiProperty({ description: 'Mã truy cập', required: false })
    accessCode?: string;

    @ApiProperty({ description: 'Thời gian tạo' })
    createdAt: Date;

    @ApiProperty({ description: 'Thời gian cập nhật' })
    updatedAt: Date;
}

export class CreateExamSessionResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;

    @ApiProperty({ description: 'Phiên thi đã tạo', type: ExamSessionDto })
    examSession: ExamSessionDto;
}

export class UpdateExamSessionResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;

    @ApiProperty({ description: 'Phiên thi đã cập nhật', type: ExamSessionDto })
    examSession: ExamSessionDto;
}

export class GetExamSessionsResponseDto {
    @ApiProperty({ description: 'Danh sách phiên thi', type: [ExamSessionDto] })
    examSessions: ExamSessionDto[];

    @ApiProperty({ description: 'Tổng số phiên thi' })
    total: number;

    @ApiProperty({ description: 'Trang hiện tại' })
    page: number;

    @ApiProperty({ description: 'Số lượng mỗi trang' })
    limit: number;

    @ApiProperty({ description: 'Tổng số trang' })
    totalPages: number;
}

export class DeleteExamSessionResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;
}
