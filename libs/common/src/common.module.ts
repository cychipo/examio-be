import { Module } from '@nestjs/common';
import { CommonService } from './common.service';
import { MailService } from './services/mail.service';
import { PasswordService } from './services/password.service';
import { GenerateIdService } from './services/generate-id.service';
import { CryptoService } from './services/crypto.service';
import { PdfService } from './services/pdf.service';
import { ImagePreprocessingService } from './services/image-preprocessing.service';
import { RecaptchaService } from './services/recaptcha.service';

const services = [
    CommonService,
    MailService,
    PasswordService,
    GenerateIdService,
    CryptoService,
    PdfService,
    ImagePreprocessingService,
    RecaptchaService,
];

@Module({
    providers: services,
    exports: services,
})
export class CommonModule {}
