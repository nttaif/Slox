import { Global, Module } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma.service';
import { CryptoService } from './crypto.service';
import { WinstonLogger } from './config/winston.logger';

@Global()
@Module({
  providers: [PrismaService, CryptoService, WinstonLogger],
  exports: [PrismaService, CryptoService, WinstonLogger],
})
export class CommonModule {}