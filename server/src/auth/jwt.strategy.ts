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

  async validate(payload: { sub: string; email: string }) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        farmMembers: {
          include: { farm: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Пользователь не найден или сессия истекла');
    }

    const primaryFarm = user.farmMembers[0]?.farm;

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      farmId: primaryFarm?.id,
    };
  }
}

