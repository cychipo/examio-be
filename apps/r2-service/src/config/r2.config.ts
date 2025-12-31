export const r2Config = {
    region: 'auto',
    endpoint:
        process.env.R2_ENDPOINT ||
        'https://your_account_id.r2.cloudflarestorage.com',
    bucket: process.env.R2_BUCKET_NAME || 'examio',
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    publicBaseUrl:
        process.env.R2_PUBLIC_URL || 'https://examio-r2.fayedark.com',
};
