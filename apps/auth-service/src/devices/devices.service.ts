import {
    Injectable,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { UserSessionRepository } from './repositories/user-session.repository';
import { DeviceDto, GetDevicesResponseDto } from './dto';
import { formatDistanceToNow, format } from 'date-fns';
import { vi } from 'date-fns/locale';

@Injectable()
export class DevicesService {
    constructor(
        private readonly userSessionRepository: UserSessionRepository
    ) {}

    async getDevices(
        userId: string,
        currentSessionId: string
    ): Promise<GetDevicesResponseDto> {
        console.log(
            '[DevicesService] getDevices - currentSessionId:',
            currentSessionId
        );

        const sessions =
            await this.userSessionRepository.findActiveSessionsByUserId(userId);

        console.log('[DevicesService] Found sessions:', sessions.length);
        sessions.forEach((s, idx) => {
            console.log(`[DevicesService] Session ${idx}:`, {
                id: s.id,
                sessionId: s.sessionId,
                isCurrent: s.sessionId === currentSessionId,
            });
        });

        const devices: DeviceDto[] = sessions.map((session) => ({
            id: session.id,
            deviceId: session.deviceId,
            deviceName: session.deviceName,
            browser: session.browser,
            os: session.os,
            location: this.formatLocation(session.city, session.country),
            ipAddress: session.ipAddress,
            lastActivity: this.formatTimeAgo(session.lastActivity),
            loginTime: format(session.createdAt, 'yyyy-MM-dd HH:mm'),
            isCurrent: session.sessionId === currentSessionId,
        }));

        return { devices };
    }

    async logoutDevice(
        userId: string,
        sessionId: string,
        currentSessionId: string
    ): Promise<{ success: boolean; message: string }> {
        // Find session by ID (the session record id, not sessionId)
        const session = await this.userSessionRepository.findById(sessionId);

        if (!session) {
            throw new NotFoundException('Không tìm thấy phiên đăng nhập');
        }

        // Check ownership
        if (session.userId !== userId) {
            throw new ForbiddenException(
                'Bạn không có quyền logout thiết bị này'
            );
        }

        // Check not logout self
        if (session.sessionId === currentSessionId) {
            throw new BadRequestException(
                'Không thể logout thiết bị hiện tại. Hãy sử dụng chức năng đăng xuất thông thường.'
            );
        }

        await this.userSessionRepository.deactivateSession(session.id);

        return {
            success: true,
            message: 'Đã logout khỏi thiết bị thành công',
        };
    }

    async logoutAllOthers(
        userId: string,
        currentSessionId: string
    ): Promise<{
        success: boolean;
        message: string;
        devicesLoggedOut: number;
    }> {
        const count =
            await this.userSessionRepository.deactivateAllOtherSessions(
                userId,
                currentSessionId
            );

        return {
            success: true,
            message: `Đã logout ${count} thiết bị`,
            devicesLoggedOut: count,
        };
    }

    private formatLocation(
        city: string | null,
        country: string | null
    ): string {
        if (city && country) {
            return `${city}, ${country}`;
        }
        if (country) {
            return country;
        }
        return 'Không xác định';
    }

    private formatTimeAgo(date: Date): string {
        return formatDistanceToNow(date, { addSuffix: true, locale: vi });
    }
}
