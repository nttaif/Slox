import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from 'crypto';
import { WinstonLogger } from "./config/winston.logger";
@Injectable()
export class CryptoService {
    private readonly algorithm = 'aes-256-gcm';
    private readonly key: Buffer;
    constructor(private readonly config: ConfigService, private readonly logger: WinstonLogger,) {
        const secret = this.config.get<string>('ENCRYPTION_KEY');
        if (!secret || secret.length !== 32) {
        throw new Error('CRITICAL: ENCRYPTION_KEY must be exactly 32 characters long.');
        }
        this.key = Buffer.from(secret, 'utf-8');
    }

    encrypt(text: string): string {
        try {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
        } catch (err) {
        this.logger.error('Encryption failed', err.stack, CryptoService.name);
        throw new InternalServerErrorException('Failed to encrypt sensitive data');
        }
    }

    decrypt(encryptedData: string): string {
        try {
        const parts = encryptedData.split(':');
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted data format');
        }
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encryptedText = parts[2];
        const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
        } catch (err) {
        this.logger.error('Decryption failed — data may be corrupted or key changed', err.stack, CryptoService.name);
        throw new InternalServerErrorException('Failed to decrypt data');
        }
    }
}