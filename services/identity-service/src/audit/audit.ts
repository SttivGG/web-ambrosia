import type { AuditEvent, Prisma } from '../generated/prisma/client';

export interface AuditContext {
  correlationId?: string;
  userAgent?: string;
}

const sanitizeUserAgent = (value: string) =>
  Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .slice(0, 256);

export function audit(
  tx: Prisma.TransactionClient,
  eventType: AuditEvent,
  success: boolean,
  userId: string | null,
  context: AuditContext = {},
) {
  return tx.authAuditLog.create({
    data: {
      eventType,
      success,
      userId,
      correlationId: context.correlationId
        ?.replace(/[^a-zA-Z0-9._-]/g, '')
        .slice(0, 128),
      userAgent: context.userAgent
        ? sanitizeUserAgent(context.userAgent)
        : undefined,
      metadata: { version: 1 },
    },
  });
}
