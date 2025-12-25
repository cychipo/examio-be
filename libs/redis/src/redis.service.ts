import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { redisConfig } from './redis.config';
import { EXPIRED_TIME } from './constants';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private client: Redis;

    onModuleInit() {
        this.client = new Redis({
            host: redisConfig.host,
            port: redisConfig.port,
            password: redisConfig.password,
        });

        this.client.on('connect', () => console.log('[Redis] Connected'));
        this.client.on('error', (err) => console.error('[Redis] Error:', err));
    }

    onModuleDestroy() {
        this.client.quit();
    }

    /** Lưu giá trị (với TTL optional) */
    async set(
        key: string,
        value: any,
        ttlSeconds?: EXPIRED_TIME
    ): Promise<void> {
        const data = JSON.stringify(value);
        if (ttlSeconds) {
            await this.client.set(key, data, 'EX', ttlSeconds);
        } else {
            await this.client.set(key, data);
        }
    }

    /** Lấy giá trị */
    async get<T = any>(key: string): Promise<T | null> {
        const data = await this.client.get(key);
        return data ? JSON.parse(data) : null;
    }

    /** Xóa key */
    async del(key: string): Promise<void> {
        await this.client.del(key);
    }

    /** Xóa tất cả keys theo pattern - Sử dụng SCAN để tránh block Redis */
    async delPattern(pattern: string): Promise<void> {
        const keys: string[] = [];
        let cursor = '0';

        do {
            const [newCursor, foundKeys] = await this.client.scan(
                cursor,
                'MATCH',
                pattern,
                'COUNT',
                100
            );
            cursor = newCursor;
            keys.push(...foundKeys);
        } while (cursor !== '0');

        console.log(
            `[Redis] Deleting ${keys.length} keys matching pattern: ${pattern}`
        );

        if (keys.length > 0) {
            const batchSize = 100;
            for (let i = 0; i < keys.length; i += batchSize) {
                const batch = keys.slice(i, i + batchSize);
                await this.client.del(...batch);
            }
            console.log(`[Redis] Successfully deleted ${keys.length} keys`);
        }
    }

    /** Kiểm tra key có tồn tại không */
    async exists(key: string): Promise<boolean> {
        return (await this.client.exists(key)) === 1;
    }

    /** Dành cho các use case Pub/Sub */
    getClient(): Redis {
        return this.client;
    }
}
