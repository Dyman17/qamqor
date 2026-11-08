import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuthService } from '../src/auth/auth.service';
import { AuthController } from '../src/auth/auth.controller';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { RegisterDto, PasswordResetConfirmDto } from '../src/auth/dto/auth.dto';
import { RateLimitGuard, RateLimiterService, SlidingWindowLimiter } from '../src/common/rate-limit';
import { InvitationsService, toInvitationDto } from '../src/farms/invitations.service';
import { FarmsService } from '../src/farms/farms.service';
import { hashToken } from '../src/common/tokens';
import { passwordResetMail, invitationMail } from '../src/mail/templates';

const jwt: any = { sign: jest.fn(() => 'jwt-token') };
const config: any = { get: () => undefined };
const mailer = (status: 'none' | 'configured' = 'configured') => ({
  status: () => status,
  send: jest.fn(async (_m?: any) => undefined),
});

function authSvc(prisma: any, m = mailer()) {
  return { svc: new AuthService(prisma, jwt, m as any, config), mailer: m };
}

describe('password rules', () => {
  const base = { email: 'a@b.kz', fullName: 'A' };
  it.each([
    ['7 chars', 'a'.repeat(7), 1],
    ['8 chars', 'a'.repeat(8), 0],
    ['72 chars', 'a'.repeat(72), 0],
    ['73 chars', 'a'.repeat(73), 1],
    ['72 bytes limit counts bytes (37 x 2-byte chars)', 'ы'.repeat(37), 1],
  ])('register password %s', async (_n, password, errors) => {
    const res = await validate(plainToInstance(RegisterDto, { ...base, password }));
    expect(res.length).toBe(errors);
  });
  it('reset confirm uses the same rules', async () => {
    const bad = await validate(plainToInstance(PasswordResetConfirmDto, { token: 't'.repeat(30), newPassword: '12345' }));
    expect(bad.length).toBe(1);
  });
});

