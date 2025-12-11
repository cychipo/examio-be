import {
    Injectable,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { UserRepository } from '../repositories/user.repository';
import { UpdateProfileDto, ProfileResponseDto } from './dto/profile.dto';
import { R2Service } from 'src/packages/r2/r2.service';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { sanitizeFilename } from 'src/common/utils/sanitize-filename';

@Injectable()
export class ProfileService {
    constructor(
        private readonly userRepository: UserRepository,
        private readonly r2Service: R2Service,
        private readonly generateIdService: GenerateIdService
    ) {}

    /**
     * Get user profile - O(1) with cache
     */
    async getProfile(user: User): Promise<ProfileResponseDto> {
        const userData = await this.userRepository.findByIdWithRelations(
            user.id,
            [],
            true
        );

        if (!userData) {
            throw new NotFoundException('Không tìm thấy người dùng');
        }

        return this.sanitizeProfile(userData);
    }

    /**
     * Update user profile - invalidates cache
     */
    async updateProfile(
        user: User,
        dto: UpdateProfileDto
    ): Promise<ProfileResponseDto> {
        const updateData: Partial<User> = {};

        if (dto.name !== undefined) {
            updateData.name = dto.name;
        }
        if (dto.bio !== undefined) {
            updateData.bio = dto.bio;
        }
        if (dto.avatar !== undefined) {
            updateData.avatar = dto.avatar;
        }
        if (dto.banner !== undefined) {
            updateData.banner = dto.banner;
        }

        const updatedUser = await this.userRepository.updateUser(
            user.id,
            updateData,
            user.id
        );

        return this.sanitizeProfile(updatedUser);
    }

    /**
     * Upload profile image (avatar or banner) to R2
     */
    async uploadProfileImage(
        user: User,
        file: Express.Multer.File,
        type: 'avatar' | 'banner'
    ): Promise<{ url: string }> {
        // Validate file type
        const supportedMimeTypes = [
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
        ];
        if (!file.mimetype || !supportedMimeTypes.includes(file.mimetype)) {
            throw new BadRequestException(
                'Chỉ hỗ trợ ảnh định dạng JPEG, PNG, GIF, WebP'
            );
        }

        // Validate file size
        const maxSize = type === 'avatar' ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
        if (file.size > maxSize) {
            throw new BadRequestException(
                `Kích thước ảnh tối đa là ${type === 'avatar' ? '2MB' : '5MB'}`
            );
        }

        // Get current user to find old image URL
        const currentUser = await this.userRepository.findByIdWithRelations(
            user.id,
            [],
            false
        );
        const oldImageUrl =
            type === 'avatar' ? currentUser?.avatar : currentUser?.banner;

        // Generate unique filename
        const sanitizedName = sanitizeFilename(file.originalname);
        const filename = `${this.generateIdService.generateId()}-${sanitizedName}`;
        const directory = type === 'avatar' ? 'avatars' : 'banners';

        // Upload to R2
        const r2Key = await this.r2Service.uploadFile(
            filename,
            file.buffer,
            file.mimetype,
            directory
        );

        const url = this.r2Service.getPublicUrl(r2Key);

        // Update user profile with new URL
        const updateData: Partial<User> =
            type === 'avatar' ? { avatar: url } : { banner: url };

        await this.userRepository.updateUser(user.id, updateData, user.id);

        // Delete old image from R2 if it exists
        if (oldImageUrl) {
            const oldKey = this.extractR2Key(oldImageUrl);
            if (oldKey) {
                await this.r2Service.deleteFile(oldKey).catch((err) => {
                    console.warn(`Failed to delete old ${type} from R2:`, err);
                });
            }
        }

        return { url };
    }

    /**
     * Extract R2 key from public URL
     */
    private extractR2Key(url: string): string | null {
        return url?.replace(/^https?:\/\/[^/]+\//, '') || null;
    }

    /**
     * Remove sensitive fields from user data
     */
    private sanitizeProfile(user: User): ProfileResponseDto {
        return {
            id: user.id,
            email: user.email,
            username: user.username,
            name: user.name,
            avatar: user.avatar,
            banner: user.banner,
            bio: user.bio,
            isVerified: user.isVerified,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        };
    }
}
