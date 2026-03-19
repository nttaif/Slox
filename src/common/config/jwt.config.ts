import { registerAs } from "@nestjs/config";

export const JwtConfigName = 'jwt';
export interface JwtConfig {
  secret: string;
  refreshSecret: string;
  accessExpiresIn: string;
  refreshExpiresIn: string;
}
export const JwtConfig = registerAs(JwtConfigName, (): JwtConfig => ({
  secret: process.env.JWT_SECRET!,
  refreshSecret: process.env.JWT_REFRESH_SECRET!,
  accessExpiresIn: '15m',
  refreshExpiresIn: '7d',
}));