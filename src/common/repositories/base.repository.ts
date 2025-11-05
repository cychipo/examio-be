import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/packages/redis/redis.service';
import { EXPIRED_TIME } from 'src/constants/redis';
import {
    PaginationParams,
    PaginationResult,
} from '../interfaces/pagination.interface';

@Injectable()
export abstract class BaseRepository<T> {
    protected abstract modelName: string;
    protected abstract cachePrefix: string; // Prefix cho Redis keys
    protected defaultCacheTTL: EXPIRED_TIME = EXPIRED_TIME.FIVE_MINUTES;

    constructor(
        protected readonly prisma: PrismaService,
        protected readonly redis: RedisService
    ) {}

    protected get model() {
        return (this.prisma as any)[this.modelName];
    }

    /**
     * Generate cache key
     */
    protected getCacheKey(suffix: string): string {
        return `${this.cachePrefix}:${suffix}`;
    }

    /**
     * Invalidate cache by pattern
     */
    protected async invalidateCache(pattern?: string): Promise<void> {
        const key = pattern
            ? this.getCacheKey(pattern)
            : `${this.cachePrefix}:*`;
        await this.redis.del(key);
    }

    /**
     * Tìm tất cả bản ghi với cache
     */
    async findAll(params?: {
        where?: any;
        include?: any;
        select?: any;
        orderBy?: any;
        take?: number;
        skip?: number;
        cache?: boolean;
        cacheTTL?: EXPIRED_TIME;
    }): Promise<T[]> {
        const {
            cache = false,
            cacheTTL = this.defaultCacheTTL,
            ...queryParams
        } = params || {};

        if (cache) {
            const cacheKey = this.getCacheKey(
                `all:${JSON.stringify(queryParams)}`
            );
            const cached = await this.redis.get<T[]>(cacheKey);
            if (cached) return cached;

            const data = await this.model.findMany(queryParams);
            await this.redis.set(cacheKey, data, cacheTTL);
            return data;
        }

        return this.model.findMany(queryParams);
    }

    /**
     * Tìm một bản ghi theo điều kiện với cache
     */
    async findOne(params: {
        where: any;
        include?: any;
        select?: any;
        cache?: boolean;
        cacheTTL?: EXPIRED_TIME;
    }): Promise<T | null> {
        const {
            cache = false,
            cacheTTL = this.defaultCacheTTL,
            ...queryParams
        } = params;

        if (cache) {
            const cacheKey = this.getCacheKey(
                `one:${JSON.stringify(queryParams.where)}`
            );
            const cached = await this.redis.get<T>(cacheKey);
            if (cached) return cached;

            const data = await this.model.findFirst(queryParams);
            if (data) {
                await this.redis.set(cacheKey, data, cacheTTL);
            }
            return data;
        }

        return this.model.findFirst(queryParams);
    }

