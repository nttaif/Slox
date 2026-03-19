import { UserRole } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}