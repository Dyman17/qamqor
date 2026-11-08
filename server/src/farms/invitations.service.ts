import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { FarmsService } from './farms.service';
import { generateToken, hashToken, normalizeEmail } from '../common/tokens';
import { MAILER, Mailer } from '../mail/mailer';
import { invitationMail, inviteLink, pickLang } from '../mail/templates';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

export interface InvitationDto {
  id: string;
  email: string;
  status: InvitationStatus;
  expiresAt: string;
}

export function toInvitationDto(i: any, now = new Date()): InvitationDto {
  let status: InvitationStatus = 'PENDING';
  if (i.acceptedAt) status = 'ACCEPTED';
  else if (i.revokedAt) status = 'REVOKED';
  else if (i.expiresAt <= now) status = 'EXPIRED';
  return { id: i.id, email: i.email, status, expiresAt: i.expiresAt.toISOString() };
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly farms: FarmsService,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly config: ConfigService,
  ) {}

  async list(userId: string, farmId: string): Promise<InvitationDto[]> {
    await this.farms.requireOwner(userId, farmId);
    const rows = await this.prisma.invitation.findMany({ where: { farmId }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((r) => toInvitationDto(r));
  }

  async create(
    userId: string,
    farmId: string,
    emailRaw: string,
    lang?: string,
  ): Promise<InvitationDto & { delivered: boolean; inviteUrl?: string }> {
    const { farm } = await this.farms.requireOwner(userId, farmId);
    const email = normalizeEmail(emailRaw);

    const target = await this.prisma.user.findUnique({ where: { email } });
    if (target) {
      const member = await this.prisma.farmMember.findUnique({
        where: { userId_farmId: { userId: target.id, farmId } },
      });
      if (member) throw new ConflictException('Этот пользователь уже в хозяйстве');
    }

    const now = new Date();
    const token = generateToken();
    const inviter = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });

    const invitation = await this.prisma.$transaction(async (tx) => {
      // A new invitation replaces any pending one for the same email.
      await tx.invitation.updateMany({
        where: { farmId, email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      return tx.invitation.create({
        data: {
          farmId,
          email,
          tokenHash: hashToken(token),
          invitedById: userId,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        },
      });
    });

    const baseUrl = this.config.get<string>('APP_BASE_URL');
    // Without a real mail transport nothing is sent: the owner gets the link and passes it on by hand.
    if (this.mailer.status() === 'none') {
      this.logger.warn(`Invitation ${invitation.id} created but NOT emailed (no mail transport)`);
      return { ...toInvitationDto(invitation, now), delivered: false, inviteUrl: inviteLink(baseUrl, token) };
    }

    let delivered = true;
    try {
      await this.mailer.send(
        invitationMail(pickLang(lang), {
          to: email,
          farmName: farm.name,
          inviterName: inviter?.fullName ?? '',
          token,
          baseUrl,
        }),
      );
    } catch (e: any) {
      // The invitation exists and can be revoked/re-sent; do not fail the request on a mail outage.
      this.logger.error(`invitation mail failed: ${e?.message}`);
      delivered = false;
    }
    return delivered
      ? { ...toInvitationDto(invitation, now), delivered: true }
      : { ...toInvitationDto(invitation, now), delivered: false, inviteUrl: inviteLink(baseUrl, token) };
  }

  async revoke(userId: string, farmId: string, invitationId: string): Promise<void> {
    await this.farms.requireOwner(userId, farmId);
    const res = await this.prisma.invitation.updateMany({
      where: { id: invitationId, farmId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count !== 1) throw new NotFoundException('Приглашение не найдено');
  }
}
