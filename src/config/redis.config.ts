import { registerAs } from '@nestjs/config';

export const RedisConfigName = 'redis';

export interface RedisConfig {
  url: string;
}

export const RedisConfig = registerAs(RedisConfigName, (): RedisConfig => ({
  url: process.env.REDIS_URL!,
}));