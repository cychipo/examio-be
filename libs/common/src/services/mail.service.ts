import { Injectable } from '@nestjs/common';
import { mailTransporter } from '../config/mail.config';
import * as ejs from 'ejs';
import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class MailService {
    async sendMail(
        to: string,
        subject: string,
        template: string,
        context: any
    ) {
        // Try multiple possible paths for templates
        const possiblePaths = [
            // Production build path (from dist/)
            path.join(process.cwd(), 'templates', `${template}.ejs`),
            // Development path (from root)
            path.join(process.cwd(), 'src', 'templates', `${template}.ejs`),
            // Alternative production path
            path.join(
                __dirname,
                '..',
                '..',
                '..',
                'templates',
                `${template}.ejs`
            ),
        ];

        let templatePath: string | null = null;
        for (const testPath of possiblePaths) {
            if (fs.existsSync(testPath)) {
                templatePath = testPath;
                break;
            }
        }

        if (!templatePath) {
            throw new Error(
                `Template not found: ${template}.ejs. Tried paths: ${possiblePaths.join(', ')}`
            );
        }

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