    /**
     * Tìm bản ghi theo ID với cache
     */
    async findById(
        id: string | number,
        include?: any,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<T | null> {
        if (cache) {
            const cacheKey = this.getCacheKey(`id:${id}`);
            const cached = await this.redis.get<T>(cacheKey);
            if (cached) return cached;

            const data = await this.model.findUnique({
                where: { id },
                include,
            });

            if (data) {
                await this.redis.set(cacheKey, data, cacheTTL);
            }
            return data;
        }

        return this.model.findUnique({
            where: { id },
            include,
        });
    }

    /**
     * Tạo mới một bản ghi
     */
    async create(data: any, userId?: string): Promise<T> {
        const result = await this.model.create({
            data: {
                ...data,
                createdBy: userId,
                updatedBy: userId,
            },
        });

        // Invalidate cache
        await this.invalidateCache();

        return result;
    }

    /**
     * Tạo nhiều bản ghi
     */
    async createMany(data: any[], userId?: string): Promise<{ count: number }> {
        const result = await this.model.createMany({
            data: data.map((item) => ({
                ...item,
                createdBy: userId,
                updatedBy: userId,
            })),
        });

        // Invalidate cache
        await this.invalidateCache();

        return result;
    }

    /**
     * Cập nhật bản ghi theo ID
     */
    async update(id: string | number, data: any, userId?: string): Promise<T> {
        const result = await this.model.update({
            where: { id },
            data: {
                ...data,
                updatedBy: userId,
            },
        });

        // Invalidate specific cache
        await this.redis.del(this.getCacheKey(`id:${id}`));
        await this.invalidateCache();

        return result;
    }

    /**
     * Cập nhật hoặc tạo mới (upsert)
     */
    async upsert(params: {
        where: any;
        create: any;
        update: any;
        userId?: string;
    }): Promise<T> {
        const result = await this.model.upsert({
            where: params.where,
            create: {
                ...params.create,
                createdBy: params.userId,
                updatedBy: params.userId,
            },
            update: {
                ...params.update,
                updatedBy: params.userId,
            },
        });

        // Invalidate cache
        await this.invalidateCache();

        return result;
    }

    /**
     * Cập nhật nhiều bản ghi
     */
    async updateMany(params: {
        where: any;
        data: any;
        userId?: string;
    }): Promise<{ count: number }> {
        const result = await this.model.updateMany({
            where: params.where,
            data: {
                ...params.data,
                updatedBy: params.userId,
            },
        });

        // Invalidate cache
        await this.invalidateCache();

        return result;
    }

    /**
     * Xóa vĩnh viễn (hard delete)
     */
    async delete(id: string | number): Promise<T> {
        const result = await this.model.delete({
            where: { id },
        });

        // Invalidate cache
        await this.redis.del(this.getCacheKey(`id:${id}`));
        await this.invalidateCache();

        return result;
    }

    /**
     * Xóa mềm (soft delete)
     */
    async softDelete(id: string | number, userId?: string): Promise<T> {
        const result = await this.model.update({
            where: { id },
            data: {
                deletedAt: new Date(),
                updatedBy: userId,
            },
        });

        // Invalidate cache
        await this.redis.del(this.getCacheKey(`id:${id}`));
        await this.invalidateCache();

        return result;
    }

    /**
     * Xóa nhiều bản ghi
     */
    async deleteMany(where: any): Promise<{ count: number }> {
        const result = await this.model.deleteMany({ where });

        // Invalidate cache
        await this.invalidateCache();

        return result;
    }

    /**
     * Đếm số lượng bản ghi với cache
     */
    async count(
        where?: any,
        cache = true,
        cacheTTL = this.defaultCacheTTL
    ): Promise<number> {
        if (cache) {
            const cacheKey = this.getCacheKey(
                `count:${JSON.stringify(where || {})}`
            );
            const cached = await this.redis.get<number>(cacheKey);
            if (cached !== null) return cached;

            const count = await this.model.count({ where });
            await this.redis.set(cacheKey, count, cacheTTL);
            return count;
        }

        return this.model.count({ where });
    }

    /**
     * Phân trang với tìm kiếm và lọc - có cache
     */
    async paginate(
        params: PaginationParams & { cache?: boolean; cacheTTL?: EXPIRED_TIME }
    ): Promise<PaginationResult<T>> {
        const {
            page = 1,
            size = 10,
            sortBy = 'createdAt',
            sortType = 'desc',
            dateFrom,
            dateTo,
            searchBy = [],
            text,
            cache = false,
            cacheTTL = this.defaultCacheTTL,
            ...filters
        } = params;

        const where: any = {
            ...filters,
        };

        // Xử lý tìm kiếm
        if (text && searchBy.length > 0) {
            where.OR = searchBy.map((field) => ({
                [field]: {
                    contains: text,
                    mode: 'insensitive',
                },
            }));
        }

        // Xử lý lọc theo ngày
        if (dateFrom || dateTo) {
            where.createdAt = {
                ...(dateFrom && { gte: new Date(dateFrom) }),
                ...(dateTo && { lte: new Date(dateTo) }),
            };
        }

        if (cache) {
            const cacheKey = this.getCacheKey(
                `paginate:${page}:${size}:${JSON.stringify(where)}`
            );
            const cached = await this.redis.get<PaginationResult<T>>(cacheKey);
            if (cached) return cached;
        }

        const [data, total] = await Promise.all([
            this.model.findMany({
                where,
                orderBy: { [sortBy]: sortType },
                skip: (page - 1) * size,
                take: size,
            }),
            this.model.count({ where }),
        ]);

        const result = {
            data,
            total,
            page,
            size,
            totalPages: Math.ceil(total / size),
        };

        if (cache) {
            const cacheKey = this.getCacheKey(
                `paginate:${page}:${size}:${JSON.stringify(where)}`
            );
            await this.redis.set(cacheKey, result, cacheTTL);
        }

        return result;
    }

    /**
     * Transaction wrapper
     */
    async withTransaction<R>(fn: (tx: any) => Promise<R>): Promise<R> {
        return this.prisma.$transaction(fn);
    }

    /**
     * Aggregate operations
     */
    async aggregate(params: any) {
        return this.model.aggregate(params);
    }

    /**
     * Group by operations
     */
    async groupBy(params: any) {
        return this.model.groupBy(params);
    }
}
