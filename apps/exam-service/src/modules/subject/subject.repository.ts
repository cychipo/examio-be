import { Injectable } from '@nestjs/common';
import { PrismaService } from '@examio/database';

@Injectable()
export class SubjectRepository {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * Get all subject categories with their subjects
     */
    async getCategoriesWithSubjects() {
        return this.prisma.subjectCategory.findMany({
            where: { isActive: true },
            orderBy: { order: 'asc' },
            include: {
                subjects: {
                    where: { isActive: true },
                    orderBy: { order: 'asc' },
                    select: {
                        id: true,
                        categoryId: true,
                        name: true,
                        slug: true,
                        description: true,
                        icon: true,
                        color: true,
                        order: true,
                        isActive: true,
                        createdAt: true,
                        updatedAt: true,
                    },
                },
            },
        });
    }

    /**
     * Get all subjects (flat list)
     */
    async getAllSubjects() {
        return this.prisma.subject.findMany({
            where: { isActive: true },
            orderBy: [{ category: { order: 'asc' } }, { order: 'asc' }],
            include: {
                category: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        icon: true,
                        color: true,
                    },
                },
            },
        });
    }

    /**
     * Get a subject by ID
     */
    async getSubjectById(id: string) {
        return this.prisma.subject.findUnique({
            where: { id },
            include: {
                category: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        icon: true,
                        color: true,
                    },
                },
            },
        });
    }

    /**
     * Get a subject by slug
     */
    async getSubjectBySlug(slug: string) {
        return this.prisma.subject.findUnique({
            where: { slug },
            include: {
                category: {
                    select: {
                        id: true,
                        name: true,
                        slug: true,
                        icon: true,
                        color: true,
                    },
                },
            },
        });
    }

    /**
     * Get subject's system prompt by ID
     */
    async getSubjectSystemPrompt(id: string) {
        const subject = await this.prisma.subject.findUnique({
            where: { id },
            select: {
                id: true,
                name: true,
                systemPrompt: true,
            },
        });
        return subject;
    }
}
