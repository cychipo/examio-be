import { Injectable } from '@nestjs/common';

@Injectable()
export class GenerateIdService {
    generateId(): string {
        const timestamp = ((new Date().getTime() / 1000) | 0).toString(16);
        const oid =
            timestamp +
            'xxxxxxxxxxxxxxxx'
                .replace(/[x]/g, (_) => ((Math.random() * 16) | 0).toString(16))
                .toLowerCase();

        return oid;
    }

    generate6DigitCode(): string {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }
}
