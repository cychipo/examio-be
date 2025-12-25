import { Injectable } from '@nestjs/common';
import { mailTransporter } from '../config/mail.config';
import * as ejs from 'ejs';
import * as path from 'path';

@Injectable()
export class MailService {
    async sendMail(
        to: string,
        subject: string,
        template: string,
        context: any
    ) {
        const templatePath = path.join(
            process.cwd(),
            'src',
            'templates',
            `${template}.ejs`
        );
        const html = (await ejs.renderFile(templatePath, context)) as string;

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to,
            subject,
            html,
        };

        return mailTransporter.sendMail(mailOptions);
    }
}
