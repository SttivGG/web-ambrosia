import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from 'jose';
import { userClaimsV1Schema } from '@ambrosia/contracts';
import type { AuthOptions } from './config';
import { AuthError, authEvent } from './errors';
type Key = Awaited<ReturnType<typeof importJWK>>;
export class JwtVerifier {
  private keys = new Map<string, Key>();
  private expiresAt = 0;
  private refreshedAt = 0;
  private pending?: Promise<void>;
  constructor(
    readonly options: AuthOptions,
    private readonly request: typeof fetch = fetch,
  ) {}
  private refresh(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.fetchKeys().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async fetchKeys() {
    try {
      const response = await this.request(this.options.AUTH_JWKS_URL, {
        signal: AbortSignal.timeout(this.options.AUTH_JWKS_TIMEOUT_MS),
        redirect: 'error',
      });
      if (!response.ok) throw new Error();
      // Bound response size before parsing untrusted key material.
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 65536) throw new Error();
          chunks.push(value);
        }
      } finally {
        await reader.cancel();
      }
      const data = JSON.parse(Buffer.concat(chunks).toString()) as {
        keys?: JWK[];
      };
      if (
        !Array.isArray(data.keys) ||
        !data.keys.length ||
        data.keys.length > 20
      )
        throw new Error();
      const keys = new Map<string, Key>();
      for (const jwk of data.keys) {
        if (
          jwk.kty !== 'RSA' ||
          jwk.alg !== 'RS256' ||
          jwk.use !== 'sig' ||
          typeof jwk.kid !== 'string' ||
          !/^[\w-]{1,128}$/.test(jwk.kid) ||
          !jwk.n ||
          !jwk.e ||
          Buffer.from(jwk.n, 'base64url').length < 256 ||
          ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some((k) => k in jwk) ||
          keys.has(jwk.kid)
        )
          throw new Error();
        keys.set(jwk.kid, await importJWK(jwk, 'RS256'));
      }
      this.keys = keys;
      this.refreshedAt = Date.now();
      this.expiresAt =
        this.refreshedAt + this.options.AUTH_JWKS_CACHE_TTL_SECONDS * 1000;
    } catch {
      authEvent('jwks.refresh.failed');
      throw new AuthError(503);
    }
  }
  async isReady(): Promise<boolean> {
    try {
      if (Date.now() >= this.expiresAt) await this.refresh();
      return this.keys.size > 0;
    } catch {
      return false;
    }
  }
  async verify(token: string) {
    try {
      const header = decodeProtectedHeader(token);
      if (
        header.alg !== 'RS256' ||
        typeof header.kid !== 'string' ||
        !/^[\w-]{1,128}$/.test(header.kid)
      )
        throw new AuthError(401);
      if (Date.now() >= this.expiresAt) await this.refresh();
      if (!this.keys.has(header.kid)) {
        // Global cooldown bounds random-kid amplification; concurrent refreshes share one promise.
        if (this.pending) await this.pending;
        else if (Date.now() - this.refreshedAt >= 1000) await this.refresh();
        if (!this.keys.has(header.kid)) {
          authEvent('jwks.key.unknown');
          throw new AuthError(401);
        }
      }
      const { payload } = await jwtVerify(token, this.keys.get(header.kid)!, {
        algorithms: ['RS256'],
        issuer: this.options.AUTH_ISSUER,
        audience: this.options.AUTH_AUDIENCE,
        requiredClaims: ['exp', 'iat', 'sub', 'jti', 'sid'],
      });
      return userClaimsV1Schema.parse(payload);
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(401);
    }
  }
}
