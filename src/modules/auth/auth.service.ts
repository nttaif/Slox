// src/auth/auth.service.ts
import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { JwtConfig, JwtConfigName } from 'src/common/config/jwt.config';
import { PrismaService } from 'prisma/prisma.service';
import { WinstonLogger } from 'src/common/config/winston.logger';
import { AuthKeyConfig, AuthKeyConfigName } from 'src/common/config/authkey.config';

const BCRYPT_ROUNDS = 12;
const DUMMY_HASH = '$2b$12$invalidhashfortimingattackprevention00000000000000000000';

@Injectable()
export class AuthService {
  private readonly privateKey: string;
  private readonly jwtConfig: JwtConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly logger: WinstonLogger,
  ) {
    const { privateKey } = config.getOrThrow<AuthKeyConfig>(AuthKeyConfigName);
    this.privateKey = privateKey;
    this.jwtConfig = config.getOrThrow<JwtConfig>(JwtConfigName);
  }

  // ─── Register ────────────────────────────────────────────────────────────────

  async register(dto: RegisterDto) {
    // 1. Create tenant + owner user in 1 transaction
    const result = await this.prisma.$transaction(async (tx) => {
      // Check slug unique
      const existingTenant = await tx.tenant.findUnique({
        where: { slug: dto.slug },
      });
      if (existingTenant) {
        throw new ConflictException(`Slug "${dto.slug}"Slug used by another business`);
      }
      // Check email unique in tenant
      const tenant = await tx.tenant.create({
        data: {
          name: dto.businessName,
          slug: dto.slug,
        },
      });

      const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: dto.email,
          passwordHash,
          name: dto.ownerName,
          role: 'OWNER',
        },
      });

      return { tenant, user };
    });

    this.logger.log(
      `New tenant registered: ${result.tenant.slug} (${result.tenant.id})`,
      AuthService.name,
    );

    return this.generateTokens(result.user);
  }

  // ─── Login ───────────────────────────────────────────────────────────────────
  // Flow OWASP Authentication Cheat Sheet
  async login(dto: LoginDto) {
    // 1. find user by email + tenant slug (only 1 query with proper indexing)
    const user = await this.prisma.user.findFirst({
      where: {
        email: dto.email,
        deletedAt: null,
        tenant: { slug: dto.slug },
      },
    });

    // 2. Use bcrypt.compare which is resistant to timing attacks, and always call it even if user not found (using dummy hash) to prevent user enumeration
    const isValid = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? DUMMY_HASH,
    );

    if (!user || !isValid) {
      this.logger.warn(
        `Failed login attempt: ${dto.email} @ ${dto.slug}`,
        AuthService.name,
      );
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng');
    }

    this.logger.log(`User logged in: ${user.id}`, AuthService.name);
    return this.generateTokens(user);
  }

  // ─── Refresh ─────────────────────────────────────────────────────────────────

  async refresh(payload: JwtPayload) {
    const user = await this.prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
    });

    if (!user) {
      throw new UnauthorizedException('User không tồn tại');
    }

    return this.generateTokens(user);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private generateTokens(user: { id: string; tenantId: string; role: any }) {
  const payload: JwtPayload = {
    sub: user.id,
    tenantId: user.tenantId,
    role: user.role,
  };

  const accessTokenOptions: JwtSignOptions = {
    privateKey: this.privateKey,
    algorithm: 'RS256',
    expiresIn: this.jwtConfig.accessExpiresIn as any,
  };

  const refreshTokenOptions: JwtSignOptions = {
    secret: this.jwtConfig.refreshSecret,
    expiresIn: this.jwtConfig.refreshExpiresIn as any,
  };

  return {
    accessToken: this.jwtService.sign(payload as any, accessTokenOptions),
    refreshToken: this.jwtService.sign(payload as any, refreshTokenOptions),
  };
}
}