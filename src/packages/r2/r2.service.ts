import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { r2Config } from 'src/config/r2.config';
import { Injectable } from '@nestjs/common';

@Injectable()
export class R2Service {
    private s3: S3Client;
    private readonly publicBaseUrl = 'https://examio-r2.fayedark.com';

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

    /**
     * Upload file với hỗ trợ directory/folder
     * @param key - Tên file hoặc đường dẫn đầy đủ (vd: "avatars/user123.jpg")
     * @param buffer - File buffer
     * @param mimetype - MIME type của file
     * @param directory - Thư mục (optional, sẽ được thêm vào trước key)
     * @returns Full key/path của file đã upload
     */
    async uploadFile(
        key: string,
        buffer: Buffer,
        mimetype: string,
        directory?: string
    ): Promise<string> {
        // Nếu có directory, thêm vào trước key
        const fullKey = directory ? `${directory}/${key}` : key;

        await this.s3.send(
            new PutObjectCommand({
                Bucket: r2Config.bucket,
                Key: fullKey,
                Body: buffer,
                ContentType: mimetype,
            })
        );

        return fullKey;
    }

    /**
     * Lấy public URL của file
     * @param key - Key/path của file trong bucket
     * @returns Public URL
     */
    getPublicUrl(key: string): string {
        return `${this.publicBaseUrl}/${key}`;
    }

    /**
     * Lấy file từ R2
     * @param key - Key/path của file
     * @returns File stream
     */
    async getFile(key: string) {
        const res = await this.s3.send(
            new GetObjectCommand({
                Bucket: r2Config.bucket,
                Key: key,
            })
        );
        return res.Body;
    }

    /**
     * Xóa file từ R2
     * @param key - Key/path của file
     */
    async deleteFile(key: string): Promise<void> {
        await this.s3.send(
            new DeleteObjectCommand({
                Bucket: r2Config.bucket,
                Key: key,
            })
        );
    }

    /**
     * List files trong một directory
     * @param directory - Tên thư mục/prefix
     * @param maxKeys - Số lượng file tối đa (mặc định 1000)
     * @returns Danh sách files
     */
    async listFiles(directory?: string, maxKeys: number = 1000) {
        const res = await this.s3.send(
            new ListObjectsV2Command({
                Bucket: r2Config.bucket,
                Prefix: directory,
                MaxKeys: maxKeys,
            })
        );

        return (
            res.Contents?.map((item) => ({
                key: item.Key!,
                size: item.Size!,
                lastModified: item.LastModified!,
                url: this.getPublicUrl(item.Key!),
            })) || []
        );
    }

    /**
     * Xóa nhiều files trong một directory
     * @param directory - Tên thư mục
     * @returns Số lượng files đã xóa
     */
    async deleteDirectory(directory: string): Promise<number> {
        const files = await this.listFiles(directory);

        await Promise.all(files.map((file) => this.deleteFile(file.key)));

        return files.length;
    }
}
