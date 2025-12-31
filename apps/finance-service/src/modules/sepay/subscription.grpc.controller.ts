import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { SubscriptionService } from './subscription.service';

@Controller()
export class SubscriptionGrpcController {
    constructor(private readonly subscriptionService: SubscriptionService) {}

    @GrpcMethod('SubscriptionService', 'GetUserBenefits')
    async getUserBenefits(data: { userId: string }) {
        const benefits =
            await this.subscriptionService.getUserSubscriptionBenefits(
                data.userId
            );

        // Map benefits back to tier ID for proto
        let tier = 0;
        if (benefits.name === 'Basic') tier = 1;
        if (benefits.name === 'Advanced') tier = 2;
        if (benefits.name === 'VIP') tier = 3;

        return {
            tier,
            tier_name: benefits.nameVi,
            files_per_month: benefits.filesPerMonth,
            messages_per_minute: benefits.messagesPerMinute,
            chat_messages_limit: benefits.chatMessagesLimit,
        };
    }
}
