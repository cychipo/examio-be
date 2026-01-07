import { Module } from '@nestjs/common';
import { SubjectController } from './subject.controller';
import { SubjectService } from './subject.service';
import { SubjectRepository } from './subject.repository';

@Module({
    controllers: [SubjectController],
    providers: [SubjectService, SubjectRepository],
    exports: [SubjectService],
})
export class SubjectModule {}
