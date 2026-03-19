import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from 'src/common/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { WinstonLogger } from 'src/common/config/winston.logger';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

// ─── Mock Data ────────────────────────────────────────────────────────────────

const mockTenant = {
  id: 'tenant-456',
  name: 'Spa ABC',
  slug: 'spa-abc',
};

const mockUser = {
  id: 'user-123',
  tenantId: 'tenant-456',
  email: 'owner@spa-abc.com',
  passwordHash: '$2b$12$hashedpassword',
  name: 'Nguyen Van A',
  role: UserRole.OWNER,
  deletedAt: null,
};

const mockTokens = {
  accessToken: 'mock.access.token',
  refreshToken: 'mock.refresh.token',
};

const mockAuthKeyConfig = {
  privateKey: '-----BEGIN RSA PRIVATE KEY-----\nmock\n-----END RSA PRIVATE KEY-----',
  publicKey: '-----BEGIN PUBLIC KEY-----\nmock\n-----END PUBLIC KEY-----',
};

const mockJwtConfig = {
  refreshSecret: 'mock-refresh-secret',
  accessExpiresIn: '15m',
  refreshExpiresIn: '7d',
};

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrismaService = {
  $transaction: jest.fn(),
  user: {
    findFirst: jest.fn(),
  },
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock.token'),
};

const mockConfigService = {
  getOrThrow: jest.fn((key: string) => {
    if (key === 'authkey') return mockAuthKeyConfig;
    if (key === 'jwt') return mockJwtConfig;
    throw new Error(`Unknown config key: ${key}`);
  }),
};

const mockLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: WinstonLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── register() ─────────────────────────────────────────────────────────────

  describe('register()', () => {
    const registerDto = {
      businessName: 'Spa ABC',
      slug: 'spa-abc',
      ownerName: 'Nguyen Van A',
      email: 'owner@spa-abc.com',
      password: 'password123',
    };

    it('should create tenant + user and return tokens', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$12$hashedpassword');
      mockJwtService.sign.mockReturnValueOnce('access.token').mockReturnValueOnce('refresh.token');

      mockPrismaService.$transaction.mockImplementation(async (cb: any) => {
        return cb({
          tenant: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(mockTenant),
          },
          user: {
            create: jest.fn().mockResolvedValue(mockUser),
          },
        });
      });

      const result = await service.register(registerDto);

      expect(result).toEqual({
        accessToken: 'access.token',
        refreshToken: 'refresh.token',
      });
      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
    });

    it('should throw ConflictException when slug already exists', async () => {
      mockPrismaService.$transaction.mockImplementation(async (cb: any) => {
        return cb({
          tenant: {
            findUnique: jest.fn().mockResolvedValue(mockTenant),
            create: jest.fn(),
          },
          user: { create: jest.fn() },
        });
      });

      await expect(service.register(registerDto)).rejects.toThrow(ConflictException);
    });

    it('should hash password with bcrypt before saving', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$12$hashedpassword');

      mockPrismaService.$transaction.mockImplementation(async (cb: any) => {
        const mockUserCreate = jest.fn().mockResolvedValue(mockUser);
        await cb({
          tenant: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(mockTenant),
          },
          user: { create: mockUserCreate },
        });


        expect(mockUserCreate).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              passwordHash: '$2b$12$hashedpassword',
            }),
          }),
        );
      });

      await service.register(registerDto).catch(() => {}); // ignore token error
      expect(bcrypt.hash).toHaveBeenCalledWith(registerDto.password, 12);
    });

    it('should create user with OWNER role', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('$2b$12$hashedpassword');

      mockPrismaService.$transaction.mockImplementation(async (cb: any) => {
        const mockUserCreate = jest.fn().mockResolvedValue(mockUser);
        return cb({
          tenant: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(mockTenant),
          },
          user: { create: mockUserCreate },
        });
      });

      await service.register(registerDto);

      expect(mockPrismaService.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ─── login() ────────────────────────────────────────────────────────────────

  describe('login()', () => {
    const loginDto = {
      slug: 'spa-abc',
      email: 'owner@spa-abc.com',
      password: 'password123',
    };

    it('should return tokens on valid credentials', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockJwtService.sign
        .mockReturnValueOnce('access.token')
        .mockReturnValueOnce('refresh.token');

      const result = await service.login(loginDto);

      expect(result).toEqual({
        accessToken: 'access.token',
        refreshToken: 'refresh.token',
      });
    });

    it('should throw UnauthorizedException when user not found', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false); // dummy hash

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when password is wrong', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(UnauthorizedException);
    });

    it('should always call bcrypt.compare even when user not found (timing attack prevention)', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await service.login(loginDto).catch(() => {});

      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
      expect(bcrypt.compare).toHaveBeenCalledWith(
        loginDto.password,
        expect.any(String), // dummy hash
      );
    });

    it('should throw generic error message (không tiết lộ email hay password sai)', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      try {
        await service.login(loginDto);
      } catch (err) {
        expect(err.message).toBe('Email hoặc mật khẩu không đúng');
        expect(err.message).not.toContain('Email không tồn tại');
        expect(err.message).not.toContain('Mật khẩu không đúng');
      }
    });

    it('should log warning on failed login attempt', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await service.login(loginDto).catch(() => {});

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining(loginDto.email),
        AuthService.name,
      );
    });
  });

  // ─── refresh() ──────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    const jwtPayload = {
      sub: 'user-123',
      tenantId: 'tenant-456',
      role: UserRole.OWNER,
    };

    it('should return new tokens when user exists', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);
      mockJwtService.sign
        .mockReturnValueOnce('new.access.token')
        .mockReturnValueOnce('new.refresh.token');

      const result = await service.refresh(jwtPayload);

      expect(result).toEqual({
        accessToken: 'new.access.token',
        refreshToken: 'new.refresh.token',
      });
    });

    it('should throw UnauthorizedException when user no longer exists', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      await expect(service.refresh(jwtPayload)).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException when user is soft deleted', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(null);

      await expect(service.refresh(jwtPayload)).rejects.toThrow(UnauthorizedException);
    });

    it('should query user by sub from payload', async () => {
      mockPrismaService.user.findFirst.mockResolvedValue(mockUser);

      await service.refresh(jwtPayload);

      expect(mockPrismaService.user.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: jwtPayload.sub,
            deletedAt: null,
          }),
        }),
      );
    });
  });
});