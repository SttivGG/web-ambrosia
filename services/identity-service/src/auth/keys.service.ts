import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPrivateKey, createPublicKey, randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { userClaimsV1Schema, type RoleV1 } from '@ambrosia/contracts';
import { ROLE_PERMISSIONS } from '../authorization/permissions';

export function claimsFor(user: { id: string; role: RoleV1 }, sid: string) {
  return {
    sub: user.id,
    typ: 'user' as const,
    sid,
    role: user.role,
    permissions: [...ROLE_PERMISSIONS[user.role]],
    jti: randomUUID(),
  };
}
@Injectable()
export class KeysService {
  readonly privateKey;
  readonly publicKey;
  readonly jwks;
  constructor(private readonly config: ConfigService) {
    try {
      this.privateKey = createPrivateKey(
        Buffer.from(
          config.getOrThrow<string>('JWT_PRIVATE_KEY_BASE64'),
          'base64',
        ).toString('utf8'),
      );
      this.publicKey = createPublicKey(
        Buffer.from(
          config.getOrThrow<string>('JWT_PUBLIC_KEY_BASE64'),
          'base64',
        ).toString('utf8'),
      );
      if (
        this.privateKey.asymmetricKeyType !== 'rsa' ||
        (this.privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 3072
      )
        throw new Error();
      const derived = createPublicKey(this.privateKey).export({
        format: 'jwk',
      });
      const given = this.publicKey.export({ format: 'jwk' });
      if (derived.n !== given.n || derived.e !== given.e) throw new Error();
      this.jwks = {
        keys: [
          {
            kty: 'RSA',
            n: given.n,
            e: given.e,
            kid: config.getOrThrow<string>('JWT_KEY_ID'),
            use: 'sig',
            alg: 'RS256',
          },
        ],
      };
    } catch {
      throw new Error(
        'Configuración inválida: par RSA JWT de al menos 3072 bits requerido',
      );
    }
  }
  async sign(user: { id: string; role: RoleV1 }, familyId: string) {
    return new SignJWT(claimsFor(user, familyId))
      .setProtectedHeader({
        alg: 'RS256',
        kid: this.config.getOrThrow<string>('JWT_KEY_ID'),
        typ: 'JWT',
      })
      .setIssuer(this.config.getOrThrow<string>('JWT_ISSUER'))
      .setAudience(this.config.getOrThrow<string>('JWT_AUDIENCE'))
      .setIssuedAt()
      .setExpirationTime(
        Math.floor(Date.now() / 1000) +
          this.config.getOrThrow<number>('JWT_ACCESS_TTL_SECONDS'),
      )
      .sign(this.privateKey);
  }
  async verify(token: string) {
    const { payload, protectedHeader } = await jwtVerify(
      token,
      this.publicKey,
      {
        algorithms: ['RS256'],
        issuer: this.config.getOrThrow<string>('JWT_ISSUER'),
        audience: this.config.getOrThrow<string>('JWT_AUDIENCE'),
        requiredClaims: ['exp', 'iat', 'sub', 'jti', 'sid'],
      },
    );
    if (protectedHeader.kid !== this.config.getOrThrow<string>('JWT_KEY_ID'))
      throw new Error('JWT inválido');
    return userClaimsV1Schema.parse(payload);
  }
}
