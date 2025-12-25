import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '@examio/database';
import { RedisService, EXPIRED_TIME } from '@examio/redis';

@Injectable()
export class UserRepository {
    protected modelName = 'user';
    protected cachePrefix = 'user';
    protected defaultCacheTTL = EXPIRED_TIME.FIVE_MINUTES;

    constructor(
        private readonly prisma: PrismaService,
        private readonly redis: RedisService
    ) {}

    private get model() {
        return this.prisma.user;
    }

    private getCacheKey(suffix: string): string {
        return `${this.cachePrefix}:${suffix}`;
    }

    /**
     * Tìm user theo email với cache
     */
    async findByEmail(
        email: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<User | null> {
        const normalizedEmail = email.toLowerCase();
        const cacheKey = this.getCacheKey(`email:${normalizedEmail}`);

        if (cache) {
            const cached = await this.redis.get<User>(cacheKey);
            if (cached) return cached;

            const user = await this.model.findUnique({
                where: { email: normalizedEmail },
            });

            if (user) {
                await this.redis.set(cacheKey, user, cacheTTL);
            }
            return user;
        }

        return this.model.findUnique({
            where: { email: normalizedEmail },
        });
    }

    /**
     * Tìm user theo username với cache
     */
    async findByUsername(
        username: string,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<User | null> {
        const normalizedUsername = username.toLowerCase();
        const cacheKey = this.getCacheKey(`username:${normalizedUsername}`);

        if (cache) {
            const cached = await this.redis.get<User>(cacheKey);
            if (cached) return cached;

            const user = await this.model.findUnique({
                where: { username: normalizedUsername },
            });

            if (user) {
                await this.redis.set(cacheKey, user, cacheTTL);
            }
            return user;
        }

        return this.model.findUnique({
            where: { username: normalizedUsername },
        });
    }

    /**
     * Tìm user theo email hoặc username (cho login)
     */
    async findByCredential(credential: string): Promise<User | null> {
        return this.model.findFirst({
            where: {
                OR: [
                    { email: credential.toLowerCase() },
                    { username: credential.toLowerCase() },
                ],
            },
            include: {
                wallet: {
                    select: {
                        balance: true,
                    },
                },
                subscription: true,
            },
        });
    }

    /**
     * Tìm user theo ID với relations
     */
    async findByIdWithRelations(
        id: string,
        relations: string[] = [],
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<User | null> {
        const include: any = {};
        relations.forEach((rel) => {
            if (rel === 'wallet') {
                include.wallet = { select: { balance: true } };
            } else {
                include[rel] = true;
            }
        });

        const relationKey =
            relations.length > 0
                ? `:relations:${relations.sort().join(',')}`
                : '';
        const cacheKey = this.getCacheKey(`id:${id}${relationKey}`);

        if (cache) {
            const cached = await this.redis.get<User>(cacheKey);
            if (cached) return cached;

            const user = await this.model.findUnique({
                where: { id },
                include,
            });

            if (user) {
                await this.redis.set(cacheKey, user, cacheTTL);
            }
            return user;
        }

        return this.model.findUnique({
            where: { id },
            include,
        });
    }

    /**
     * Create user
     */
    async create(data: any): Promise<User> {
        const user = await this.model.create({ data });
        return user;
    }

    /**
     * Update user và invalidate cache
     */
    async update(id: string, data: any, userId?: string): Promise<User> {
        const result = await this.model.update({
            where: { id },
            data,
        });

        // Invalidate caches
        await this.redis.delPattern(`${this.cachePrefix}:*${id}*`);
        await this.redis.del(
            this.getCacheKey(`email:${result.email.toLowerCase()}`)
        );
        await this.redis.del(
            this.getCacheKey(`username:${result.username.toLowerCase()}`)
        );

        return result;
    }

    /**
     * Check email exists
     */
    async emailExists(email: string): Promise<boolean> {
        const user = await this.findByEmail(email, true);
        return !!user;
    }

    /**
     * Check username exists
     */
    async usernameExists(username: string): Promise<boolean> {
        const user = await this.findByUsername(username, true);
        return !!user;
    }
}
