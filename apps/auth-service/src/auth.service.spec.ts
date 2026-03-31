import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

describe('AuthService refresh token flow', () => {
    const mockPrisma = {};
    const mockMailService = { sendMail: jest.fn() };
    const mockPasswordService = {
        comparePasswords: jest.fn(),
        hashPassword: jest.fn(),
    };
    const mockEventPublisher = {
        publishAuthEvent: jest.fn(),
    };

    let userRepository: {
        findByIdWithRelations: jest.Mock;
    };
    let userSessionRepository: {
        findByRefreshToken: jest.Mock;
        rotateRefreshToken: jest.Mock;
        deactivateSession: jest.Mock;
        create: jest.Mock;
        findBySessionId: jest.Mock;
        updateLastActivity: jest.Mock;
    };
    let jwtService: {
        sign: jest.Mock;
    };
    let generateIdService: {
        generateId: jest.Mock;
    };
    let authService: AuthService;

    beforeEach(() => {
        userRepository = {
            findByIdWithRelations: jest.fn(),
        };

        userSessionRepository = {
            findByRefreshToken: jest.fn(),
            rotateRefreshToken: jest.fn(),
            deactivateSession: jest.fn(),
            create: jest.fn(),
            findBySessionId: jest.fn(),
            updateLastActivity: jest.fn(),
        };

        jwtService = {
            sign: jest.fn(),
        };

        generateIdService = {
            generateId: jest.fn(),
        };

        authService = new AuthService(
            mockPrisma as any,
            userRepository as any,
            userSessionRepository as any,
            jwtService as any,
            mockMailService as any,
            mockPasswordService as any,
            generateIdService as any,
            mockEventPublisher as any
        );
    });

    it('rotates refresh token and returns a new access token', async () => {
        userSessionRepository.findByRefreshToken.mockResolvedValue({
            id: 'session-row-id',
            sessionId: 'session-123',
            userId: 'user-123',
            isActive: true,
            expiresAt: new Date(Date.now() + 60_000),
        });
        userRepository.findByIdWithRelations.mockResolvedValue({
            id: 'user-123',
            email: 'student@example.com',
            username: 'student',
            password: 'hashed-password',
            isAdmin: false,
            role: 'student',
        });
        jwtService.sign.mockReturnValue('new-access-token');
        generateIdService.generateId
            .mockReturnValueOnce('refresh-part-1')
            .mockReturnValueOnce('refresh-part-2');

        const result = await authService.refreshAccessToken('old-refresh-token');

        expect(jwtService.sign).toHaveBeenCalledWith({ userId: 'user-123' });
        expect(userSessionRepository.rotateRefreshToken).toHaveBeenCalledWith(
            'session-123',
            'refresh-part-1_refresh-part-2'
        );
        expect(result).toEqual({
            token: 'new-access-token',
            refreshToken: 'refresh-part-1_refresh-part-2',
            user: expect.objectContaining({
                id: 'user-123',
                email: 'student@example.com',
                username: 'student',
            }),
        });
        expect(result.user.password).toBeUndefined();
    });

    it('rejects expired refresh token sessions', async () => {
        userSessionRepository.findByRefreshToken.mockResolvedValue({
            id: 'session-row-id',
            sessionId: 'session-123',
            userId: 'user-123',
            isActive: true,
            expiresAt: new Date(Date.now() - 1_000),
        });

        await expect(
            authService.refreshAccessToken('expired-refresh-token')
        ).rejects.toThrow(new UnauthorizedException('Session expired'));

        expect(userSessionRepository.deactivateSession).toHaveBeenCalledWith(
            'session-row-id'
        );
        expect(userSessionRepository.rotateRefreshToken).not.toHaveBeenCalled();
    });

    it('rejects refresh when session user no longer exists', async () => {
        userSessionRepository.findByRefreshToken.mockResolvedValue({
            id: 'session-row-id',
            sessionId: 'session-123',
            userId: 'missing-user',
            isActive: true,
            expiresAt: new Date(Date.now() + 60_000),
        });
        userRepository.findByIdWithRelations.mockResolvedValue(null);

        await expect(
            authService.refreshAccessToken('refresh-token')
        ).rejects.toThrow(new NotFoundException('User not found'));
    });
});
