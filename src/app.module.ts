import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import serverConfig from './config/server.config';
import databaseConfig, { DatabaseConfigName } from './config/database.config';
import { WinstonLogger } from './config/winston.logger';
import { PrismaModule } from 'prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        serverConfig,
        databaseConfig
      ],
      cache: true,
      envFilePath: getEnvFilePath(),
    }),
  ],
  providers: [
    {
      provide: 'Logger',
      useClass: WinstonLogger,
    },
  ],
})
export class AppModule {}


function getEnvFilePath() {
  return process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
}