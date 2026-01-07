import { Injectable, NotFoundException } from '@nestjs/common';
import { SubjectRepository } from './subject.repository';

@Injectable()
export class SubjectService {
    constructor(private readonly subjectRepository: SubjectRepository) {}

    /**
     * Get all subject categories with their subjects
     */
    async getCategories() {
        const categories =
            await this.subjectRepository.getCategoriesWithSubjects();
        return { categories };
    }

    /**
     * Get all subjects (flat list)
     */
    async getSubjects() {
        const subjects = await this.subjectRepository.getAllSubjects();
        return { subjects };
    }

    /**
     * Get a subject by ID
     */
    async getSubjectById(id: string) {
        const subject = await this.subjectRepository.getSubjectById(id);
        if (!subject) {
            throw new NotFoundException('Không tìm thấy môn học');
        }
        return { subject };
    }

    /**
     * Get a subject by slug
     */
    async getSubjectBySlug(slug: string) {
        const subject = await this.subjectRepository.getSubjectBySlug(slug);
        if (!subject) {
            throw new NotFoundException('Không tìm thấy môn học');
        }
        return { subject };
    }

    /**
     * Get subject's system prompt by ID
     */
    async getSubjectSystemPrompt(id: string) {
        const subject = await this.subjectRepository.getSubjectSystemPrompt(id);
        if (!subject) {
            throw new NotFoundException('Không tìm thấy môn học');
        }
        return subject.systemPrompt;
    }
}
