import { Global, Module } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { CryptoService } from './CryptoService';
import { WinstonLogger } from './config/winston.logger';

@Global()
@Module({
  providers: [PrismaService, CryptoService, WinstonLogger],
  exports: [PrismaService, CryptoService, WinstonLogger],
})
export class CommonModule {}