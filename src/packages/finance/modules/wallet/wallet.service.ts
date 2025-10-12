import { PrismaService } from 'src/prisma/prisma.service';
import {
    Injectable,
    ConflictException,
    NotFoundException,
    ForbiddenException,
    InternalServerErrorException,
} from '@nestjs/common';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { User } from '@prisma/client';

@Injectable()
export class WalletService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly generateIdService: GenerateIdService
    ) {}

    async createWallet(user: User) {
        const existingWallet = await this.prisma.wallet.findUnique({
            where: { userId: user.id },
        });
        if (existingWallet) {
            throw new ConflictException('Người dùng đã có ví rồi');
        }

        const wallet = await this.prisma.wallet.create({
            data: {
                id: this.generateIdService.generateId(),
                userId: user.id,
                balance: 20,
            },
        });
        return wallet;
    }

    async getWallet(user: User) {
        const wallet = await this.prisma.wallet.findUnique({
            where: { userId: user.id },
        });
        if (!wallet) {
            throw new NotFoundException('Không tìm thấy ví của người dùng này');
        }
        return wallet;
    }

    async deposit(user: User, amount: number) {
        if (amount <= 0) {
            throw new ForbiddenException('Số tiền nạp phải là số dương');
        }

        const wallet = await this.getWallet(user);
        try {
            const updatedWallet = await this.prisma.wallet.update({
                where: { id: wallet.id },
                data: { balance: { increment: amount } },
            });
            return updatedWallet;
        } catch (error) {
            throw new InternalServerErrorException('Không thể nạp tiền vào ví');
        }
    }

    async deduct(user: User, amount: number) {
        if (amount <= 0) {
            throw new ForbiddenException('Số tiền trừ phải là số dương');
        }

        const wallet = await this.getWallet(user);
        if (wallet.balance < amount) {
            throw new ForbiddenException('Số dư trong ví không đủ');
        }

        try {
            const updatedWallet = await this.prisma.wallet.update({
                where: { id: wallet.id },
                data: { balance: { decrement: amount } },
            });
            return updatedWallet;
        } catch (error) {
            throw new InternalServerErrorException('Không thể trừ tiền từ ví');
        }
    }
}
