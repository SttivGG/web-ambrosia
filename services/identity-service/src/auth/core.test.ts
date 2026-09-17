import { describe, it, expect } from 'vitest';
import {
  normalizeEmail,
  validPassword,
  hashPassword,
  verifyPassword,
} from './password';
import { claimsFor } from './keys.service';
import { ROLE_PERMISSIONS } from '../authorization/permissions';
import {
  failedAttempt,
  newRefreshToken,
  sessionState,
  tokenHash,
} from '../sessions/policy';
describe('identidad', () => {
  it('normaliza email', () =>
    expect(normalizeEmail('  Propietario@Ejemplo.COM ')).toBe(
      'propietario@ejemplo.com',
    ));
  it.each([
    ['corta1', false],
    ['abcdefghijkl', false],
    ['123456789012', false],
    [' frase segura 2026 ', true],
  ])('política %s', (password, expected) =>
    expect(validPassword(password, 'usuario@x.co')).toBe(expected),
  );
  it('rechaza una contraseña equivalente al correo', () =>
    expect(validPassword('usuario1@x.co', 'usuario1@x.co')).toBe(false));
  it('no recorta contraseña', () =>
    expect(validPassword('           1', 'x@y.co')).toBe(false));
  it('hash Argon2id y verificación', async () => {
    const encoded = await hashPassword('una contraseña 2026');
    expect(encoded).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(encoded, 'una contraseña 2026')).toBe(true);
    expect(await verifyPassword(encoded, 'otra contraseña 2026')).toBe(false);
  });
  it('claims contienen rol, permisos, sid y jti', () => {
    const claims = claimsFor(
      { id: '00000000-0000-4000-8000-000000000001', role: 'OPERATOR' },
      '00000000-0000-4000-8000-000000000002',
    );
    expect(claims).toMatchObject({
      typ: 'user',
      role: 'OPERATOR',
      sid: '00000000-0000-4000-8000-000000000002',
      permissions: ROLE_PERMISSIONS.OPERATOR,
    });
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('mapa de roles respeta permisos', () => {
    expect(ROLE_PERMISSIONS.OWNER).toHaveLength(8);
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain('users.manage');
    expect(ROLE_PERMISSIONS.OPERATOR).not.toContain('finance.read');
    expect(ROLE_PERMISSIONS.VIEWER).not.toContain('inventory.write');
  });
  it('sesión activa, vencida y reutilizada', () => {
    const future = new Date(Date.now() + 1000),
      past = new Date(Date.now() - 1000);
    expect(
      sessionState(
        { replacedBySessionId: null, revokedAt: null, expiresAt: future },
        new Date(),
      ),
    ).toBe('active');
    expect(
      sessionState(
        { replacedBySessionId: null, revokedAt: null, expiresAt: past },
        new Date(),
      ),
    ).toBe('invalid');
    expect(
      sessionState(
        { replacedBySessionId: 'id', revokedAt: new Date(), expiresAt: future },
        new Date(),
      ),
    ).toBe('reuse');
  });
  it('token opaco aleatorio y hash estable', () => {
    const token = newRefreshToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash(token)).toBe(tokenHash(token));
  });
  it('bloquea en quinto intento y reinicia tras bloqueo vencido', () => {
    const now = new Date();
    expect(failedAttempt(4, null, now, 5, 15)).toMatchObject({
      failedLoginAttempts: 5,
      status: 'LOCKED',
    });
    expect(
      failedAttempt(5, new Date(now.getTime() - 1), now, 5, 15),
    ).toMatchObject({
      failedLoginAttempts: 1,
      status: 'ACTIVE',
      lockedUntil: null,
    });
  });
});
