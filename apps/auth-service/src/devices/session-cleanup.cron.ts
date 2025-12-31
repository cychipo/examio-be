import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import * as cron from 'node-cron';
import { UserSessionRepository } from './repositories/user-session.repository';

@Injectable()
export class SessionCleanupCron implements OnModuleInit, OnModuleDestroy {
    private cronTask: cron.ScheduledTask | null = null;

    constructor(
        private readonly userSessionRepository: UserSessionRepository
    ) {}

    onModuleInit() {
        // Run every day at 3:00 AM
        this.cronTask = cron.schedule('0 3 * * *', async () => {
            console.log('[SessionCleanupCron] Starting session cleanup...');
            await this.cleanupSessions();
        });

        console.log('[SessionCleanupCron] Cron job scheduled: Every day at 3:00 AM');
    }

    onModuleDestroy() {
        if (this.cronTask) {
            this.cronTask.stop();
            console.log('[SessionCleanupCron] Cron job stopped');
        }
    }

    async cleanupSessions(): Promise<void> {
        try {
            // 1. Delete expired sessions
            const expiredCount =
                await this.userSessionRepository.deleteExpiredSessions();
            console.log(`[SessionCleanupCron] Deleted ${expiredCount} expired sessions`);

            // 2. Deactivate sessions inactive for 30 days
            const inactiveCount =
                await this.userSessionRepository.deactivateInactiveSessions(30);
            console.log(`[SessionCleanupCron] Deactivated ${inactiveCount} inactive sessions`);

            // 3. Delete sessions older than 90 days
            const oldCount =
                await this.userSessionRepository.deleteOldSessions(90);
            console.log(`[SessionCleanupCron] Deleted ${oldCount} old sessions`);

            console.log('[SessionCleanupCron] Session cleanup completed');
        } catch (error) {
            console.error('[SessionCleanupCron] Error during cleanup:', error);
        }
    }
}
