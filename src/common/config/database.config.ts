import { registerAs } from "@nestjs/config";

export const DatabaseConfigName = 'database';

export interface DatabaseConfig {
    type: string
    host: string,
    port: number,
    username: string,
    password: string,
    database: string,
    entities: [],
    synchronize: boolean,
    autoLoadEntities: boolean,
    extra?: {
    max: number;
    min: number;
  };
}

export default registerAs(DatabaseConfigName,(): DatabaseConfig => ({
    type: 'postgres',
    host: process.env.DB_HOST || '',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.POSTGRES_USER || '',
    password: process.env.POSTGRES_PASSWORD || '',
    database: process.env.POSTGRES_DB || '',
    entities: [],
    synchronize: false,
    autoLoadEntities: true,
    extra: {
        min: parseInt(process.env.DB_MIN_POOL_SIZE || '5', 10),
        max: parseInt(process.env.DB_MAX_POOL_SIZE || '10', 10),
    },
}))