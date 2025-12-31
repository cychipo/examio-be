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

    // ==================== Pub/Sub Methods ====================

    private subscriber: Redis | null = null;
    private subscriptions: Map<string, ((message: string) => void)[]> =
        new Map();

    /** Lấy hoặc tạo subscriber client */
    private getSubscriber(): Redis {
        if (!this.subscriber) {
            this.subscriber = new Redis({
                host: redisConfig.host,
                port: redisConfig.port,
                password: redisConfig.password,
            });

            this.subscriber.on(
                'message',
                (channel: string, message: string) => {
                    const handlers = this.subscriptions.get(channel) || [];
                    handlers.forEach((handler) => handler(message));
                }
            );
        }
        return this.subscriber;
    }

    /** Publish message tới channel */
    async publish(channel: string, message: string): Promise<number> {
        return this.client.publish(channel, message);
    }

    /** Subscribe tới channel */
    async subscribe(
        channel: string,
        handler: (message: string) => void
    ): Promise<void> {
        const subscriber = this.getSubscriber();

        // Lưu handler
        const handlers = this.subscriptions.get(channel) || [];
        handlers.push(handler);
        this.subscriptions.set(channel, handlers);

        // Subscribe nếu là channel mới
        if (handlers.length === 1) {
            await subscriber.subscribe(channel);
            console.log(`[Redis] Subscribed to channel: ${channel}`);
        }
    }

    /** Unsubscribe khỏi channel */
    async unsubscribe(channel: string): Promise<void> {
        if (this.subscriber && this.subscriptions.has(channel)) {
            await this.subscriber.unsubscribe(channel);
            this.subscriptions.delete(channel);
            console.log(`[Redis] Unsubscribed from channel: ${channel}`);
        }
    }

    /** Dành cho các use case khác */
    getClient(): Redis {
        return this.client;
    }
}
