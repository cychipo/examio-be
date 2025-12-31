import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class ProxyMiddleware implements NestMiddleware {
    private readonly logger = new Logger(ProxyMiddleware.name);

    use(req: Request, res: Response, next: NextFunction) {
        const startTime = Date.now();

        // Log incoming request
        this.logger.log(`→ ${req.method} ${req.originalUrl}`);

        // Add response listener
        res.on('finish', () => {
            const duration = Date.now() - startTime;
            this.logger.log(
                `← ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
            );
        });

        next();
    }
}
