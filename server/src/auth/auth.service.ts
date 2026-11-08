import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, LoginUserDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });

    if (existing) {
      throw new ConflictException('Пользователь с таким email уже зарегистрирован');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase().trim(),
        passwordHash,
        fullName: dto.fullName.trim(),
        phone: dto.phone?.trim(),
      },
    });

    // Create default farm for user
    const farm = await this.prisma.farm.create({
      data: {
        name: dto.farmName?.trim() || `Хозяйство ${dto.fullName}`,
        description: 'Основное фермерское хозяйство',
        ownerId: user.id,
      },
    });

    await this.prisma.farmMember.create({
      data: {
        userId: user.id,
        farmId: farm.id,
        role: 'OWNER',
      },
    });

    const token = this.generateToken(user.id, user.email);

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        farmId: farm.id,
        farmName: farm.name,
      },
    };
  }

  async login(dto: LoginUserDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
      include: {
        farmMembers: {
          include: { farm: true },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    const token = this.generateToken(user.id, user.email);
    const primaryFarm = user.farmMembers[0]?.farm;

    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        farmId: primaryFarm?.id,
        farmName: primaryFarm?.name,
      },
    };
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        farmMembers: {
          include: { farm: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      farms: user.farmMembers.map((fm) => ({
        id: fm.farm.id,
        name: fm.farm.name,
        role: fm.role,
      })),
    };
  }

  private generateToken(userId: string, email: string): string {
    return this.jwtService.sign({
      sub: userId,
      email,
    });
  }
}

