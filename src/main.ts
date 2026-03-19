import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { ServerConfig, ServerConfigName } from './common/config/server.config';
import { WinstonLogger } from './common/config/winston.logger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule,{bufferLogs: true,});
  const logger = app.get(WinstonLogger);
  const configService = app.get(ConfigService);
  const serverConfig = configService.getOrThrow<ServerConfig>(ServerConfigName);
  await app.listen(serverConfig.port);
  logger.log(`Server running on port ${serverConfig.port}`, 'Bootstrap');
}
bootstrap();
