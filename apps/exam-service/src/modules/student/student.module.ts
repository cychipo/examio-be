import { Module } from '@nestjs/common';
import { StudentController } from './student.controller';
import { StudentService } from './student.service';
import { DatabaseModule } from '@examio/database';
import { AuthModule } from '@examio/common';

@Module({
    imports: [DatabaseModule, AuthModule],
    controllers: [StudentController],
    providers: [StudentService],
    exports: [StudentService],
})
export class StudentModule {}
