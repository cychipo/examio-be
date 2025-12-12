export interface LogoutDeviceResponseDto {
    success: boolean;
    message: string;
}

export interface LogoutAllOthersResponseDto {
    success: boolean;
    message: string;
    devicesLoggedOut: number;
}
