import {
    Injectable,
    ConflictException,
    NotFoundException,
    ForbiddenException,
} from '@nestjs/common';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { User } from '@prisma/client';
import { WalletRepository } from './wallet.repository';

@Injectable()
export class WalletService {
    constructor(
        private readonly walletRepository: WalletRepository,
        private readonly generateIdService: GenerateIdService
    ) {}

    async createWallet(user: User) {
        // Check if wallet already exists
        const existingWallet = await this.walletRepository.findByUserId(
            user.id,
            true
        );

        if (existingWallet) {
            throw new ConflictException('Người dùng đã có ví rồi');
        }

        // Create wallet using repository
        return this.walletRepository.createForUser(
            user.id,
            20,
            this.generateIdService.generateId()
        );
    }

    async getWallet(user: User) {
        const wallet = await this.walletRepository.findByUserId(user.id, true);

        if (!wallet) {
            throw new NotFoundException('Không tìm thấy ví của người dùng này');
        }

        return wallet;
    }

    async deposit(user: User, amount: number) {
        if (amount <= 0) {
            throw new ForbiddenException('Số tiền nạp phải là số dương');
        }

        // Use repository's updateBalance method
        return this.walletRepository.updateBalance(user.id, amount, 'add');
    }

    async deduct(user: User, amount: number) {
        if (amount <= 0) {
            throw new ForbiddenException('Số tiền trừ phải là số dương');
        }

        const wallet = await this.getWallet(user);

        if (wallet.balance < amount) {
            throw new ForbiddenException('Số dư trong ví không đủ');
        }

        // Use repository's updateBalance method
        return this.walletRepository.updateBalance(user.id, amount, 'subtract');
    }
}
