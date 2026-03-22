import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AIController } from './ai.controller';
import { AIService } from './ai.service';

jest.mock('@examio/common', () => ({
    AuthGuard: class AuthGuard {
        canActivate() {
            return true;
        }
    },
    RolesGuard: class RolesGuard {
        canActivate() {
            return true;
        }
    },
    Roles: () => () => undefined,
}));

describe('AIController (e2e)', () => {
    let app: INestApplication;
    const aiService = {
        generateFromFile: jest.fn(),
    };

    beforeEach(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [AIController],
            providers: [
                {
                    provide: AIService,
                    useValue: aiService,
                },
            ],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.use((req, _res, next) => {
            req.user = { id: 'user-1', role: 'teacher' };
            next();
        });
        await app.init();
    });

    afterEach(async () => {
        jest.clearAllMocks();
        await app.close();
    });

    it('passes narrow search fields from multipart body to service', async () => {
        aiService.generateFromFile.mockResolvedValue({
            jobId: 'job-1',
            status: 'PENDING',
            message: 'ok',
        });

        await request(app.getHttpServer())
            .post('/ai/generate-from-file')
            .field('typeResult', '1')
            .field('quantityQuizz', '5')
            .field('isNarrowSearch', 'true')
            .field('keyword', 'kiến trúc hệ thống')
            .field('modelType', 'gemini')
            .attach('file', Buffer.from('file-content'), 'sample.pdf')
            .expect(201);

        expect(aiService.generateFromFile).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'user-1' }),
            expect.objectContaining({ originalname: 'sample.pdf' }),
            expect.objectContaining({
                typeResult: '1',
                quantityQuizz: '5',
                isNarrowSearch: 'true',
                keyword: 'kiến trúc hệ thống',
                modelType: 'gemini',
            })
        );
    });
});
