import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string; email: string; iat?: number; exp?: number }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('Пользователь не найден или сессия истекла');
    }

    // Tokens issued at or before the last password change (whole seconds) are no longer valid.
    if (user.passwordChangedAt) {
      const changedSec = Math.floor(user.passwordChangedAt.getTime() / 1000);
      if (typeof payload.iat !== 'number' || payload.iat <= changedSec) {
        throw new UnauthorizedException('Сессия устарела, войдите заново');
      }
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      tokenExp: typeof payload.exp === 'number' ? payload.exp : undefined,
    };
  }
}
