import { ApiProperty } from '@nestjs/swagger';

export class UserDto {
    @ApiProperty({ description: 'ID người dùng' })
    id: string;

    @ApiProperty({ description: 'Email' })
    email: string;

    @ApiProperty({ description: 'Tên người dùng' })
    username: string;

    @ApiProperty({ description: 'Tên hiển thị', required: false })
    name?: string;

    @ApiProperty({ description: 'Ảnh đại diện', required: false })
    avatar?: string;

    @ApiProperty({ description: 'Ảnh bìa', required: false })
    banner?: string;

    @ApiProperty({ description: 'Tiểu sử', required: false })
    bio?: string;

    @ApiProperty({ description: 'Đã xác minh email chưa' })
    isVerified: boolean;

    @ApiProperty({ description: 'Thời gian tạo' })
    createdAt: Date;

    @ApiProperty({ description: 'Thời gian cập nhật' })
    updatedAt: Date;

    @ApiProperty({ description: 'Thông tin ví', required: false })
    wallet?: {
        id: string;
        userId: string;
        balance: number;
        createdAt: Date;
        updatedAt: Date;
    };
}

export class LoginResponseDto {
    @ApiProperty({ description: 'Thông tin người dùng', type: UserDto })
    user: UserDto;

    @ApiProperty({ description: 'Trạng thái thành công' })
    success: boolean;
}

export class RegisterResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;

    @ApiProperty({ description: 'Thông tin người dùng', type: UserDto })
    user: UserDto;

    @ApiProperty({ description: 'Trạng thái thành công' })
    success: boolean;

    @ApiProperty({ description: 'JWT token' })
    token: string;

    @ApiProperty({ description: 'Device ID', required: false })
    deviceId?: string;
}

export class LogoutResponseDto {
    @ApiProperty({ description: 'Trạng thái thành công' })
    success: boolean;
}

export class RefreshTokenResponseDto {
    @ApiProperty({ description: 'Trạng thái thành công' })
    success: boolean;

    @ApiProperty({ description: 'Access token mới' })
    token: string;
}

export class AuthMessageResponseDto {
    @ApiProperty({ description: 'Thông báo' })
    message: string;
}

export class GetUserResponseDto {
    @ApiProperty({ description: 'Thông tin người dùng', type: UserDto })
    user: UserDto;
}

export class OAuthLoginResponseDto {
    @ApiProperty({ description: 'JWT token' })
    token: string;

    @ApiProperty({ description: 'Thông tin người dùng', type: UserDto })
    user: UserDto;

    @ApiProperty({ description: 'Trạng thái thành công' })
    success: boolean;
}
