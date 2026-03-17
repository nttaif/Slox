import { Injectable, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as winston from 'winston';
import * as DailyRotateFile from 'winston-daily-rotate-file';
import { ServerConfig, ServerConfigName } from '../config/server.config';
import { join } from 'path';

@Injectable()
export class WinstonLogger implements LoggerService {
  private readonly logger: winston.Logger;
  private readonly isDev: boolean;

  constructor(private readonly configService: ConfigService) {
    const serverConfig =
      this.configService.getOrThrow<ServerConfig>(ServerConfigName);

    this.isDev = serverConfig.nodeEnv !== 'production';
    const logsPath = join(process.cwd(), serverConfig.logDirectory);

    // Dev: debug+, Production: warn+
    const logLevel = this.isDev ? 'debug' : 'warn';

    this.logger = winston.createLogger({
      level: logLevel,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
      ),
      transports: [
        // Console: colorized + readable in dev, JSON in prod
        new winston.transports.Console({
          format: this.isDev
            ? winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, context, trace }) => {
                  const ctx = context ? ` [${context}]` : '';
                  const tr = trace ? `\n${trace}` : '';
                  return `${timestamp} ${level}${ctx}: ${message}${tr}`;
                }),
              )
            : winston.format.json(),
        }),

        new DailyRotateFile({
          level: 'warn',
          dirname: logsPath,
          filename: '%DATE%.log',
          datePattern: 'YYYY-MM-DD',
          zippedArchive: true,
          handleExceptions: true,
          maxSize: '20m',
          maxFiles: '14d',
          format: winston.format.json(),
        }),
      ],
      exitOnError: false,
    });
  }

  log(message: string, context?: string) {
    this.logger.info(message, { context });
  }

  error(message: string, trace?: string, context?: string) {
    this.logger.error(message, { trace, context });
  }

  warn(message: string, context?: string) {
    this.logger.warn(message, { context });
  }

  debug(message: string, context?: string) {
    this.logger.debug(message, { context });
  }

  verbose(message: string, context?: string) {
    this.logger.verbose(message, { context });
  }
}