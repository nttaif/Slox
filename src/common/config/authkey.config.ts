import { registerAs } from '@nestjs/config';

export const AuthKeyConfigName = 'authkey';

export interface AuthKeyConfig {
  publicKey: string;
  privateKey: string;
}

export default registerAs(AuthKeyConfigName, () => ({
  publicKey: process.env.AUTH_PUBLIC_KEY,
  privateKey: process.env.AUTH_PRIVATE_KEY,
}));