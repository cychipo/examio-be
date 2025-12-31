import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
    private readonly logger = new Logger('HTTP');

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const request = context.switchToHttp().getRequest();
        const response = context.switchToHttp().getResponse();
        const { method, url, body, query, params, ip, headers } = request;
        const userAgent = headers['user-agent'] || 'Unknown';
        const user = request.user; // Nếu có authentication

        const startTime = Date.now();

        // Log incoming request
        this.logger.log(
            `📥 Incoming Request | ${method} ${url} | IP: ${ip} | User-Agent: ${userAgent}${user ? ` | User: ${user.email || user.id}` : ''}`
        );

        // Log chi tiết request
        if (Object.keys(query).length > 0) {
            this.logger.debug(`Query Params: ${JSON.stringify(query)}`);
        }
        if (Object.keys(params).length > 0) {
            this.logger.debug(`Path Params: ${JSON.stringify(params)}`);
        }
        if (body && Object.keys(body).length > 0) {
            // Ẩn sensitive data như password
            const sanitizedBody = this.sanitizeBody(body);
            this.logger.debug(`Body: ${JSON.stringify(sanitizedBody)}`);
        }

        return next.handle().pipe(
            tap({
                next: (data) => {
                    const responseTime = Date.now() - startTime;
                    const statusCode = response.statusCode;

                    // Log response thành công
                    this.logger.log(
                        `📤 Response | ${method} ${url} | Status: ${statusCode} | Time: ${responseTime}ms`
                    );

                    // Log response data (có thể comment nếu không muốn log)
                    if (process.env.NODE_ENV === 'development') {
                        this.logger.debug(
                            `Response Data: ${JSON.stringify(data).substring(0, 200)}${JSON.stringify(data).length > 200 ? '...' : ''}`
                        );
                    }
                },
                error: (error) => {
                    const responseTime = Date.now() - startTime;
                    const statusCode = error.status || 500;

                    // Log error
                    this.logger.error(
                        `❌ Error | ${method} ${url} | Status: ${statusCode} | Time: ${responseTime}ms | Error: ${error.message}`
                    );
                },
            })
        );
    }

    /**
     * Ẩn các thông tin nhạy cảm trong request body
     */
    private sanitizeBody(body: any): any {
        const sensitiveFields = [
            'password',
            'confirmPassword',
            'token',
            'accessToken',
            'refreshToken',
            'secret',
            'apiKey',
        ];

        if (typeof body !== 'object' || body === null) {
            return body;
        }

        const sanitized = { ...body };

        for (const field of sensitiveFields) {
            if (field in sanitized) {
                sanitized[field] = '***HIDDEN***';
            }
        }

        return sanitized;
    }
}
