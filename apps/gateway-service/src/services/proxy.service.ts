import { Injectable, HttpException, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AxiosRequestConfig, AxiosResponse } from 'axios';
import { Request } from 'express';

export interface ProxyRequest {
    method: string;
    path: string;
    body?: any;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    cookies?: Record<string, string>;
}

@Injectable()
export class ProxyService {
    private readonly logger = new Logger(ProxyService.name);

    private readonly serviceUrls = {
        auth: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
        exam: process.env.EXAM_SERVICE_URL || 'http://localhost:3002',
        finance: process.env.FINANCE_SERVICE_URL || 'http://localhost:3003',
    };

    constructor(private readonly httpService: HttpService) {}

    /**
     * Forward request tới target service
     */
    async forward(
        service: 'auth' | 'exam' | 'finance',
        request: ProxyRequest
    ): Promise<any> {
        const baseUrl = this.serviceUrls[service];
        const url = `${baseUrl}${request.path}`;

        // Debug logging for cookies
        if (request.cookies) {
            this.logger.debug(
                `Forwarding cookies: ${JSON.stringify(request.cookies)}`
            );
        }

        const config: AxiosRequestConfig = {
            method: request.method as any,
            url,
            headers: {
                ...request.headers,
                'Content-Type': 'application/json',
                ...(request.cookies && {
                    Cookie: Object.entries(request.cookies)
                        .map(([key, value]) => `${key}=${value}`)
                        .join('; '),
                }),
            },
            params: request.query,
        };

        if (request.body && ['POST', 'PUT', 'PATCH'].includes(request.method)) {
            config.data = request.body;
        }

        try {
            this.logger.debug(`Forwarding ${request.method} ${url}`);
            const response: AxiosResponse = await firstValueFrom(
                this.httpService.request(config)
            );
            return response.data;
        } catch (error) {
            if (error.response) {
                throw new HttpException(
                    error.response.data,
                    error.response.status
                );
            }
            this.logger.error(`Proxy error: ${error.message}`);
            throw new HttpException('Service unavailable', 503);
        }
    }

    /**
     * Forward với JWT token
     */
    async forwardWithAuth(
        service: 'auth' | 'exam' | 'finance',
        request: ProxyRequest,
        token: string
    ): Promise<any> {
        return this.forward(service, {
            ...request,
            headers: {
                ...request.headers,
                Authorization: `Bearer ${token}`,
            },
        });
    }

    /**
     * Forward raw request (for multipart/form-data)
     * This bypasses body parsing and forwards the request as-is
     */
    async forwardRaw(
        service: 'auth' | 'exam' | 'finance',
        req: Request,
        path: string
    ): Promise<any> {
        const baseUrl = this.serviceUrls[service];
        const url = `${baseUrl}${path}`;

        // Extract token from request
        const token =
            req.headers.authorization?.replace('Bearer ', '') ||
            req.cookies?.token ||
            req.cookies?.accessToken ||
            '';

        // Forward all headers except host
        const headers = { ...req.headers };
        delete headers.host;
        delete headers['content-length']; // Let axios recalculate

        // Add authorization
        if (token) {
            headers.authorization = `Bearer ${token}`;
        }

        const config: AxiosRequestConfig = {
            method: req.method as any,
            url,
            headers,
            params: req.query,
            data: req.body,
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
        };

        try {
            this.logger.debug(`Forwarding RAW ${req.method} ${url}`);
            const response: AxiosResponse = await firstValueFrom(
                this.httpService.request(config)
            );
            return response.data;
        } catch (error) {
            if (error.response) {
                throw new HttpException(
                    error.response.data,
                    error.response.status
                );
            }
            this.logger.error(`Proxy error: ${error.message}`);
            throw new HttpException('Service unavailable', 503);
        }
    }
}
