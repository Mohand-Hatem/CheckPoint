import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../decorators/current-user.decorator';

interface JwtPayload {
  sub: string;
  companyId: string;
  email: string;
  role: string;
  permissions: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const secret = configService.get<string>('JWT_ACCESS_SECRET');
    // No fallback: a known default secret would let anyone forge tokens when the variable is missing.
    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is not set');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // companyId is required: tokens without it (issued before company scoping) are rejected.
    if (!payload.sub || !payload.email || !payload.companyId) {
      throw new UnauthorizedException('Invalid token payload');
    }

    // One cheap primary-key lookup per request makes "deactivated" immediate (not "within 15 minutes")
    // and proves the token's company really is the account's company (AC-REQ-006-07).
    const account = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { isActive: true, companyId: true, mustChangePassword: true },
    });
    if (!account || !account.isActive || account.companyId !== payload.companyId) {
      throw new UnauthorizedException('Account is inactive or does not match the token');
    }

    return {
      userId: payload.sub,
      companyId: payload.companyId,
      email: payload.email,
      role: payload.role,
      permissions: payload.permissions || [],
      mustChangePassword: account.mustChangePassword,
    };
  }
}
