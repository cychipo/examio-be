import { Injectable } from '@nestjs/common';
import { BaseRepository } from 'src/common/repositories/base.repository';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/packages/redis/redis.service';
import { User } from '@prisma/client';
import { EXPIRED_TIME } from 'src/constants/redis';

@Injectable()
export class UserRepository extends BaseRepository<User> {
    protected modelName = 'user';
    protected cachePrefix = 'user';
    protected defaultCacheTTL = EXPIRED_TIME.FIVE_MINUTES;

    constructor(prisma: PrismaService, redis: RedisService) {
        super(prisma, redis);
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
        const cacheKey = `${this.cachePrefix}:email:${normalizedEmail}`;

        if (cache) {
            const cached = await this.redis.get<User>(cacheKey);
            if (cached) return cached;

            const user = await this.model.findUnique({
                where: { email: normalizedEmail },
            });

            if (user) {
                await this.redis.set(cacheKey, user, cacheTTL);
                // Also cache by user ID for future lookups
                await this.redis.set(
                    this.getUserScopedCacheKey(user.id),
                    user,
                    cacheTTL
                );
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
        const cacheKey = `${this.cachePrefix}:username:${normalizedUsername}`;

        if (cache) {
            const cached = await this.redis.get<User>(cacheKey);
            if (cached) return cached;

            const user = await this.model.findUnique({
                where: { username: normalizedUsername },
            });

            if (user) {
                await this.redis.set(cacheKey, user, cacheTTL);
                // Also cache by user ID for future lookups
                await this.redis.set(
                    this.getUserScopedCacheKey(user.id),
                    user,
                    cacheTTL
                );
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
    async findByCredential(
        credential: string,
        cache = false // Không cache cho login để đảm bảo thông tin mới nhất
    ): Promise<User | null> {
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
        const cacheKey = this.getUserScopedCacheKey(id) + relationKey;

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
     * Update user và invalidate các cache liên quan
     */
    async updateUser(id: string, data: any, userId?: string): Promise<User> {
        // BaseRepository.update() handles user-scoped cache invalidation
        const result = await this.update(id, data, userId || id);

        // Invalidate ALL user cache variants using pattern match
        // This clears user:user:{userId}:* including :relations:wallet, etc.
        await this.invalidateUserCache(id);

        // Also invalidate email and username lookup caches (special case for User)
        await this.redis.del(
            `${this.cachePrefix}:email:${result.email.toLowerCase()}`
        );
        await this.redis.del(
            `${this.cachePrefix}:username:${result.username.toLowerCase()}`
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
