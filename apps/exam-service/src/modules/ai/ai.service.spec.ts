import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { AIService } from './ai.service';
import { AIRepository } from './ai.repository';
import { GenerateIdService, R2ClientService } from '@examio/common';
import { FinanceClientService } from '../finance-client/finance-client.service';

describe('AIService', () => {
    let service: AIService;
    let httpService: { post: jest.Mock; delete: jest.Mock };
    let aiRepository: {
        findDuplicateUserStorage: jest.Mock;
        updateUserStorageStatus: jest.Mock;
        findUserStorageById: jest.Mock;
        countDocumentsByUserStorageId: jest.Mock;
        createUserStorage: jest.Mock;
        deleteUploadAggregate: jest.Mock;
    };
    let r2ClientService: {
        uploadFile: jest.Mock;
        getPublicUrl: jest.Mock;
        deleteFile: jest.Mock;
    };

    beforeEach(async () => {
        httpService = {
            post: jest.fn(),
            delete: jest.fn().mockReturnValue(of({ data: { success: true } })),
        };

        aiRepository = {
            findDuplicateUserStorage: jest.fn(),
            updateUserStorageStatus: jest.fn(),
            findUserStorageById: jest.fn(),
            countDocumentsByUserStorageId: jest.fn(),
            createUserStorage: jest.fn(),
            deleteUploadAggregate: jest.fn(),
        };

        r2ClientService = {
            uploadFile: jest.fn(),
            getPublicUrl: jest.fn(),
            deleteFile: jest.fn(),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                AIService,
                {
                    provide: AIRepository,
                    useValue: aiRepository,
                },
                {
                    provide: GenerateIdService,
                    useValue: { generateId: jest.fn().mockReturnValue('generated-id') },
                },
                {
                    provide: HttpService,
                    useValue: httpService,
                },
                {
                    provide: FinanceClientService,
                    useValue: { deductCredits: jest.fn() },
                },
                {
                    provide: R2ClientService,
                    useValue: r2ClientService,
                },
            ],
        }).compile();

        service = module.get(AIService);
    });

    it('forwards narrow search params when generating from duplicate completed upload', async () => {
        aiRepository.findDuplicateUserStorage.mockResolvedValue({
            id: 'upload-1',
            processingStatus: 'COMPLETED',
        });
        aiRepository.updateUserStorageStatus.mockResolvedValue({});
        aiRepository.findUserStorageById.mockResolvedValue({
            id: 'upload-1',
            processingStatus: 'COMPLETED',
        });
        aiRepository.countDocumentsByUserStorageId.mockResolvedValue(3);

        httpService.post.mockReturnValue(
            of({ data: { success: true, history_id: 'history-1' } })
        );

        const user = { id: 'user-1' } as any;
        const file = {
            originalname: 'file.pdf',
            size: 1024,
            buffer: Buffer.from('content'),
            mimetype: 'application/pdf',
        } as Express.Multer.File;

        const result = await service.generateFromFile(user, file, {
            typeResult: '1',
            quantityQuizz: '5',
            isNarrowSearch: 'true',
            keyword: 'kiến trúc hệ thống',
            modelType: 'gemini',
        });

        expect(result.jobId).toBe('upload-1');

        await new Promise((resolve) => setImmediate(resolve));

        expect(httpService.post).toHaveBeenCalledWith(
            expect.stringContaining('/generate/quiz'),
            expect.objectContaining({
                userStorageId: 'upload-1',
                userId: 'user-1',
                numQuestions: 5,
                isNarrowSearch: true,
                keyword: 'kiến trúc hệ thống',
                modelType: 'gemini',
            }),
            expect.any(Object)
        );
    });

    it('forwards narrow search params when regenerating content', async () => {
        const upload = {
            id: 'upload-2',
            userId: 'user-1',
            filename: 'file.pdf',
            processingStatus: 'COMPLETED',
        };

        jest.spyOn(service, 'getUploadDetail').mockResolvedValue(upload as any);
        aiRepository.updateUserStorageStatus.mockResolvedValue({});
        aiRepository.findUserStorageById.mockResolvedValue(upload);
        aiRepository.countDocumentsByUserStorageId.mockResolvedValue(5);
        httpService.post.mockReturnValue(
            of({ data: { success: true, history_id: 'history-2' } })
        );

        const result = await service.regenerate('upload-2', { id: 'user-1' } as any, {
            typeResult: 2,
            quantityFlashcard: 7,
            isNarrowSearch: true,
            keyword: 'flashcard keyword',
            modelType: 'gemini',
        });

        expect(result.jobId).toBe('upload-2');

        await new Promise((resolve) => setImmediate(resolve));

        expect(httpService.post).toHaveBeenCalledWith(
            expect.stringContaining('/generate/flashcards'),
            expect.objectContaining({
                userStorageId: 'upload-2',
                userId: 'user-1',
                numFlashcards: 7,
                isNarrowSearch: true,
                keyword: 'flashcard keyword',
                modelType: 'gemini',
            }),
            expect.any(Object)
        );
    });

    it('deletes R2 file, upload aggregate data, and AI cache when deleting upload', async () => {
        jest.spyOn(service, 'getUploadDetail').mockResolvedValue({
            id: 'upload-delete-1',
            userId: 'user-1',
            keyR2: 'ai-uploads/file.pdf',
        } as any);
        aiRepository.deleteUploadAggregate.mockResolvedValue({
            documents: 5,
            quizHistories: 2,
            flashcardHistories: 1,
            aiChatDocuments: 1,
            userStorage: { id: 'upload-delete-1' },
        });

        const result = await service.deleteUpload(
            'upload-delete-1',
            { id: 'user-1' } as any
        );

        expect(r2ClientService.deleteFile).toHaveBeenCalledWith(
            'ai-uploads/file.pdf'
        );
        expect(aiRepository.deleteUploadAggregate).toHaveBeenCalledWith(
            'upload-delete-1'
        );
        expect(httpService.delete).toHaveBeenCalledWith(
            expect.stringContaining('/ai/clear-cache/upload-delete-1'),
            expect.any(Object)
        );
        expect(result).toEqual({ success: true, message: 'Xóa thành công' });
    });

    it('still deletes database records when R2 deletion fails', async () => {
        jest.spyOn(service, 'getUploadDetail').mockResolvedValue({
            id: 'upload-delete-2',
            userId: 'user-1',
            keyR2: 'ai-uploads/file.pdf',
        } as any);
        r2ClientService.deleteFile.mockRejectedValueOnce(
            new Error('Cloudflare unavailable')
        );
        aiRepository.deleteUploadAggregate.mockResolvedValue({
            documents: 3,
            quizHistories: 0,
            flashcardHistories: 0,
            aiChatDocuments: 0,
            userStorage: { id: 'upload-delete-2' },
        });

        const result = await service.deleteUpload(
            'upload-delete-2',
            { id: 'user-1' } as any
        );

        expect(aiRepository.deleteUploadAggregate).toHaveBeenCalledWith(
            'upload-delete-2'
        );
        expect(result).toEqual({
            success: true,
            message:
                'Đã xóa dữ liệu trong hệ thống nhưng không thể xóa file trên Cloudflare R2',
            warning: 'Cloudflare unavailable',
        });
    });
});
