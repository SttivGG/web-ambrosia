import { z } from 'zod';
import { hashPassword, validPassword, normalizeEmail } from '../auth/password';
import { audit } from '../audit/audit';
import type { PrismaService } from '../database/prisma.service';
export async function bootstrapOwner(
  db: PrismaService,
  email: string,
  displayName: string,
  password: string,
) {
  email = normalizeEmail(email);
  displayName = displayName.trim();
  if (
    !z.email().safeParse(email).success ||
    email.length > 254 ||
    displayName.length < 1 ||
    displayName.length > 100 ||
    !validPassword(password, email)
  )
    throw new Error('Datos de propietario inválidos');
  const passwordHash = await hashPassword(password);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(174201)) AS owner_bootstrap_lock`;
      if (await tx.user.count({ where: { role: 'OWNER' } }))
        throw new Error('Ya existe un OWNER');
      const user = await tx.user.create({
        data: { email, displayName, passwordHash, role: 'OWNER' },
      });
      await audit(tx, 'OWNER_BOOTSTRAPPED', true, user.id);
      return { id: user.id };
    },
    { timeout: 10000 },
  );
}
