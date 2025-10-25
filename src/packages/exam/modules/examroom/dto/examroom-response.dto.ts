import { ApiProperty } from '@nestjs/swagger';

class QuizSetSummaryDto {
    @ApiProperty({ description: 'ID bộ câu hỏi' })
    id: string;

    @ApiProperty({ description: 'Tiêu đề' })
    title: string;

    @ApiProperty({ description: 'Mô tả', required: false })
    description?: string;
}

class HostSummaryDto {
    @ApiProperty({ description: 'ID người tạo' })
    id: string;

    @ApiProperty({ description: 'Email', required: false })
    email?: string;

    @ApiProperty({ description: 'Tên', required: false })
    name?: string;
}

export class ExamRoomDto {
    @ApiProperty({ description: 'ID phòng thi' })
    id: string;

    @ApiProperty({ description: 'Tiêu đề phòng thi' })
    title: string;

    @ApiProperty({ description: 'Mô tả phòng thi', required: false })
    description?: string;

    @ApiProperty({ description: 'ID bộ câu hỏi' })
    quizSetId: string;

    @ApiProperty({ description: 'ID người tạo' })
    hostId: string;

    @ApiProperty({ description: 'Loại đánh giá' })
    assessType: string;

    @ApiProperty({ description: 'Cho phép thi lại' })
    allowRetake: boolean;

    @ApiProperty({ description: 'Số lần thi tối đa' })
    maxAttempts: number;

    @ApiProperty({ description: 'Thời gian tạo' })
    createdAt: Date;

    @ApiProperty({ description: 'Thời gian cập nhật' })
    updatedAt: Date;

    @ApiProperty({
        description: 'Bộ câu hỏi',
        type: QuizSetSummaryDto,
        required: false,
    })
    quizSet?: QuizSetSummaryDto;

    @ApiProperty({
        description: 'Người tạo',
        type: HostSummaryDto,
        required: false,
    })
    host?: HostSummaryDto;
}

export class CreateExamRoomResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;

    @ApiProperty({ description: 'Phòng thi đã tạo', type: ExamRoomDto })
    examRoom: ExamRoomDto;
}

export class UpdateExamRoomResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;

    @ApiProperty({ description: 'Phòng thi đã cập nhật', type: ExamRoomDto })
    examRoom: ExamRoomDto;
}

export class GetExamRoomsResponseDto {
    @ApiProperty({ description: 'Danh sách phòng thi', type: [ExamRoomDto] })
    examRooms: ExamRoomDto[];

    @ApiProperty({ description: 'Tổng số phòng thi' })
    total: number;

    @ApiProperty({ description: 'Trang hiện tại' })
    page: number;

    @ApiProperty({ description: 'Số lượng mỗi trang' })
    limit: number;

    @ApiProperty({ description: 'Tổng số trang' })
    totalPages: number;
}

export class DeleteExamRoomResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;
}
