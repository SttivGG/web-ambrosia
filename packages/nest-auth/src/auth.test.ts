import 'reflect-metadata';
import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import {
  Logger,
  Controller,
  Get,
  Post,
  Module,
  type INestApplication,
  Catch,
  type ExceptionFilter,
  type ArgumentsHost,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response } from 'express';
import {
  authOptions,
  JwtVerifier,
  credentials,
  NestAuthModule,
  Public,
  RequirePermissions,
  CurrentAuth,
  AuthError,
  sendAuthError,
  swaggerProtection,
  type AuthContext,
} from './index';
const options = authOptions({
  AUTH_JWKS_URL: 'http://identity/.well-known/jwks.json',
  AUTH_ISSUER: 'https://ambrosia.test',
  AUTH_AUDIENCE: 'ambrosia',
  AUTH_ALLOWED_ORIGINS: 'http://localhost:8080',
  AUTH_JWKS_TIMEOUT_MS: 30,
});
let keys: Awaited<ReturnType<typeof generateKeyPair>>, other: typeof keys;
let jwks: object;
beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  other = await generateKeyPair('RS256');
  jwks = {
    keys: [
      {
        ...(await exportJWK(keys.publicKey)),
        alg: 'RS256',
        use: 'sig',
        kid: 'current',
      },
    ],
  };
});
const claims = () => ({
  iss: options.AUTH_ISSUER,
  aud: options.AUTH_AUDIENCE,
  sub: randomUUID(),
  jti: randomUUID(),
  sid: randomUUID(),
  typ: 'user',
  role: 'OWNER',
  permissions: ['inventory.read', 'inventory.write', 'users.manage'],
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 900,
});
async function token(
  overrides = {},
  header: Record<string, string> = { alg: 'RS256', kid: 'current' },
  key = keys.privateKey,
) {
  return new SignJWT({ ...claims(), ...overrides })
    .setProtectedHeader(header as { alg: string })
    .sign(key);
}
const request = (headers = {}, query = {}) => ({ headers, query }) as Request;
const mockFetch = () =>
  vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(JSON.stringify(jwks)));
