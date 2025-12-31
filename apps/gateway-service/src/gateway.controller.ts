import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Gateway')
@Controller()
export class GatewayController {
    @Get('health')
    @ApiOperation({ summary: 'Health check endpoint' })
    @ApiResponse({ status: 200, description: 'Service is healthy' })
    healthCheck() {
        return {
            status: 'ok',
            service: 'gateway',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
        };
    }

    @Get('status')
    @ApiOperation({ summary: 'Get all services status' })
    @ApiResponse({ status: 200, description: 'Services status' })
    async getStatus() {
        return {
            gateway: 'running',
            services: {
                auth: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
                exam: process.env.EXAM_SERVICE_URL || 'http://localhost:3002',
                finance:
                    process.env.FINANCE_SERVICE_URL || 'http://localhost:3003',
            },
            timestamp: new Date().toISOString(),
        };
    }
}
