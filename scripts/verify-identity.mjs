import { fixtureUser } from './auth-test-fixture.mjs';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
loadEnvFile('.env');
const composeArgs = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infrastructure/docker-compose.yml',
];
const base =
  'http://127.0.0.1:' + (process.env.GATEWAY_PORT || 8080) + '/api/auth';
const origin = (
  process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:8080'
).split(',')[0];
const email = 'fase1a.' + randomBytes(10).toString('hex') + '@ambrosia.test';
const password = 'Inicial ' + randomBytes(15).toString('base64url') + ' 2026';
const nextPassword =
  'Renovada ' + randomBytes(15).toString('base64url') + ' 2027';
const report = [];
function compose(...args) {
  return spawnSync('docker', [...composeArgs, ...args], {
    encoding: 'utf8',
    env: process.env,
  });
}
function sql(query) {
  return compose(
    'exec',
    '-T',
    '-e',
    'PGPASSWORD=' + process.env.POSTGRES_ADMIN_PASSWORD,
    'postgres',
    'psql',
    '-h',
    '127.0.0.1',
    '-U',
    process.env.POSTGRES_ADMIN_USER,
    '-d',
    'ambrosia_identity',
    '-v',
    'ON_ERROR_STOP=1',
    '-Atc',
    query,
  );
}
function assertOk(result, label) {
  assert.equal(result.status, 0, label + ': ' + result.stderr);
}
class Jar {
  cookies = new Map();
  attributes = new Map();
  absorb(headers) {
    for (const line of headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';').map((v) => v.trim());
      const at = pair.indexOf('=');
      const name = pair.slice(0, at),
        value = pair.slice(at + 1);
      this.attributes.set(
        name,
        attrs.map((v) => v.toLowerCase()),
      );
      if (attrs.some((v) => /^max-age=0$/i.test(v)) || value === '')
        this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header(overrides = {}) {
    return [...new Map([...this.cookies, ...Object.entries(overrides)])]
      .map(([k, v]) => k + '=' + v)
      .join('; ');
  }
  clone() {
    const jar = new Jar();
    jar.cookies = new Map(this.cookies);
    jar.attributes = new Map(this.attributes);
    return jar;
  }
}
async function call(
  path,
  { method = 'GET', jar, body, csrf, refreshOverride } = {},
) {
  const headers = { 'x-request-id': 'identity-verification' };
  if (jar)
    headers.cookie = jar.header(
      refreshOverride ? { ambrosia_refresh: refreshOverride } : {},
    );
  if (method !== 'GET') headers.origin = origin;
  if (csrf) headers['x-csrf-token'] = csrf;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(body);
  }
  const response = await fetch(base + path, {
    method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  });
  if (jar) jar.absorb(response.headers);
  return response;
}
async function csrf(jar) {
  const response = await call('/csrf', { jar });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.csrfToken, jar.cookies.get('ambrosia_csrf'));
  return data.csrfToken;
}
async function login(jar, loginPassword = password, loginEmail = email) {
  const token = await csrf(jar);
  return call('/login', {
    method: 'POST',
    jar,
    csrf: token,
    body: { email: loginEmail, password: loginPassword },
  });
}
function record(name) {
  report.push({
    test: name,
    status: 'passed',
    timestamp: new Date().toISOString(),
  });
  console.log('PASS ' + name);
}
try {
  const migration = sql(
    `SELECT COUNT(*) FROM "_prisma_migrations" WHERE migration_name='20260916170000_identity_sessions' AND finished_at IS NOT NULL AND rolled_back_at IS NULL;`,
  );
  assertOk(migration, 'consulta migración');
  assert.equal(migration.stdout.trim(), '1');
  record('Migración versionada de identidad aplicada');
  const cleanupSql = `DELETE FROM "AuthAuditLog" WHERE "correlationId"='identity-verification' OR "userId" IN (SELECT id FROM "User" WHERE email='${email}'); DELETE FROM "RefreshSession" WHERE "userId" IN (SELECT id FROM "User" WHERE email='${email}'); DELETE FROM "User" WHERE email='${email}';`;
  assertOk(sql(cleanupSql), 'limpieza inicial acotada');
  const hasOwner =
    Number(
      sql(`SELECT COUNT(*) FROM "User" WHERE role='OWNER';`).stdout.trim(),
    ) > 0;
  const bootstrap = hasOwner
    ? null
    : compose(
        'exec',
        '-T',
        '-e',
        'NODE_ENV=test',
        '-e',
        'AUTH_TEST_OWNER_EMAIL=' + email,
        '-e',
        'AUTH_TEST_OWNER_NAME=Propietaria Fase 1A',
        '-e',
        'AUTH_TEST_OWNER_PASSWORD=' + password,
        'identity-service',
        'node',
        'dist/bootstrap-owner.js',
        '--test',
      );
  if (hasOwner) fixtureUser('create', email, password);
  else assertOk(bootstrap, 'bootstrap');
  const duplicate = compose(
    'exec',
    '-T',
    '-e',
    'NODE_ENV=test',
    '-e',
    'AUTH_TEST_OWNER_EMAIL=otro@ambrosia.test',
    '-e',
    'AUTH_TEST_OWNER_NAME=Otro',
    '-e',
    'AUTH_TEST_OWNER_PASSWORD=' + password,
    'identity-service',
    'node',
    'dist/bootstrap-owner.js',
    '--test',
  );
  assert.notEqual(duplicate.status, 0);
  record(
    hasOwner
      ? 'OWNER existente conservado, fixture aislado y bootstrap adicional rechazado'
      : 'Bootstrap crea un OWNER, audita y rechaza el segundo',
  );
  const missing = new Jar(),
    wrong = new Jar();
  const a = await login(missing, password, 'no-existe@ambrosia.test'),
    b = await login(wrong, 'Contraseña incorrecta 2026');
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  const [aError, bError] = await Promise.all([a.json(), b.json()]);
  assert.equal(aError.message, bError.message);
  assert.equal(aError.statusCode, bError.statusCode);
  record('Login incorrecto no revela existencia');
  const jar = new Jar();
  const ok = await login(jar);
  assert.equal(ok.status, 200);
  const user = await ok.json();
  assert.deepEqual(
    Object.keys(user).sort(),
    ['displayName', 'email', 'id', 'permissions', 'role'].sort(),
  );
  assert.equal(user.role, 'OWNER');
  for (const name of ['ambrosia_access', 'ambrosia_refresh'])
    assert.ok(jar.attributes.get(name)?.includes('httponly'));
  for (const name of ['ambrosia_access', 'ambrosia_refresh', 'ambrosia_csrf'])
    assert.ok(jar.attributes.get(name)?.includes('samesite=lax'));
  assert.ok(jar.attributes.get('ambrosia_refresh')?.includes('path=/api/auth'));
  assert.ok(jar.attributes.get('ambrosia_access')?.includes('path=/'));
  const access = jar.cookies.get('ambrosia_access');
  assert.ok(access);
  const [header, payload] = access
    .split('.')
    .slice(0, 2)
    .map((v) => JSON.parse(Buffer.from(v, 'base64url').toString()));
  assert.deepEqual(
    { alg: header.alg, kid: header.kid },
    { alg: 'RS256', kid: process.env.JWT_KEY_ID },
  );
  assert.equal(payload.typ, 'user');
  for (const claim of [
    'iss',
    'aud',
    'sub',
    'jti',
    'iat',
    'exp',
    'sid',
    'role',
    'permissions',
  ])
    assert.ok(claim in payload);
  assert.equal('accessToken' in user || 'refreshToken' in user, false);
  record('Login establece cookies y JWT RS256 con claims mínimos');
  const me = await call('/me', { jar });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), user);
  const badCsrf = await call('/refresh', {
    method: 'POST',
    jar,
    csrf: 'inválido',
  });
  assert.equal(badCsrf.status, 403);
  record('/me público mínimo y CSRF inválido rechazado');
  const oldRefresh = jar.cookies.get('ambrosia_refresh');
  const token = jar.cookies.get('ambrosia_csrf');
  const refresh = await call('/refresh', { method: 'POST', jar, csrf: token });
  assert.equal(refresh.status, 200);
  const rotated = jar.cookies.get('ambrosia_refresh');
  assert.notEqual(rotated, oldRefresh);
  const reuse = await call('/refresh', {
    method: 'POST',
    jar,
    csrf: jar.cookies.get('ambrosia_csrf'),
    refreshOverride: oldRefresh,
  });
  assert.equal(reuse.status, 401);
  const familyRevoked = await call('/refresh', {
    method: 'POST',
    jar,
    csrf: jar.cookies.get('ambrosia_csrf'),
    refreshOverride: rotated,
  });
  assert.equal(familyRevoked.status, 401);
  record('Refresh rota y reutilización revoca toda la familia');
  const lockedJar = new Jar();
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await login(lockedJar, 'Contraseña equivocada 2026')).status,
      401,
    );
  assert.equal((await login(lockedJar, password)).status, 401);
  assert.match(
    sql(
      `SELECT status::text || ':' || "failedLoginAttempts" FROM "User" WHERE email='${email}'`,
    ).stdout.trim(),
    /^LOCKED:5$/,
  );
  assertOk(
    sql(
      `UPDATE "User" SET status='ACTIVE', "failedLoginAttempts"=0, "lockedUntil"=NULL WHERE email='${email}'`,
    ),
    'desbloqueo prueba',
  );
  record('Cinco intentos bloquean temporalmente y cuenta bloqueada no ingresa');
  assertOk(
    sql(`UPDATE "User" SET status='INACTIVE' WHERE email='${email}'`),
    'inactivar',
  );
  assert.equal((await login(new Jar(), password)).status, 401);
  assertOk(
    sql(`UPDATE "User" SET status='ACTIVE' WHERE email='${email}'`),
    'activar',
  );
  record('Cuenta inactiva no inicia sesión');
  const logoutJar = new Jar();
  assert.equal((await login(logoutJar)).status, 200);
  const logoutCsrf = logoutJar.cookies.get('ambrosia_csrf');
  assert.equal(
    (
      await call('/logout', {
        method: 'POST',
        jar: logoutJar,
        csrf: logoutCsrf,
      })
    ).status,
    200,
  );
  const idempotentToken = await csrf(logoutJar);
  assert.equal(
    (
      await call('/logout', {
        method: 'POST',
        jar: logoutJar,
        csrf: idempotentToken,
      })
    ).status,
    200,
  );
  record('Logout revoca sesión y es idempotente');
  const first = new Jar(),
    second = new Jar();
  assert.equal((await login(first)).status, 200);
  assert.equal((await login(second)).status, 200);
  assert.equal(
    (
      await call('/logout-all', {
        method: 'POST',
        jar: first,
        csrf: first.cookies.get('ambrosia_csrf'),
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await call('/refresh', {
        method: 'POST',
        jar: second,
        csrf: second.cookies.get('ambrosia_csrf'),
      })
    ).status,
    401,
  );
  record('Logout-all revoca todas las sesiones');
  const changeJar = new Jar();
  assert.equal((await login(changeJar)).status, 200);
  const oldAccess = changeJar.cookies.get('ambrosia_access');
  assert.equal(
    (
      await call('/change-password', {
        method: 'POST',
        jar: changeJar,
        csrf: changeJar.cookies.get('ambrosia_csrf'),
        body: { currentPassword: password, newPassword: password },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call('/change-password', {
        method: 'POST',
        jar: changeJar,
        csrf: changeJar.cookies.get('ambrosia_csrf'),
        body: { currentPassword: password, newPassword: nextPassword },
      })
    ).status,
    200,
  );
  const oldJar = new Jar();
  oldJar.cookies.set('ambrosia_access', oldAccess);
  assert.equal((await call('/me', { jar: oldJar })).status, 401);
  assert.equal((await login(new Jar(), password)).status, 401);
  assert.equal((await login(new Jar(), nextPassword)).status, 200);
  record(
    'Cambio de contraseña evita reutilización, revoca sesiones y exige la nueva',
  );
  const jwks = await (await call('/.well-known/jwks.json')).json();
  assert.equal(jwks.keys.length, 1);
  assert.deepEqual(Object.keys(jwks.keys[0]).sort(), [
    'alg',
    'e',
    'kid',
    'kty',
    'n',
    'use',
  ]);
  assert.equal(jwks.keys[0].alg, 'RS256');
  assert.equal(
    (await call('/register', { method: 'POST', body: {} })).status,
    404,
  );
  record('JWKS solo publica clave pública y no existe registro público');
  const stored = sql(
    'SELECT COUNT(*) FROM "RefreshSession" WHERE length("tokenHash")=64 AND "tokenHash" ~ \'^[0-9a-f]+$\';',
  );
  assert.equal(
    stored.stdout.trim(),
    sql('SELECT COUNT(*) FROM "RefreshSession";').stdout.trim(),
  );
  assert.equal(
    sql(
      'SELECT COUNT(*) FROM "AuthAuditLog" WHERE metadata::text ~* \'(password|token|cookie|secret)\';',
    ).stdout.trim(),
    '0',
  );
  record('Refresh tokens hasheados y auditoría sanitizada');
} finally {
  const cleanup = sql(
    `DELETE FROM "AuthAuditLog" WHERE "correlationId"='identity-verification' OR "userId" IN (SELECT id FROM "User" WHERE email='${email}'); DELETE FROM "RefreshSession" WHERE "userId" IN (SELECT id FROM "User" WHERE email='${email}'); DELETE FROM "User" WHERE email='${email}';`,
  );
  if (cleanup.status !== 0) {
    console.error('No se pudo limpiar la identidad temporal de prueba');
    process.exitCode = 1;
  }
  await import('node:fs').then((fs) => {
    fs.mkdirSync('artifacts', { recursive: true });
    fs.writeFileSync(
      'artifacts/identity-verification.json',
      JSON.stringify(report, null, 2),
    );
  });
}