// Use the platform Response for JWKS mocks, not the Express response type.
const Response = globalThis.Response;
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe('credenciales', () => {
  it('cookie', () =>
    expect(
      credentials(request({ cookie: 'ambrosia_access=abc' }), options),
    ).toEqual({ token: 'abc', method: 'cookie' }));
  it('Bearer', () =>
    expect(
      credentials(request({ authorization: 'Bearer abc' }), options).method,
    ).toBe('bearer'));
  it('duplicado idéntico conserva CSRF', () =>
    expect(
      credentials(
        request({ authorization: 'Bearer abc', cookie: 'ambrosia_access=abc' }),
        options,
      ).method,
    ).toBe('cookie'));
  it.each([
    {},
    { authorization: 'Basic abc' },
    { authorization: 'Bearer abc', cookie: 'ambrosia_access=def' },
    { cookie: 'ambrosia_access=abc; ambrosia_access=abc' },
    { cookie: 'ambrosia_access=%ZZ' },
    { cookie: 'ambrosia_access=' },
  ])('rechaza ausencia o ambigüedad %j', (headers) =>
    expect(() => credentials(request(headers), options)).toThrow(AuthError),
  );
  it('rechaza query aunque exista cabecera', () =>
    expect(() =>
      credentials(
        request({ authorization: 'Bearer abc' }, { access_token: 'abc' }),
        options,
      ),
    ).toThrow(AuthError));
  it('no acepta body', () =>
    expect(() =>
      credentials({ ...request(), body: { token: 'abc' } } as Request, options),
    ).toThrow(AuthError));
});
describe('JWT y JWKS', () => {
  it('fallo en frío no filtra URL ni errores sensibles en logs', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('secret-token-and-internal-url'));
    const verifier = new JwtVerifier(options, fetcher);
    expect(await verifier.isReady()).toBe(false);
    await expect(verifier.verify(await token())).rejects.toMatchObject({
      status: 503,
    });
    expect(warn.mock.calls).toEqual([
      [{ event: 'jwks.refresh.failed' }],
      [{ event: 'jwks.refresh.failed' }],
    ]);
  });
  it('firma y claims válidos', async () =>
    expect(
      (await new JwtVerifier(options, mockFetch()).verify(await token())).role,
    ).toBe('OWNER'));
  it.each([
    { exp: 1 },
    { iss: 'https://wrong.test' },
    { aud: 'wrong' },
    { nbf: Math.floor(Date.now() / 1000) + 3600 },
    { sub: 'bad' },
    { jti: 'bad' },
    { sid: 'bad' },
    { typ: 'refresh' },
    { role: 'UNKNOWN' },
    { permissions: ['arbitrary'] },
    { permissions: 'inventory.read' },
    { exp: undefined },
    { iat: undefined },
  ])('rechaza claims %j', async (override) =>
    expect(
      new JwtVerifier(options, mockFetch()).verify(await token(override)),
    ).rejects.toMatchObject({ status: 401 }),
  );
  it('firma incorrecta', async () =>
    expect(
      new JwtVerifier(options, mockFetch()).verify(
        await token({}, undefined, other.privateKey),
      ),
    ).rejects.toMatchObject({ status: 401 }));
  it('kid ausente', async () =>
    expect(
      new JwtVerifier(options, mockFetch()).verify(
        await token({}, { alg: 'RS256' }),
      ),
    ).rejects.toMatchObject({ status: 401 }));
  it.each(['none', 'HS256', 'RS512'])(
    'rechaza algoritmo %s sin consultar JWKS',
    async (alg) => {
      const fetcher = mockFetch();
      const t =
        Buffer.from(JSON.stringify({ alg, kid: 'current' })).toString(
          'base64url',
        ) + '.e30.';
      await expect(
        new JwtVerifier(options, fetcher).verify(t),
      ).rejects.toMatchObject({ status: 401 });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it('refresh opaco no es access', async () =>
    expect(
      new JwtVerifier(options, mockFetch()).verify('opaque-refresh'),
    ).rejects.toMatchObject({ status: 401 }));
  it('cache y single-flight', async () => {
    const fetcher = mockFetch(),
      verifier = new JwtVerifier(options, fetcher),
      t = await token();
    await Promise.all(Array.from({ length: 20 }, () => verifier.verify(t)));
    await verifier.verify(t);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('kid desconocido refresca una vez y no permite amplificación', async () => {
    const fetcher = mockFetch(),
      verifier = new JwtVerifier(options, fetcher);
    await verifier.verify(await token());
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1100);
    const t = await token({}, { alg: 'RS256', kid: 'unknown' });
    await Promise.all(
      Array.from({ length: 10 }, () =>
        verifier.verify(t).catch((e) => expect(e.status).toBe(401)),
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('caché válida tolera caída; vencida falla cerrada y readiness se recupera', async () => {
    const fetcher = mockFetch(),
      verifier = new JwtVerifier(options, fetcher),
      t = await token();
    await verifier.verify(t);
    fetcher.mockRejectedValue(new Error('internal sensitive URL'));
    expect(await verifier.isReady()).toBe(true);
    await verifier.verify(t);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 301000);
    expect(await verifier.isReady()).toBe(false);
    await expect(verifier.verify(t)).rejects.toMatchObject({ status: 503 });
    fetcher.mockImplementation(async () => new Response(JSON.stringify(jwks)));
    expect(await verifier.isReady()).toBe(true);
  });
  it('retira claves al renovar y admite rotación', async () => {
    const fetcher = mockFetch(),
      verifier = new JwtVerifier(options, fetcher),
      t = await token();
    await verifier.verify(t);
    fetcher.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            keys: [
              {
                ...(await exportJWK(other.publicKey)),
                alg: 'RS256',
                use: 'sig',
                kid: 'next',
              },
            ],
          }),
        ),
    );
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 301000);
    await verifier.verify(
      await token({}, { alg: 'RS256', kid: 'next' }, other.privateKey),
    );
    await expect(verifier.verify(t)).rejects.toMatchObject({ status: 401 });
  });
  it('timeout real aborta JWKS', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () =>
              reject(new Error('timeout')),
            ),
          ),
      );
    await expect(
      new JwtVerifier(options, fetcher).verify(await token()),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('rechaza claves privadas en JWKS', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          keys: [{ ...(jwks as { keys: object[] }).keys[0], d: 'private' }],
        }),
      ),
    );
    expect(await new JwtVerifier(options, fetcher).isReady()).toBe(false);
  });
});
@Controller()
class ProbeController {
  @Public() @Get('live') live() {
    return { ok: true };
  }
  @Get('missing') missing() {
    return {};
  }
  @RequirePermissions('inventory.read') @Get('read') read(
    @CurrentAuth() auth: AuthContext,
  ) {
    return {
      role: auth.role,
      immutable: Object.isFrozen(auth) && Object.isFrozen(auth.permissions),
      hasToken: 'token' in auth,
    };
  }
  @RequirePermissions('inventory.read', 'inventory.write')
  @Post('write')
  write() {
    return { ok: true };
  }
}
@Module({
  imports: [NestAuthModule.register(options)],
  controllers: [ProbeController],
})
class ProbeModule {}
@Catch()
class Filter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    sendAuthError(
      error instanceof AuthError ? error : new AuthError(401),
      host.switchToHttp().getResponse<Response>(),
    );
  }
}
describe('HTTP real de Nest con controladores exclusivos de pruebas', () => {
  let app: INestApplication, base: string;
  beforeAll(async () => {
    const fetcher = mockFetch();
    app = await NestFactory.create(ProbeModule, { logger: false });
    const verifier = app.get(JwtVerifier);
    Object.assign(verifier, { request: fetcher });
    app.use((_req: Request, res: Response, next: () => void) => {
      res.setHeader('X-Request-ID', 'test-id');
      next();
    });
    app.use(swaggerProtection(verifier));
    app.useGlobalFilters(new Filter());
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(async () => {
    await app.close();
  });
  it('público sin credenciales', async () =>
    expect((await fetch(base + '/live')).status).toBe(200));
  it('401 genérico con correlación', async () => {
    const r = await fetch(base + '/read');
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({
      statusCode: 401,
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Se requiere autenticación.',
      correlationId: 'test-id',
    });
  });
  it('ruta sin permisos deniega por defecto', async () =>
    expect(
      (
        await fetch(base + '/missing', {
          headers: { Authorization: 'Bearer ' + (await token()) },
        })
      ).status,
    ).toBe(403));
  it('cookie GET contexto inmutable sin JWT', async () => {
    const r = await fetch(base + '/read', {
      headers: { Cookie: 'ambrosia_access=' + (await token()) },
    });
    expect(await r.json()).toEqual({
      role: 'OWNER',
      immutable: true,
      hasToken: false,
    });
    expect(r.headers.get('cache-control')).toContain('no-store');
  });
  it('todos los permisos obligatorios', async () =>
    expect(
      (
        await fetch(base + '/write', {
          method: 'POST',
          headers: {
            Authorization:
              'Bearer ' + (await token({ permissions: ['inventory.read'] })),
          },
        })
      ).status,
    ).toBe(403));
  it('Bearer POST sin CSRF', async () =>
    expect(
      (
        await fetch(base + '/write', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + (await token()) },
        })
      ).status,
    ).toBe(201));
  const csrf = 'a'.repeat(43) + '.' + 'b'.repeat(43);
  it.each(['missing', 'mismatch', 'origin', 'valid', 'referer', 'both'])(
    'cookie CSRF %s',
    async (mode) => {
      const t = await token();
      const headers: Record<string, string> = {
        Cookie: 'ambrosia_access=' + t + '; ambrosia_csrf=' + csrf,
        Origin:
          mode === 'origin' ? 'http://evil.test' : 'http://localhost:8080',
      };
      if (mode !== 'missing')
        headers['X-CSRF-Token'] = mode === 'mismatch' ? 'invalid' : csrf;
      if (mode === 'referer') {
        delete headers.Origin;
        headers.Referer = 'http://localhost:8080/dashboard';
      }
      if (mode === 'both') {
        headers.Authorization = 'Bearer ' + t;
        delete headers['X-CSRF-Token'];
      }
      expect(
        (await fetch(base + '/write', { method: 'POST', headers })).status,
      ).toBe(['valid', 'referer'].includes(mode) ? 201 : 403);
    },
  );
  it.each(['VIEWER', 'OPERATOR'])('Swagger rechaza %s', async (role) =>
    expect(
      (
        await fetch(base + '/docs/swagger-ui.js', {
          headers: { Authorization: 'Bearer ' + (await token({ role })) },
        })
      ).status,
    ).toBe(403),
  );
  it('Swagger anónimo protege JSON y assets', async () => {
    for (const path of [
      '/docs/',
      '/docs-json',
      '/docs-yaml',
      '/docs/swagger-ui.js',
    ])
      expect((await fetch(base + path)).status).toBe(401);
  });
  it('errores nunca incluyen token ni claims', async () => {
    const t = await token({ exp: 1 });
    const r = await fetch(base + '/read', {
      headers: { Authorization: 'Bearer ' + t },
    });
    const body = await r.text();
    expect(body).not.toContain(t);
    expect(body).not.toContain('exp');
  });
});
