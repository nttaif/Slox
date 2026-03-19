import { Injectable } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { WinstonLogger } from "src/common/config/winston.logger";

@Injectable()
export class PrismaService extends PrismaClient {
    constructor(private readonly logger: WinstonLogger) {
        super({
            log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
        });
    };
    async onModuleInit() {
        this.logger.log('Connecting to database...', PrismaService.name);
        await this.$connect();
        this.logger.log('Database connected', PrismaService.name);
    }

    async onModuleDestroy() {
        this.logger.log('Disconnecting from database...', PrismaService.name);
        await this.$disconnect();
    }
        
}