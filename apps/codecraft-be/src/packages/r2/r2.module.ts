import { Module } from '@nestjs/common';
import { R2Controller } from './r2.controller';
import { R2Service } from './r2.service';

@Module({
    controllers: [R2Controller],
    providers: [R2Service],
    exports: [R2Service], // Export để các module khác có thể sử dụng
})
export class R2Module {}
