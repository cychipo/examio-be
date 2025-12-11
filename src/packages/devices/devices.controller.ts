import {
    Controller,
    Get,
    Delete,
    Post,
    Param,
    Req,
    UseGuards,
} from '@nestjs/common';
import { DevicesService } from './devices.service';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { Request } from 'express';
import * as cookie from 'cookie';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

interface AuthenticatedRequest extends Request {
    user: { id: string };
}

@ApiTags('Devices')
@Controller('devices')
@UseGuards(AuthGuard)
export class DevicesController {
    constructor(private readonly devicesService: DevicesService) {}

    @Get()
    @ApiOperation({ summary: 'Get list of logged-in devices' })
    @ApiResponse({ status: 200, description: 'List of devices' })
    async getDevices(@Req() req: AuthenticatedRequest) {
        const sessionId = this.extractSessionIdFromCookie(req);
        return this.devicesService.getDevices(req.user.id, sessionId || '');
    }

    @Delete(':sessionId')
    @ApiOperation({ summary: 'Logout a specific device' })
    @ApiResponse({ status: 200, description: 'Device logged out' })
    async logoutDevice(
        @Param('sessionId') sessionId: string,
        @Req() req: AuthenticatedRequest
    ) {
        const currentSessionId = this.extractSessionIdFromCookie(req) || '';
        return this.devicesService.logoutDevice(
            req.user.id,
            sessionId,
            currentSessionId
        );
    }

    @Post('logout-all-others')
    @ApiOperation({ summary: 'Logout all other devices' })
    @ApiResponse({ status: 200, description: 'All other devices logged out' })
    async logoutAllOthers(@Req() req: AuthenticatedRequest) {
        const currentSessionId = this.extractSessionIdFromCookie(req) || '';
        return this.devicesService.logoutAllOthers(
            req.user.id,
            currentSessionId
        );
    }

    private extractSessionIdFromCookie(req: Request): string | undefined {
        const cookieHeader = req.headers.cookie;
        if (cookieHeader) {
            const cookies = cookie.parse(cookieHeader);
            return cookies.session_id;
        }
        return undefined;
    }
}
