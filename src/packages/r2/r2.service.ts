import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { r2Config } from 'src/config/r2.config';

export class R2Service {
    private s3: S3Client;

    constructor() {
        this.s3 = new S3Client({
            region: r2Config.region,
            endpoint: r2Config.endpoint,
            credentials: {
                accessKeyId: r2Config.credentials.accessKeyId ?? '',
                secretAccessKey: r2Config.credentials.secretAccessKey ?? '',
            },
        });
    }

    async uploadFile(key: string, buffer: Buffer, mimetype: string) {
        await this.s3.send(
            new PutObjectCommand({
                Bucket: r2Config.bucket,
                Key: key,
                Body: buffer,
                ContentType: mimetype,
            })
        );
        return `https://${r2Config.endpoint}/${r2Config.bucket}/${key}`;
    }

    async getFile(key: string) {
        const res = await this.s3.send(
            new GetObjectCommand({
                Bucket: r2Config.bucket,
                Key: key,
            })
        );
        return res.Body;
    }

    async deleteFile(key: string) {
        await this.s3.send(
            new DeleteObjectCommand({
                Bucket: r2Config.bucket,
                Key: key,
            })
        );
    }
}
