import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisConfig, RedisConfigName } from 'src/config/redis.config';
import { WinstonLogger } from 'src/config/winston.logger';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: WinstonLogger,
  ) {}

  async onModuleInit() {
    const { url } = this.config.getOrThrow<RedisConfig>(RedisConfigName);

    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: true, // không connect tự động — mình control
    });

    // Lifecycle events
    this.client.on('connect', () =>
      this.logger.log('Redis connected', RedisService.name),
    );
    this.client.on('reconnecting', () =>
      this.logger.warn('Redis reconnecting...', RedisService.name),
    );
    this.client.on('error', (err) =>
      this.logger.error('Redis error', err.stack, RedisService.name),
    );

    await this.client.connect();
  }

  async onModuleDestroy() {
    this.logger.log('Disconnecting Redis...', RedisService.name);
    await this.client.quit();
  }

  // ─── Generic ────────────────────────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (err) {
      this.logger.error(`GET failed — key: ${key}`, err.stack, RedisService.name);
      throw err;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    try {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
    } catch (err) {
      this.logger.error(`SET failed — key: ${key}`, err.stack, RedisService.name);
      throw err;
    }
  }

  async del(...keys: string[]): Promise<void> {
    try {
      await this.client.del(...keys);
    } catch (err) {
      this.logger.error(`DEL failed — keys: ${keys.join(', ')}`, err.stack, RedisService.name);
      throw err;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch (err) {
      this.logger.error(`TTL failed — key: ${key}`, err.stack, RedisService.name);
      throw err;
    }
  }

  // ─── SETNX — dùng cho slot locking ──────────────────────────────────────────

  /**
   * Atomic lock: chỉ set nếu key chưa tồn tại
   * @returns true nếu acquire thành công, false nếu đã bị lock
   */
  async setnx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    try {
      const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
      const acquired = result === 'OK';

      if (!acquired) {
        this.logger.warn(`Lock already held — key: ${key}`, RedisService.name);
      }

      return acquired;
    } catch (err) {
      this.logger.error(`SETNX failed — key: ${key}`, err.stack, RedisService.name);
      throw err;
    }
  }

  // ─── Increment — dùng cho OTP attempt counter ────────────────────────────────

  /**
   * @returns giá trị sau khi increment
   */
  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (err) {
      this.logger.error(`INCR failed — key: ${key}`, err.stack, RedisService.name);
      throw err;
    }
  }

  // ─── Health check ────────────────────────────────────────────────────────────

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (err) {
      this.logger.error('Redis ping failed', err.stack, RedisService.name);
      return false;
    }
  }

  // ─── Expose raw client cho BullMQ ────────────────────────────────────────────

  getClient(): Redis {
    return this.client;
  }
}