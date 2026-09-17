import {
  Injectable,
  OnModuleInit,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../database/prisma.service';
import { KeysService } from './keys.service';
import {
  normalizeEmail,
  hashPassword,
  verifyPassword,
  validPassword,
} from './password';
import { publicUser } from '../authorization/permissions';
import { audit, type AuditContext } from '../audit/audit';
import {
  newRefreshToken,
  tokenHash,
  sessionState,
  failedAttempt,
} from '../sessions/policy';
import type { Prisma, User } from '../generated/prisma/client';

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash = '';
  constructor(
    private readonly db: PrismaService,
    private readonly config: ConfigService,
    private readonly keys: KeysService,
  ) {}
  async onModuleInit() {
    this.dummyHash = await hashPassword(randomUUID());
  }
  // All mutations for a user lock the same row: rotation, logout and password changes serialize.
  private lock(tx: Prisma.TransactionClient, id: string) {
    return tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id}::uuid FOR UPDATE`;
  }
  private async newSession(
    tx: Prisma.TransactionClient,
    user: User,
    context: AuditContext,
    familyId: string = randomUUID(),
    expiresAt = new Date(
      Date.now() +
        this.config.getOrThrow<number>('AUTH_REFRESH_TTL_SECONDS') * 1000,
    ),
  ) {
    const refresh = newRefreshToken();
    const session = await tx.refreshSession.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: tokenHash(refresh),
        expiresAt,
        userAgent: context.userAgent?.slice(0, 256),
        correlationId: context.correlationId?.slice(0, 128),
      },
    });
    return {
      session,
      refresh,
      access: await this.keys.sign(user, familyId),
      user: publicUser(user),
      expiresAt,
    };
  }
  async login(email: string, password: string, context: AuditContext) {
    const found = await this.db.user.findUnique({
      where: { email: normalizeEmail(email) },
    });
    if (!found) {
      await verifyPassword(this.dummyHash, password);
      await audit(this.db, 'LOGIN_FAILURE', false, null, context);
      throw new UnauthorizedException();
    }
    const result = await this.db.$transaction(
      async (tx) => {
        await this.lock(tx, found.id);
        const user = await tx.user.findUniqueOrThrow({
          where: { id: found.id },
        });
        const now = new Date();
        const matches = await verifyPassword(user.passwordHash, password);
        if (
          user.status === 'INACTIVE' ||
          (user.status === 'LOCKED' &&
            (!user.lockedUntil || user.lockedUntil > now)) ||
          (user.lockedUntil && user.lockedUntil > now)
        ) {
          await audit(tx, 'LOGIN_FAILURE', false, user.id, context);
          return null;
        }
        if (!matches) {
          const change = failedAttempt(
            user.failedLoginAttempts,
            user.lockedUntil,
            now,
            this.config.getOrThrow<number>('AUTH_MAX_FAILED_ATTEMPTS'),
            this.config.getOrThrow<number>('AUTH_LOCKOUT_MINUTES'),
          );
          await tx.user.update({ where: { id: user.id }, data: change });
          await audit(tx, 'LOGIN_FAILURE', false, user.id, context);
          if (change.status === 'LOCKED')
            await audit(tx, 'ACCOUNT_LOCKED', false, user.id, context);
          return null;
        }
        await tx.user.update({
          where: { id: user.id },
          data: {
            status: 'ACTIVE',
            failedLoginAttempts: 0,
            lockedUntil: null,
            lastLoginAt: now,
          },
        });
        const result = await this.newSession(tx, user, context);
        await audit(tx, 'LOGIN_SUCCESS', true, user.id, context);
        return result;
      },
      { timeout: 10000 },
    );
    if (!result) throw new UnauthorizedException();
    return result;
  }
  async refresh(token: string | undefined, context: AuditContext) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException();
    const found = await this.db.refreshSession.findUnique({
      where: { tokenHash: tokenHash(token) },
    });
    if (!found) throw new UnauthorizedException();
    const result = await this.db.$transaction(
      async (tx) => {
        await this.lock(tx, found.userId);
        const session = await tx.refreshSession.findUniqueOrThrow({
          where: { id: found.id },
        });
        const now = new Date();
        const state = sessionState(session, now);
        if (state === 'reuse') {
          await tx.refreshSession.updateMany({
            where: { familyId: session.familyId, revokedAt: null },
            data: { revokedAt: now },
          });
          await audit(
            tx,
            'REFRESH_REUSE_DETECTED',
            false,
            session.userId,
            context,
          );
          return null;
        }
        if (state !== 'active') return null;
        const user = await tx.user.findUniqueOrThrow({
          where: { id: session.userId },
        });
        if (
          user.status !== 'ACTIVE' ||
          (user.lockedUntil && user.lockedUntil > now)
        )
          return null;
        const next = await this.newSession(
          tx,
          user,
          context,
          session.familyId,
          session.expiresAt,
        );
        await tx.refreshSession.update({
          where: { id: session.id },
          data: {
            revokedAt: now,
            lastUsedAt: now,
            replacedBySessionId: next.session.id,
          },
        });
        await audit(tx, 'TOKEN_REFRESHED', true, user.id, context);
        return next;
      },
      { timeout: 10000 },
    );
    if (!result) throw new UnauthorizedException();
    return result;
  }
  async authenticate(token: string | undefined) {
    if (!token || token.length > 8192) throw new UnauthorizedException();
    let claims;
    try {
      claims = await this.keys.verify(token);
    } catch {
      throw new UnauthorizedException();
    }
    const user = await this.db.user.findUnique({ where: { id: claims.sub } });
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      user.role !== claims.role ||
      Math.floor(user.passwordChangedAt.getTime() / 1000) > claims.iat
    )
      throw new UnauthorizedException();
    const session = await this.db.refreshSession.findFirst({
      where: {
        userId: user.id,
        familyId: claims.sid,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (!session) throw new UnauthorizedException();
    return { user, claims };
  }
  async logout(token: string | undefined, context: AuditContext) {
    const session = token
      ? await this.db.refreshSession.findUnique({
          where: { tokenHash: tokenHash(token) },
        })
      : null;
    if (!session) return;
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, session.userId);
      await tx.refreshSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await audit(tx, 'LOGOUT', true, session.userId, context);
    });
  }
  async logoutAll(token: string | undefined, context: AuditContext) {
    const { user } = await this.authenticate(token);
    await this.db.$transaction(async (tx) => {
      await this.lock(tx, user.id);
      await tx.refreshSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await audit(tx, 'LOGOUT_ALL', true, user.id, context);
    });
  }
  async changePassword(
    token: string | undefined,
    currentPassword: string,
    newPassword: string,
    context: AuditContext,
  ) {
    const { user, claims } = await this.authenticate(token);
    if (!validPassword(newPassword, user.email))
      throw new BadRequestException();
    await this.db.$transaction(
      async (tx) => {
        await this.lock(tx, user.id);
        const current = await tx.user.findUniqueOrThrow({
          where: { id: user.id },
        });
        const session = await tx.refreshSession.findFirst({
          where: {
            familyId: claims.sid,
            userId: user.id,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        });
        if (
          !session ||
          current.status !== 'ACTIVE' ||
          !(await verifyPassword(current.passwordHash, currentPassword))
        )
          throw new UnauthorizedException();
        if (await verifyPassword(current.passwordHash, newPassword))
          throw new BadRequestException();
        await tx.user.update({
          where: { id: user.id },
          data: {
            passwordHash: await hashPassword(newPassword),
            passwordChangedAt: new Date(),
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        });
        await tx.refreshSession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await audit(tx, 'PASSWORD_CHANGED', true, user.id, context);
      },
      { timeout: 10000 },
    );
  }
}
