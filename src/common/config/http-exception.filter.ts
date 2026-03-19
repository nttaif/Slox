import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { WinstonLogger } from './winston.logger';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: WinstonLogger) {}

  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    const message =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : (exceptionResponse as any).message ?? exception.message;

    const logMessage = `${request.method} ${request.url} → ${status}`;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(logMessage, exception.stack, HttpExceptionFilter.name);
    } else {
      this.logger.warn(logMessage, HttpExceptionFilter.name);
    }

    response.status(status).json({
      success: false,
      error: {
        statusCode: status,
        message,
      },
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}