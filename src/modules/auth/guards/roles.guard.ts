import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { WinstonLogger } from 'src/common/config/winston.logger';

@Injectable()
export class RolesGuard implements CanActivate {
// Define hierarchical privileges where a higher index implies greater access rights
  private readonly hierarchy = [UserRole.MEMBER, UserRole.ADMIN, UserRole.OWNER];

  constructor(
    private readonly reflector: Reflector,
    private readonly logger: WinstonLogger,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Extract required roles metadata defined by the @Roles() decorator.
    // Overrides class-level metadata if method-level metadata is present.
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;

    const { user, url, method } = context.switchToHttp().getRequest();
    const userLevel = this.hierarchy.indexOf((user as JwtPayload).role);
    const hasRole = requiredRoles.some(role => userLevel >= this.hierarchy.indexOf(role));
    // Audit trailing: Log unauthorized access attempts for security monitoring
    if (!hasRole) {
      this.logger.warn(
        `Forbidden: user ${user.sub} (${user.role}) → ${method} ${url}`,
        RolesGuard.name,
      );
    }

    return hasRole;
  }
}