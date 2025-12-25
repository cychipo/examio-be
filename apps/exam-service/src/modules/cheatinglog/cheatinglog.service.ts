import {
    Injectable,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { CheatingLogRepository } from './cheatinglog.repository';
import {
    CreateCheatingLogDto,
    CHEATING_TYPE,
} from './dto/create-cheatinglog.dto';
import { PrismaService } from '@examio/database';
import { User } from '@prisma/client';
import { EXAM_ATTEMPT_STATUS } from '../../types';

@Injectable()
export class CheatingLogService {
    constructor(
        private readonly cheatingLogRepository: CheatingLogRepository,
        private readonly prisma: PrismaService
    ) {}

    /**
     * Log a cheating violation - upsert to increment count
     * Also updates violationCount on ExamAttempt
     */
    async logViolation(user: User, dto: CreateCheatingLogDto) {
        // Verify the attempt exists and belongs to the user
        const attempt = await this.prisma.examAttempt.findUnique({
            where: { id: dto.examAttemptId },
            select: { id: true, userId: true, status: true },
        });

        if (!attempt) {
            throw new NotFoundException('Exam attempt not found');
        }

        if (attempt.userId !== user.id) {
            throw new ForbiddenException(
                'You can only log violations for your own attempts'
            );
        }

        // Only log for in-progress attempts
        if (attempt.status !== EXAM_ATTEMPT_STATUS.IN_PROGRESS) {
            return { logged: false, message: 'Attempt is not in progress' };
        }

        // Upsert the cheating log
        const log = await this.cheatingLogRepository.upsertCheatingLog(
            dto.examAttemptId,
            dto.type
        );

        // Update violation count on attempt - get total count
        const totalCount =
            await this.cheatingLogRepository.getTotalViolationCount(
                dto.examAttemptId
            );

        await this.prisma.examAttempt.update({
            where: { id: dto.examAttemptId },
            data: { violationCount: totalCount },
        });

        return {
            logged: true,
            type: log.type,
            count: log.count,
            totalViolations: totalCount,
        };
    }

    /**
     * Get cheating logs for an attempt (owner only)
     */
    async getAttemptLogs(attemptId: string, user: User) {
        // Check if user is the owner of the exam session
        const attempt = await this.prisma.examAttempt.findUnique({
            where: { id: attemptId },
            include: {
                examSession: {
                    include: {
                        examRoom: {
                            select: { hostId: true },
                        },
                    },
                },
            },
        });

        if (!attempt) {
            throw new NotFoundException('Exam attempt not found');
        }

        // Only the host can see detailed logs
        if (attempt.examSession.examRoom.hostId !== user.id) {
            throw new ForbiddenException(
                'Only the exam host can view cheating details'
            );
        }

        return this.cheatingLogRepository.getByAttemptId(attemptId);
    }

    /**
     * Get session-wide cheating stats (owner only)
     */
    async getSessionStats(sessionId: string, user: User) {
        // Verify user is the host
        const session = await this.prisma.examSession.findUnique({
            where: { id: sessionId },
            include: {
                examRoom: {
                    select: { hostId: true },
                },
            },
        });

        if (!session) {
            throw new NotFoundException('Exam session not found');
        }

        if (session.examRoom.hostId !== user.id) {
            throw new ForbiddenException(
                'Only the exam host can view session stats'
            );
        }

        return this.cheatingLogRepository.getSessionStats(sessionId);
    }

    /**
     * Get all attempts for a user in a session with their cheating logs
     * Single optimized query - for host only
     */
    async getUserAttemptsWithLogs(
        sessionId: string,
        userId: string,
        requestingUser: User
    ) {
        // Verify user is the host
        const session = await this.prisma.examSession.findUnique({
            where: { id: sessionId },
            include: {
                examRoom: {
                    select: { hostId: true },
                },
            },
        });

        if (!session) {
            throw new NotFoundException('Exam session not found');
        }

        if (session.examRoom.hostId !== requestingUser.id) {
            throw new ForbiddenException(
                'Only the exam host can view user attempt details'
            );
        }

        return this.cheatingLogRepository.getUserAttemptsWithLogs(
            sessionId,
            userId
        );
    }
}
