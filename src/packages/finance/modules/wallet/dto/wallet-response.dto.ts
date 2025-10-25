import { ApiProperty } from '@nestjs/swagger';

export class WalletDto {
    @ApiProperty({ description: 'ID ví' })
    id: string;

    @ApiProperty({ description: 'ID người dùng' })
    userId: string;

    @ApiProperty({ description: 'Số dư' })
    balance: number;

    @ApiProperty({ description: 'Thời gian tạo' })
    createdAt: Date;

    @ApiProperty({ description: 'Thời gian cập nhật' })
    updatedAt: Date;
}

export class DepositResponseDto {
    @ApiProperty({
        description: 'Thông tin ví sau khi nạp tiền',
        type: WalletDto,
    })
    wallet: WalletDto;
}

export class DeductResponseDto {
    @ApiProperty({
        description: 'Thông tin ví sau khi trừ tiền',
        type: WalletDto,
    })
    wallet: WalletDto;
}
