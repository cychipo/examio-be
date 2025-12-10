import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';

export interface QuestionTokenPayload {
    qid: string; // Question ID
    aid: string; // Attempt ID
    uid: string; // User ID
    i: number; // Question index
    t: 'question'; // Token type
}

export interface DecodedQuestionToken extends QuestionTokenPayload {
    exp: number;
    iat: number;
}

@Injectable()
export class CryptoService {
    private readonly jwtSecret: string;
    private readonly aesKey: Buffer;
    private readonly algorithm = 'aes-256-cbc';

    constructor() {
        // Get secrets from environment
        this.jwtSecret =
            process.env.QUIZ_JWT_SECRET || 'default-quiz-jwt-secret-32chars!';
        const aesKeyString =
            process.env.QUIZ_AES_KEY || 'default-aes-256-key-32-chars!!!';

        // Ensure AES key is exactly 32 bytes
        this.aesKey = Buffer.from(
            aesKeyString.padEnd(32, '!').slice(0, 32),
            'utf8'
        );
    }

    /**
     * Sign a JWT token for a question
     * Contains question ID, attempt ID, user ID, and index
     * Expires when the exam session ends (or default 24h)
     */
    signQuestionToken(
        payload: QuestionTokenPayload,
        expiresInSeconds: number = 86400 // Default 24 hours
    ): string {
        return jwt.sign(payload, this.jwtSecret, {
            expiresIn: expiresInSeconds,
        });
    }

    /**
     * Verify and decode a question JWT token
     * Returns the payload if valid, throws if invalid/expired
     */
    verifyQuestionToken(token: string): DecodedQuestionToken {
        try {
            return jwt.verify(token, this.jwtSecret) as DecodedQuestionToken;
        } catch (error) {
            throw new Error('Invalid or expired question token');
        }
    }

    /**
     * Encrypt content using AES-256-CBC
     * Returns: iv.ciphertext (base64 encoded)
     */
    encryptContent(text: string): string {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, this.aesKey, iv);

        let encrypted = cipher.update(text, 'utf8', 'base64');
        encrypted += cipher.final('base64');

        // Return iv.ciphertext format
        return `${iv.toString('base64')}.${encrypted}`;
    }

    /**
     * Decrypt content using AES-256-CBC
     * Input format: iv.ciphertext (base64 encoded)
     */
    decryptContent(ciphertext: string): string {
        const [ivBase64, dataBase64] = ciphertext.split('.');

        if (!ivBase64 || !dataBase64) {
            throw new Error('Invalid ciphertext format');
        }

        const iv = Buffer.from(ivBase64, 'base64');
        const encryptedData = Buffer.from(dataBase64, 'base64');

        const decipher = crypto.createDecipheriv(
            this.algorithm,
            this.aesKey,
            iv
        );

        let decrypted = decipher.update(encryptedData);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return decrypted.toString('utf8');
    }

    /**
     * Encrypt an array of options (converts to JSON, then encrypts)
     */
    encryptOptions(options: string[]): string {
        return this.encryptContent(JSON.stringify(options));
    }

    /**
     * Calculate expiry time in seconds from now until session end
     * Returns default 24h if no end time specified
     */
    calculateExpirySeconds(sessionEndTime?: Date | null): number {
        if (!sessionEndTime) {
            return 86400; // 24 hours default
        }

        const now = Date.now();
        const endTime = new Date(sessionEndTime).getTime();
        const diffSeconds = Math.floor((endTime - now) / 1000);

        // Minimum 5 minutes, maximum 7 days
        return Math.max(300, Math.min(diffSeconds, 604800));
    }
}
