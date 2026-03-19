import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '@prisma/client';

// ─── Mock Data ────────────────────────────────────────────────────────────────

const mockTokens = {
  accessToken: 'mock.access.token',
  refreshToken: 'mock.refresh.token',
};

const mockJwtPayload: JwtPayload = {
  sub: 'user-123',
  tenantId: 'tenant-456',
  role: UserRole.OWNER,
};

const mockRegisterDto: RegisterDto = {
  businessName: 'Spa ABC',
  slug: 'spa-abc',
  ownerName: 'Nguyen Van A',
  email: 'owner@spa-abc.com',
  password: 'password123',
};

const mockLoginDto: LoginDto = {
  slug: 'spa-abc',
  email: 'owner@spa-abc.com',
  password: 'password123',
};

// ─── Mock AuthService ─────────────────────────────────────────────────────────

const mockAuthService = {
  register: jest.fn(),
  login: jest.fn(),
  refresh: jest.fn(),
};

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe('AuthController', () => {
  let controller: AuthController;
  let authService: jest.Mocked<typeof mockAuthService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── Sanity check ───────────────────────────────────────────────────────────

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ─── register() ─────────────────────────────────────────────────────────────

  describe('register()', () => {
    it('should return tokens on successful registration', async () => {
      mockAuthService.register.mockResolvedValue(mockTokens);

      const result = await controller.register(mockRegisterDto);

      expect(result).toEqual(mockTokens);
      expect(authService.register).toHaveBeenCalledWith(mockRegisterDto);
      expect(authService.register).toHaveBeenCalledTimes(1);
    });

    it('should throw ConflictException when slug already exists', async () => {
      mockAuthService.register.mockRejectedValue(
        new ConflictException('Slug "spa-abc" đã được sử dụng'),
      );

      await expect(controller.register(mockRegisterDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should pass dto to AuthService without modification', async () => {
      mockAuthService.register.mockResolvedValue(mockTokens);

      await controller.register(mockRegisterDto);

      expect(authService.register).toHaveBeenCalledWith(
        expect.objectContaining({
          businessName: mockRegisterDto.businessName,
          slug: mockRegisterDto.slug,
          ownerName: mockRegisterDto.ownerName,
          email: mockRegisterDto.email,
          password: mockRegisterDto.password,
        }),
      );
    });
  });

  // ─── login() ────────────────────────────────────────────────────────────────

  describe('login()', () => {
    it('should return tokens on successful login', async () => {
      mockAuthService.login.mockResolvedValue(mockTokens);

      const result = await controller.login(mockLoginDto);

      expect(result).toEqual(mockTokens);
      expect(authService.login).toHaveBeenCalledWith(mockLoginDto);
      expect(authService.login).toHaveBeenCalledTimes(1);
    });

    it('should throw UnauthorizedException on invalid credentials', async () => {
      mockAuthService.login.mockRejectedValue(
        new UnauthorizedException('Email hoặc mật khẩu không đúng'),
      );

      await expect(controller.login(mockLoginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should pass dto to AuthService without modification', async () => {
      mockAuthService.login.mockResolvedValue(mockTokens);

      await controller.login(mockLoginDto);

      expect(authService.login).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: mockLoginDto.slug,
          email: mockLoginDto.email,
          password: mockLoginDto.password,
        }),
      );
    });
  });

  // ─── refresh() ──────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    it('should return new tokens on valid refresh token', async () => {
      mockAuthService.refresh.mockResolvedValue(mockTokens);

      const result = await controller.refresh(mockJwtPayload);

      expect(result).toEqual(mockTokens);
      expect(authService.refresh).toHaveBeenCalledWith(mockJwtPayload);
      expect(authService.refresh).toHaveBeenCalledTimes(1);
    });

    it('should throw UnauthorizedException when user no longer exists', async () => {
      mockAuthService.refresh.mockRejectedValue(
        new UnauthorizedException('User không tồn tại'),
      );

      await expect(controller.refresh(mockJwtPayload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should pass full jwt payload to AuthService', async () => {
      mockAuthService.refresh.mockResolvedValue(mockTokens);

      await controller.refresh(mockJwtPayload);

      expect(authService.refresh).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: mockJwtPayload.sub,
          tenantId: mockJwtPayload.tenantId,
          role: mockJwtPayload.role,
        }),
      );
    });
  });
});