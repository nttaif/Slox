import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { CommonModule } from './common/common.module';
import serverConfig from './common/config/server.config';
import databaseConfig from './common/config/database.config';
import authkeyConfig from './common/config/authkey.config';
import { JwtConfig } from './common/config/jwt.config';
import { WinstonLogger } from './common/config/winston.logger';
import { HttpExceptionFilter } from './common/config/http-exception.filter';
import { ResponseInterceptor } from './common/config/response.interceptor';

@Module({
  imports: [
      ConfigModule.forRoot({
      isGlobal: true,
      load: [
        serverConfig,
        databaseConfig,
        authkeyConfig,
        JwtConfig,
      ],
      cache: true,
      envFilePath: getEnvFilePath(),
    }),
    CommonModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useFactory: (logger: WinstonLogger) => new HttpExceptionFilter(logger),
      inject: [WinstonLogger],
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },

  ],
})
export class AppModule {}


function getEnvFilePath() {
  return process.env.NODE_ENV === 'test' ? '.env.test' : '.env';
}