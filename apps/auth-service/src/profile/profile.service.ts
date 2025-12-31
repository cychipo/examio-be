import {
    Injectable,
    NotFoundException,
    BadRequestException,
    Inject,
    OnModuleInit,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, Observable } from 'rxjs';
import { User } from '@prisma/client';
import {
    GenerateIdService,
    sanitizeFilename,
    R2_SERVICE,
} from '@examio/common';
import { UserRepository } from '../repositories/user.repository';
import { UpdateProfileDto, ProfileResponseDto } from './dto/profile.dto';

// gRPC R2 Service interface (NestJS gRPC returns Observable, not Promise)
interface R2GrpcService {
    uploadFile(data: {
        user_id: string;
        filename: string;
        mimetype: string;
        content: Buffer;
        folder?: string;
    }): Observable<{
        success: boolean;
        file_id: string;
        url: string;
        key_r2: string;
        message: string;
    }>;
    getFileUrl(data: {
        key_r2: string;
        expires_in_seconds?: number;
    }): Observable<{ url: string; expires_at: number }>;
    deleteFile(data: {
        key_r2: string;
    }): Observable<{ success: boolean; message: string }>;
}

@Injectable()
export class ProfileService implements OnModuleInit {
    private r2GrpcService: R2GrpcService;

    constructor(
        private readonly userRepository: UserRepository,
        private readonly generateIdService: GenerateIdService,
        @Inject(R2_SERVICE) private readonly r2Client: ClientGrpc
    ) {}

    onModuleInit() {
        this.r2GrpcService =
            this.r2Client.getService<R2GrpcService>('R2Service');
    }

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

        const updatedUser = await this.userRepository.update(
            user.id,
            updateData,
            user.id
        );

        return this.sanitizeProfile(updatedUser);
    }

    /**
     * Upload profile image (avatar or banner) via gRPC to R2 Service
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

        // Upload via gRPC to R2 Service
        let uploadResult;
        try {
            console.log('Calling R2 gRPC uploadFile with:', {
                user_id: user.id,
                filename,
                mimetype: file.mimetype,
                contentLength: file.buffer.length,
                folder: directory,
            });

            uploadResult = await firstValueFrom(
                this.r2GrpcService.uploadFile({
                    user_id: user.id,
                    filename,
                    mimetype: file.mimetype,
                    content: file.buffer,
                    folder: directory,
                })
            );

            console.log('R2 gRPC uploadFile result:', uploadResult);
        } catch (error) {
            console.error('R2 gRPC uploadFile error:', error);
            throw new BadRequestException(
                `R2 service error: ${error.message || 'Failed to connect to R2 service. Make sure r2-service is running.'}`
            );
        }

        if (!uploadResult) {
            throw new BadRequestException(
                'R2 service returned no result. Make sure r2-service is running.'
            );
        }

        if (!uploadResult.success) {
            throw new BadRequestException(
                `Upload failed: ${uploadResult.message || 'Unknown error from R2 service'}`
            );
        }

        const url = uploadResult.url;

        // Update user profile with new URL
        const updateData: Partial<User> =
            type === 'avatar' ? { avatar: url } : { banner: url };

        await this.userRepository.update(user.id, updateData, user.id);

        // Delete old image from R2 if it exists
        if (oldImageUrl) {
            const oldKey = this.extractR2Key(oldImageUrl);
            if (oldKey) {
                await firstValueFrom(
                    this.r2GrpcService.deleteFile({ key_r2: oldKey })
                ).catch((err) => {
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
