export interface DeviceDto {
    id: string;
    deviceId: string;
    deviceName: string | null;
    browser: string | null;
    os: string | null;
    location: string;
    ipAddress: string | null;
    lastActivity: string;
    loginTime: string;
    isCurrent: boolean;
}

export interface GetDevicesResponseDto {
    devices: DeviceDto[];
}
