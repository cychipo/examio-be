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
        if (cache) {
            const cacheKey = this.getCacheKey(`email:${email.toLowerCase()}`);
            const cached = await this.redis.get<User>(cacheKey);
            if (cached) return cached;

            const user = await this.model.findUnique({
                where: { email: email.toLowerCase() },
            });

            if (user) {
                await this.redis.set(cacheKey, user, cacheTTL);
            }
            return user;
        }

        return this.model.findUnique({
            where: { email: email.toLowerCase() },
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
        if (cache) {
            const cacheKey = this.getCacheKey(
                `username:${username.toLowerCase()}`
            );
            const cached = await this.redis.get<User>(cacheKey);
            if (cached) return cached;

            const user = await this.model.findUnique({
                where: { username: username.toLowerCase() },
            });

            if (user) {
                await this.redis.set(cacheKey, user, cacheTTL);
            }
            return user;
        }

        return this.model.findUnique({
            where: { username: username.toLowerCase() },
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

        if (cache) {
            const cacheKey = this.getCacheKey(
                `id:${id}:relations:${relations.join(',')}`
            );
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
        const result = await this.update(id, data, userId);

        // Invalidate specific caches
        await this.redis.del(this.getCacheKey(`id:${id}`));
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
