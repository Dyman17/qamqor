import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import {
  RegisterDto,
  LoginUserDto,
  PasswordResetRequestDto,
  PasswordResetConfirmDto,
  AcceptInvitationDto,
} from './dto/auth.dto';
import { generateToken, hashToken, normalizeEmail } from '../common/tokens';
import { MAILER, Mailer } from '../mail/mailer';
import { passwordResetMail, pickLang } from '../mail/templates';

export const BCRYPT_COST = 12;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const INVALID_LINK = 'Ссылка недействительна или срок её действия истёк';

export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
}
export interface MembershipDto {
  farmId: string;
  farmName: string;
  role: 'OWNER' | 'WORKER';
}

let dummyHash: Promise<string> | null = null;
/** Compared against when the user does not exist, so both failures cost the same. */
const getDummyHash = () => (dummyHash ??= bcrypt.hash('qamqor-dummy-password', BCRYPT_COST));

function isUniqueViolation(e: any): boolean {
  return e?.code === 'P2002';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly config: ConfigService,
  ) {}

  private toUserDto(u: any): UserDto {
    return { id: u.id, email: u.email, fullName: u.fullName, phone: u.phone ?? null };
  }

  private async membershipsOf(userId: string): Promise<MembershipDto[]> {
    const rows = await this.prisma.farmMember.findMany({
      where: { userId },
      include: { farm: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({ farmId: r.farm.id, farmName: r.farm.name, role: r.role as 'OWNER' | 'WORKER' }));
  }

  private async authResponse(user: any) {
    return {
      token: this.generateToken(user.id, user.email),
      user: this.toUserDto(user),
      memberships: await this.membershipsOf(user.id),
    };
  }

  /** User, own farm and OWNER membership are created in one transaction. */
  async register(dto: RegisterDto) {
    const email = normalizeEmail(dto.email);
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);

    let user: any;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: { email, passwordHash, fullName: dto.fullName.trim(), phone: dto.phone?.trim() || null },
        });
        const farm = await tx.farm.create({
          data: {
            name: dto.farmName?.trim() || `Хозяйство ${dto.fullName.trim()}`,
            ownerId: u.id,
          },
        });
        await tx.farmMember.create({ data: { userId: u.id, farmId: farm.id, role: 'OWNER' } });
        return u;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Пользователь с таким email уже зарегистрирован');
      throw e;
    }
    return this.authResponse(user);
  }

  async login(dto: LoginUserDto) {
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(dto.email) } });
    const hash = user ? user.passwordHash : await getDummyHash();
    const ok = await bcrypt.compare(dto.password, hash);
    if (!user || !ok) throw new UnauthorizedException('Неверный email или пароль');
    return this.authResponse(user);
  }

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return { user: this.toUserDto(user), memberships: await this.membershipsOf(user.id) };
  }

  // ---------------------------------------------------------------- password reset

  /**
   * Always resolves the same way. The controller does not await it, so the response time
   * does not depend on whether the email exists.
   */
  async requestPasswordReset(dto: PasswordResetRequestDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: normalizeEmail(dto.email) } });
    if (!user) return;
    const token = generateToken();
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS) },
    });
    await this.mailer.send(
      passwordResetMail(pickLang(dto.lang), {
        to: user.email,
        token,
        baseUrl: this.config.get<string>('APP_BASE_URL'),
      }),
    );
  }

  async confirmPasswordReset(dto: PasswordResetConfirmDto): Promise<void> {
    const now = new Date();
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(dto.token) } });
    if (!row || row.usedAt || row.expiresAt <= now) throw new BadRequestException(INVALID_LINK);

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_COST);
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new BadRequestException(INVALID_LINK);
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash, passwordChangedAt: now } });
      await tx.passwordResetToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: now } });
    });
  }

  // ---------------------------------------------------------------- invitations

  /**
   * Accepts an invitation. Bound to the invited email: an authenticated caller must be that
   * user; an anonymous caller creates the account (password + fullName) only if none exists.
   */
  async acceptInvitation(dto: AcceptInvitationDto, authUser: { id: string; email: string } | null) {
    const now = new Date();
    const inv = await this.prisma.invitation.findUnique({ where: { tokenHash: hashToken(dto.token) } });
    if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt <= now) throw new BadRequestException(INVALID_LINK);

    let existing: any = null;
    if (authUser) {
      if (normalizeEmail(authUser.email) !== inv.email) {
        throw new ForbiddenException('Приглашение выдано на другой email');
      }
      existing = await this.prisma.user.findUnique({ where: { id: authUser.id } });
    } else {
      existing = await this.prisma.user.findUnique({ where: { email: inv.email } });
      if (existing) throw new UnauthorizedException('Войдите в аккаунт, чтобы принять приглашение');
      if (!dto.password || !dto.fullName) {
        throw new BadRequestException('Для нового пользователя нужны password и fullName');
      }
    }
    const passwordHash = existing ? null : await bcrypt.hash(dto.password!, BCRYPT_COST);

    let user: any;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.invitation.updateMany({
          where: { id: inv.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
          data: { acceptedAt: now },
        });
        if (claimed.count !== 1) throw new BadRequestException(INVALID_LINK);
        const u =
          existing ??
          (await tx.user.create({ data: { email: inv.email, passwordHash: passwordHash!, fullName: dto.fullName!.trim() } }));
        const member = await tx.farmMember.findUnique({
          where: { userId_farmId: { userId: u.id, farmId: inv.farmId } },
        });
        if (!member) await tx.farmMember.create({ data: { userId: u.id, farmId: inv.farmId, role: 'WORKER' } });
        return u;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException('Пользователь с таким email уже зарегистрирован');
      throw e;
    }
    return this.authResponse(user);
  }

  private generateToken(userId: string, email: string): string {
    return this.jwtService.sign({ sub: userId, email });
  }
}
