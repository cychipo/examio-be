export const redisConfig = {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT
        ? parseInt(process.env.REDIS_PORT, 10)
        : 6379,
    password: process.env.REDIS_PASSWORD,
}