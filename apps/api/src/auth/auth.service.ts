import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private generateTokenString(): string {
    return randomBytes(32).toString('hex');
  }

  private getRefreshTokenExpiry(): Date {
    const days = parseInt(
      this.configService.get<string>('REFRESH_TOKEN_EXPIRES_DAYS', '30'),
      10,
    );
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + days);
    return expiry;
  }

  async login(dto: LoginDto, userAgent?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.active) {
      throw new UnauthorizedException('Account has been deactivated');
    }

    const isPasswordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role.code,
      permissions: user.role.permissions.map((p) => p.permission),
    };

    const accessToken = await this.jwtService.signAsync(payload);

    const rawRefreshToken = this.generateTokenString();
    const tokenHash = this.hashToken(rawRefreshToken);
    const familyId = randomUUID();
    const expiresAt = this.getRefreshTokenExpiry();

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash,
        expiresAt,
        userAgent,
      },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role.code,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  async refresh(dto: RefreshTokenDto, userAgent?: string) {
    const tokenHash = this.hashToken(dto.refreshToken);

    const existingToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            role: {
              include: {
                permissions: true,
              },
            },
          },
        },
      },
    });

    if (!existingToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Reuse detection (theft): Revoke the entire token family
    if (existingToken.revokedAt !== null) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existingToken.familyId },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException(
        'Refresh token reuse detected. All sessions in this family revoked.',
      );
    }

    if (existingToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    if (!existingToken.user.active) {
      throw new UnauthorizedException('User account has been deactivated');
    }

    // Token rotation: Issue new token in same family and revoke current
    const newRawRefreshToken = this.generateTokenString();
    const newTokenHash = this.hashToken(newRawRefreshToken);
    const expiresAt = this.getRefreshTokenExpiry();

    const [newToken] = await this.prisma.$transaction([
      this.prisma.refreshToken.create({
        data: {
          userId: existingToken.userId,
          familyId: existingToken.familyId,
          tokenHash: newTokenHash,
          expiresAt,
          userAgent,
        },
      }),
      this.prisma.refreshToken.update({
        where: { id: existingToken.id },
        data: {
          revokedAt: new Date(),
        },
      }),
    ]);

    await this.prisma.refreshToken.update({
      where: { id: existingToken.id },
      data: { replacedBy: newToken.id },
    });

    const payload = {
      sub: existingToken.user.id,
      email: existingToken.user.email,
      role: existingToken.user.role.code,
      permissions: existingToken.user.role.permissions.map((p) => p.permission),
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      refreshToken: newRawRefreshToken,
    };
  }

  async logout(dto: RefreshTokenDto) {
    const tokenHash = this.hashToken(dto.refreshToken);

    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (token) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: token.familyId },
        data: { revokedAt: new Date() },
      });
    }

    return { success: true, message: 'Logged out successfully' };
  }
}