describe('register', () => {
  it('writes user, farm and OWNER membership only through one transaction; failure leaves nothing', async () => {
    const tx: any = {
      user: { create: jest.fn(async ({ data }: any) => ({ id: 'u1', ...data })) },
      farm: { create: jest.fn(async () => { throw new Error('farm insert failed'); }) },
      farmMember: { create: jest.fn() },
    };
    const prisma: any = {
      user: { create: jest.fn(), findUnique: jest.fn() },
      farm: { create: jest.fn() },
      farmMember: { create: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const { svc } = authSvc(prisma);
    await expect(svc.register({ email: 'A@b.kz', password: 'password1', fullName: 'A' } as any)).rejects.toThrow('farm insert failed');
    expect(prisma.user.create).not.toHaveBeenCalled(); // nothing outside the transaction
    expect(prisma.farm.create).not.toHaveBeenCalled();
    expect(tx.farmMember.create).not.toHaveBeenCalled();
  });

  it('success: OWNER membership, response has token, user and memberships (no role on user)', async () => {
    const tx: any = {
      user: { create: jest.fn(async ({ data }: any) => ({ id: 'u1', phone: null, ...data })) },
      farm: { create: jest.fn(async ({ data }: any) => ({ id: 'f1', ...data })) },
      farmMember: { create: jest.fn() },
    };
    const prisma: any = {
      farmMember: { findMany: jest.fn(async () => [{ role: 'OWNER', farm: { id: 'f1', name: 'F' } }]) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const { svc } = authSvc(prisma);
    const res: any = await svc.register({ email: 'A@B.kz', password: 'password1', fullName: 'A', farmName: 'F' } as any);
    expect(tx.farmMember.create).toHaveBeenCalledWith({ data: { userId: 'u1', farmId: 'f1', role: 'OWNER' } });
    expect(tx.user.create.mock.calls[0][0].data.email).toBe('a@b.kz');
    expect(tx.user.create.mock.calls[0][0].data.passwordHash).not.toContain('password1');
    expect(res.memberships).toEqual([{ farmId: 'f1', farmName: 'F', role: 'OWNER' }]);
    expect(res.user).not.toHaveProperty('passwordHash');
    expect(res.user).not.toHaveProperty('role');
  });

  it('duplicate email (unique violation) -> 409', async () => {
    const prisma: any = { $transaction: jest.fn(async () => { throw Object.assign(new Error('dup'), { code: 'P2002' }); }) };
    const { svc } = authSvc(prisma);
    await expect(svc.register({ email: 'a@b.kz', password: 'password1', fullName: 'A' } as any)).rejects.toThrow(ConflictException);
  });
});

describe('login', () => {
  it('same error for unknown user and wrong password', async () => {
    const prisma: any = { user: { findUnique: jest.fn(async () => null) } };
    const { svc } = authSvc(prisma);
    const a = await svc.login({ email: 'x@y.kz', password: 'whatever1' }).catch((e) => e);
    const bcrypt = require('bcrypt');
    prisma.user.findUnique.mockResolvedValue({ id: 'u', email: 'x@y.kz', passwordHash: await bcrypt.hash('right-password', 4) });
    const b = await svc.login({ email: 'x@y.kz', password: 'wrong-password' }).catch((e) => e);
    expect(a).toBeInstanceOf(UnauthorizedException);
    expect(b).toBeInstanceOf(UnauthorizedException);
    expect(a.message).toBe(b.message);
  });
});

describe('rate limiting', () => {
  it('11th login attempt within a minute is rejected with 429 RATE_LIMITED', () => {
    const guard = new RateLimitGuard(new Reflector(), new RateLimiterService());
    const ctx: any = {
      getHandler: () => AuthController.prototype.login,
      switchToHttp: () => ({ getRequest: () => ({ ip: '1.2.3.4', body: { email: 'A@b.kz' } }) }),
    };
    for (let i = 0; i < 10; i++) expect(guard.canActivate(ctx)).toBe(true);
    let err: any;
    try {
      guard.canActivate(ctx);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(429);
    expect(err.getResponse().code).toBe('RATE_LIMITED');
  });

  it('window slides; other email/IP unaffected', () => {
    let t = 0;
    const l = new SlidingWindowLimiter(() => t);
    for (let i = 0; i < 3; i++) expect(l.consume('k', 3, 1000).allowed).toBe(true);
    expect(l.consume('k', 3, 1000).allowed).toBe(false);
    expect(l.consume('other', 3, 1000).allowed).toBe(true);
    t = 1001;
    expect(l.consume('k', 3, 1000).allowed).toBe(true);
  });

  it('memory is bounded', () => {
    const l = new SlidingWindowLimiter(() => 0, 100);
    for (let i = 0; i < 1000; i++) l.consume('k' + i, 5, 60000);
    expect(l.size()).toBeLessThanOrEqual(101);
  });
});

describe('password reset', () => {
  function store() {
    const tokens: any[] = [];
    const user = { id: 'u1', email: 'a@b.kz', passwordChangedAt: null as Date | null, passwordHash: 'old' };
    const prisma: any = {
      user: {
        findUnique: jest.fn(async ({ where }: any) => (where.email === user.email ? user : null)),
        update: jest.fn(async ({ data }: any) => Object.assign(user, data)),
      },
      passwordResetToken: {
        create: jest.fn(async ({ data }: any) => { tokens.push({ id: 't' + tokens.length, usedAt: null, ...data }); }),
        findUnique: jest.fn(async ({ where }: any) => tokens.find((t) => t.tokenHash === where.tokenHash) ?? null),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const rows = tokens.filter(
            (t) => (where.id ? t.id === where.id : t.userId === where.userId) && t.usedAt === null && (!where.expiresAt || t.expiresAt > where.expiresAt.gt),
          );
          rows.forEach((r) => Object.assign(r, data));
          return { count: rows.length };
        }),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    return { prisma, tokens, user };
  }

  it('unknown email: nothing stored, no mail', async () => {
    const { prisma, tokens } = store();
    const { svc, mailer: m } = authSvc(prisma);
    await expect(svc.requestPasswordReset({ email: 'nobody@x.kz' })).resolves.toBeUndefined();
    expect(m.send).not.toHaveBeenCalled();
    expect(tokens).toHaveLength(0);
  });

  it('known email: hashed token stored, mail sent, raw token not stored; token works exactly once', async () => {
    const { prisma, tokens, user } = store();
    const { svc, mailer: m } = authSvc(prisma);
    await svc.requestPasswordReset({ email: 'A@b.kz', lang: 'en' });
    expect(m.send).toHaveBeenCalledTimes(1);
    const body: string = (m.send.mock.calls[0] as any)[0].text;
    const raw = /Reset code: (\S+)/.exec(body)![1];
    expect(tokens[0].tokenHash).toBe(hashToken(raw));
    expect(JSON.stringify(tokens)).not.toContain(raw);
    expect(tokens[0].expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3600_000);

    await svc.confirmPasswordReset({ token: raw, newPassword: 'new-password-1' });
    expect(user.passwordChangedAt).toBeInstanceOf(Date);
    expect(user.passwordHash).not.toBe('old');
    await expect(svc.confirmPasswordReset({ token: raw, newPassword: 'another-pass-2' })).rejects.toThrow(BadRequestException);
  });

  it('expired token rejected', async () => {
    const { prisma, tokens } = store();
    const { svc } = authSvc(prisma);
    tokens.push({ id: 'x', userId: 'u1', tokenHash: hashToken('t'.repeat(30)), expiresAt: new Date(Date.now() - 1000), usedAt: null });
    await expect(svc.confirmPasswordReset({ token: 't'.repeat(30), newPassword: 'new-password-1' })).rejects.toThrow(BadRequestException);
  });

  it('JWT issued before the password change is rejected, later one accepted', async () => {
    const changed = new Date();
    const prisma: any = { user: { findUnique: jest.fn(async () => ({ id: 'u1', email: 'a@b.kz', fullName: 'A', passwordChangedAt: changed })) } };
    const strat = new JwtStrategy({ getOrThrow: () => 'x'.repeat(40) } as any, prisma);
    const sec = Math.floor(changed.getTime() / 1000);
    await expect(strat.validate({ sub: 'u1', email: 'a@b.kz', iat: sec - 60 })).rejects.toThrow(UnauthorizedException);
    await expect(strat.validate({ sub: 'u1', email: 'a@b.kz', iat: sec })).rejects.toThrow(UnauthorizedException); // same second = rejected
    await expect(strat.validate({ sub: 'u1', email: 'a@b.kz', iat: sec + 1 })).resolves.toMatchObject({ id: 'u1' });
    prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.kz', fullName: 'A', passwordChangedAt: null });
    await expect(strat.validate({ sub: 'u1', email: 'a@b.kz', iat: 1 })).resolves.toMatchObject({ id: 'u1' });
  });
});

describe('invitations', () => {
  const farm = { id: 'F', name: 'Farm', ownerId: 'o' };

  function invSvc(role: 'OWNER' | 'WORKER' = 'OWNER') {
    const rows: any[] = [];
    const prisma: any = {
      farmMember: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.userId_farmId.userId === 'o' || where.userId_farmId.userId === 'w'
            ? { role: where.userId_farmId.userId === 'o' ? 'OWNER' : 'WORKER', farm }
            : null,
        ),
      },
      user: {
        findUnique: jest.fn(async ({ where }: any) => (where.id === 'o' ? { fullName: 'Owner' } : null)),
      },
      invitation: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          const r = rows.filter((x) => x.farmId === where.farmId && x.email === where.email && !x.acceptedAt && !x.revokedAt);
          r.forEach((x) => Object.assign(x, data));
          return { count: r.length };
        }),
        create: jest.fn(async ({ data }: any) => { const r = { id: 'i' + rows.length, createdAt: new Date(), acceptedAt: null, revokedAt: null, ...data }; rows.push(r); return r; }),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const m = mailer();
    const farms = new FarmsService(prisma);
    return { svc: new InvitationsService(prisma, farms, m as any, config), prisma, rows, m, role };
  }

  it('owner invites: stored hashed, 7-day expiry, mail sent with token', async () => {
    const { svc, rows, m } = invSvc();
    const dto = await svc.create('o', 'F', 'New@Mail.kz', 'kk');
    expect(dto).toMatchObject({ email: 'new@mail.kz', status: 'PENDING' });
    const days = (rows[0].expiresAt.getTime() - Date.now()) / 86400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
    const msg: any = m.send.mock.calls[0][0];
    expect(msg.to).toBe('new@mail.kz');
    const token = /: (\S+)/.exec(msg.text)![1];
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(rows[0]).not.toHaveProperty('token');
  });

  it('worker cannot invite or list (403)', async () => {
    const { svc } = invSvc();
    await expect(svc.create('w', 'F', 'a@b.kz')).rejects.toThrow(ForbiddenException);
    await expect(svc.list('w', 'F')).rejects.toThrow(ForbiddenException);
    await expect(svc.revoke('w', 'F', 'i0')).rejects.toThrow(ForbiddenException);
  });

  it('re-inviting revokes the previous pending invitation', async () => {
    const { svc, rows } = invSvc();
    await svc.create('o', 'F', 'a@b.kz');
    await svc.create('o', 'F', 'a@b.kz');
    expect(rows[0].revokedAt).toBeInstanceOf(Date);
    expect(rows[1].revokedAt).toBeNull();
  });

  it('status derivation', () => {
    const now = new Date();
    const future = new Date(now.getTime() + 1000);
    const past = new Date(now.getTime() - 1000);
    expect(toInvitationDto({ id: 'a', email: 'e', expiresAt: future }).status).toBe('PENDING');
    expect(toInvitationDto({ id: 'a', email: 'e', expiresAt: past }).status).toBe('EXPIRED');
    expect(toInvitationDto({ id: 'a', email: 'e', expiresAt: future, revokedAt: now }).status).toBe('REVOKED');
    expect(toInvitationDto({ id: 'a', email: 'e', expiresAt: future, acceptedAt: now }).status).toBe('ACCEPTED');
  });

  describe('accept', () => {
    const TOKEN = 'i'.repeat(32);
    function acceptSvc(inv: any, existingUser: any = null) {
      const members: any[] = [];
      const prisma: any = {
        invitation: {
          findUnique: jest.fn(async () => inv),
          updateMany: jest.fn(async () => {
            if (inv.acceptedAt || inv.revokedAt) return { count: 0 };
            inv.acceptedAt = new Date();
            return { count: 1 };
          }),
        },
        user: {
          findUnique: jest.fn(async () => existingUser),
          create: jest.fn(async ({ data }: any) => ({ id: 'new', phone: null, ...data })),
        },
        farmMember: {
          findUnique: jest.fn(async () => null),
          create: jest.fn(async ({ data }: any) => { members.push(data); }),
          findMany: jest.fn(async () => [{ role: 'WORKER', farm: { id: 'F', name: 'Farm' } }]),
        },
        $transaction: jest.fn(async (fn: any) => fn(prisma)),
      };
      const { svc } = authSvc(prisma);
      return { svc, prisma, members };
    }
    const fresh = () => ({ id: 'i1', farmId: 'F', email: 'new@mail.kz', expiresAt: new Date(Date.now() + 1e6), acceptedAt: null, revokedAt: null });

    it('new user: account created, role WORKER; token reusable never', async () => {
      const { svc, members, prisma } = acceptSvc(fresh());
      const res: any = await svc.acceptInvitation({ token: TOKEN, password: 'password-1', fullName: 'New' }, null);
      expect(members).toEqual([{ userId: 'new', farmId: 'F', role: 'WORKER' }]);
      expect(res.memberships[0].role).toBe('WORKER');
      expect(prisma.user.create.mock.calls[0][0].data.email).toBe('new@mail.kz');
      await expect(svc.acceptInvitation({ token: TOKEN, password: 'password-1', fullName: 'New' }, null)).rejects.toThrow(BadRequestException);
    });

    it('new user must supply password and fullName', async () => {
      const { svc } = acceptSvc(fresh());
      await expect(svc.acceptInvitation({ token: TOKEN }, null)).rejects.toThrow(BadRequestException);
    });

    it('authenticated user with a different email is refused (403); the same email works', async () => {
      const { svc, members } = acceptSvc(fresh(), { id: 'u2', email: 'new@mail.kz', phone: null });
      await expect(svc.acceptInvitation({ token: TOKEN }, { id: 'u9', email: 'other@mail.kz' })).rejects.toThrow(ForbiddenException);
      await svc.acceptInvitation({ token: TOKEN }, { id: 'u2', email: 'New@Mail.kz' });
      expect(members[0]).toMatchObject({ userId: 'u2', role: 'WORKER' });
    });

    it('anonymous accept for an existing account asks to log in (401)', async () => {
      const { svc } = acceptSvc(fresh(), { id: 'u2', email: 'new@mail.kz' });
      await expect(svc.acceptInvitation({ token: TOKEN, password: 'password-1', fullName: 'X' }, null)).rejects.toThrow(UnauthorizedException);
    });

    it('expired, revoked and unknown tokens -> 400', async () => {
      for (const inv of [
        { ...fresh(), expiresAt: new Date(Date.now() - 1000) },
        { ...fresh(), revokedAt: new Date() },
        { ...fresh(), acceptedAt: new Date() },
        null,
      ]) {
        const { svc } = acceptSvc(inv);
        await expect(svc.acceptInvitation({ token: TOKEN, password: 'password-1', fullName: 'X' }, null)).rejects.toThrow(BadRequestException);
      }
    });
  });
});

describe('mail templates', () => {
  it.each(['kk', 'ru', 'en'] as const)('%s templates carry the token and no secrets', (lang) => {
    const a = invitationMail(lang, { to: 'a@b.kz', farmName: 'F', inviterName: 'I', token: 'TOK' });
    const b = passwordResetMail(lang, { to: 'a@b.kz', token: 'TOK', baseUrl: 'https://app.example/' });
    expect(a.text).toContain('TOK');
    expect(b.text).toContain('https://app.example/reset-password?token=TOK');
    expect(a.subject.length).toBeGreaterThan(5);
  });
});
