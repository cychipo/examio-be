import { Module } from '@nestjs/common';
import { QuizsetService } from './quizset.service';
import { QuizsetController } from './quizset.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { GenerateIdService } from 'src/common/services/generate-id.service';
import { AuthModule } from 'src/packages/auth/auth.module';
import { AuthGuard } from 'src/common/guard/auth.guard';
import { QuizSetRepository } from './quizset.repository';
import { R2Module } from 'src/packages/r2/r2.module';

@Module({
    imports: [AuthModule, R2Module],
    providers: [
        PrismaService,
        QuizsetService,
        GenerateIdService,
        AuthGuard,
        QuizSetRepository,
    ],
    controllers: [QuizsetController],
    exports: [QuizsetService, QuizSetRepository],
})
export class QuizsetModule {}
