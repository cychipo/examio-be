import { ApiProperty } from '@nestjs/swagger';

export class ParticipantDto {
    @ApiProperty({ description: 'ID người tham gia' })
    id: string;

    @ApiProperty({ description: 'ID phòng thi' })
    examRoomId: string;

    @ApiProperty({ description: 'ID người dùng' })
    userId: string;

    @ApiProperty({ description: 'Vai trò' })
    role: string;

    @ApiProperty({ description: 'Đã tham gia lúc' })
    joinedAt: Date;

    @ApiProperty({ description: 'Thời gian tạo' })
    createdAt: Date;

    @ApiProperty({ description: 'Thời gian cập nhật' })
    updatedAt: Date;
}

export class CreateParticipantResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;

    @ApiProperty({ description: 'Người tham gia đã tạo', type: ParticipantDto })
    participant: ParticipantDto;
}

export class UpdateParticipantResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;

    @ApiProperty({
        description: 'Người tham gia đã cập nhật',
        type: ParticipantDto,
    })
    participant: ParticipantDto;
}

export class GetParticipantsResponseDto {
    @ApiProperty({
        description: 'Danh sách người tham gia',
        type: [ParticipantDto],
    })
    participants: ParticipantDto[];

    @ApiProperty({ description: 'Tổng số người tham gia' })
    total: number;

    @ApiProperty({ description: 'Trang hiện tại' })
    page: number;

    @ApiProperty({ description: 'Số lượng mỗi trang' })
    limit: number;

    @ApiProperty({ description: 'Tổng số trang' })
    totalPages: number;
}

export class DeleteParticipantResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;
}
