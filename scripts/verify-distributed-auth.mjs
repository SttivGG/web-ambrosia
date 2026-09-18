import { Buffer } from 'node:buffer';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fixtureUser } from './auth-test-fixture.mjs';
loadEnvFile('.env');
const base = 'http://localhost:' + (process.env.GATEWAY_PORT || 8080);
const routes = ['auth', 'inventory', 'production', 'finance'];
const results = [],
  users = [];
let browser,
  stage = 'inicio';
function compose(...args) {
  const r = spawnSync(
    'docker',
    [
      'compose',
      '--env-file',
      '.env',
      '-f',
      'infrastructure/docker-compose.yml',
      ...args,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, 'Comando Docker de prueba');
  return r.stdout;
}
function pass(test) {
  results.push({ test, status: 'passed' });
  console.log('PASS ' + test);
}
async function ready() {
  for (let i = 0; i < 45; i++) {
    try {
      if ((await fetch(base + '/api/auth/health/ready')).ok) return;
    } catch {
      /* restarting */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error('Identity no recuperada');
}
async function status(path, expected, headers = {}) {
  const r = await fetch(base + path, { headers, redirect: 'manual' });
  assert.equal(r.status, expected, 'Estado HTTP ' + path);
  return r;
}
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  });
  for (const route of routes) {
    await status('/api/' + route + '/health/live', 200);
    await status('/api/' + route + '/health/ready', 200);
    for (const suffix of [
      'docs/',
      'docs-json',
      'docs-yaml',
      'docs/swagger-ui.css',
      'docs/swagger-ui-init.js',
    ])
      await status('/api/' + route + '/' + suffix, 401);
  }
  pass('Health público; UI, JSON, YAML y assets Swagger anónimos 401');
  for (const role of ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']) {
    stage = 'rol ' + role;
    const email =
        'fase1c.' + randomBytes(10).toString('hex') + '@ambrosia.test',
      password = 'Temporal ' + randomBytes(20).toString('base64url') + ' 2026';
    users.push(email);
    fixtureUser('create', email, password, role);
    const context = await browser.newContext(),
      page = await context.newPage(),
      errors = [],
      requests = [];
    page.on('pageerror', () => errors.push('JS'));
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(base + '/login');
    await page.getByLabel('Correo', { exact: true }).fill(email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page
      .getByRole('button', { name: 'Iniciar sesión', exact: true })
      .click();
    await page.waitForURL(/\/dashboard/);
    await page.getByRole('heading', { name: 'Inicio', exact: true }).waitFor();
    const cookies = await context.cookies(),
      access = cookies.find((c) => c.name === 'ambrosia_access').value;
    for (const route of routes) {
      const expected =
        role === 'OWNER' || (role === 'ADMIN' && route !== 'auth') ? 200 : 403;
      const r = await page.goto(base + '/api/' + route + '/docs/');
      assert.equal(r.status(), expected);
      if (expected === 200) {
        await page.locator('.swagger-ui .info').waitFor();
        const doc = await context.request.get(
          base + '/api/' + route + '/docs-json',
        );
        assert.equal(doc.status(), 200);
        const data = await doc.json();
        assert.ok(data.components.securitySchemes.cookieAuth);
        assert.ok(data.components.securitySchemes.bearerAuth);
        // Execute the documented health route through Swagger's actual browser client.
        const operation = page
          .locator('.opblock')
          .filter({ hasText: '/api/v1/health/live' });
        await operation.locator('.opblock-summary').click();
        await operation.getByRole('button', { name: 'Try it out' }).click();
        const health = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname.endsWith('/api/v1/health/live') &&
            r.request().method() === 'GET',
        );
        await operation
          .getByRole('button', { name: 'Execute', exact: true })
          .click();
        assert.equal((await health).status(), 200);
      }
      await status('/api/' + route + '/docs-json', expected, {
        Authorization: 'Bearer ' + access,
      });
      await status('/api/' + route + '/docs/swagger-ui.css', expected, {
        Authorization: 'Bearer ' + access,
      });
    }
    assert.deepEqual(errors, []);
    assert.ok(
      requests.every(
        (u) =>
          new URL(u).origin === base &&
          !/[?&](token|access_token|jwt)=/i.test(u),
      ),
    );
    assert.deepEqual(
      await page.evaluate(() => ({
        local: window.localStorage.length,
        session: window.sessionStorage.length,
      })),
      { local: 0, session: 0 },
    );
    pass(
      role +
        ': login y dashboard, Swagger cookie/Bearer según matriz, navegador sin exposición',
    );
    if (role === 'OWNER') {
      stage = 'JWT inválidos y caché real';
      // Sign negative test fixtures inside Identity; the private key never leaves the container.
      const mutate = (kind) => {
        const code = `const {createPrivateKey}=require('node:crypto');const {SignJWT,decodeJwt}=require('jose');let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',async()=>{const {token,kind}=JSON.parse(s);const p=decodeJwt(token),h={alg:'RS256',kid:process.env.JWT_KEY_ID};if(kind==='exp')p.exp=1;if(kind==='iss')p.iss='https://invalid.test';if(kind==='aud')p.aud='invalid';if(kind==='kid')h.kid='unknown';if(kind==='alg')h.alg='RS512';process.stdout.write(await new SignJWT(p).setProtectedHeader(h).sign(createPrivateKey(Buffer.from(process.env.JWT_PRIVATE_KEY_BASE64,'base64').toString())));});`;
        const r = spawnSync(
          'docker',
          [
            'compose',
            '--env-file',
            '.env',
            '-f',
            'infrastructure/docker-compose.yml',
            'exec',
            '-T',
            'identity-service',
            'node',
            '-e',
            code,
          ],
          { encoding: 'utf8', input: JSON.stringify({ token: access, kind }) },
        );
        assert.equal(r.status, 0, 'Firma fixture');
        return r.stdout.trim();
      };
      for (const kind of ['exp', 'iss', 'aud', 'kid', 'alg']) {
        const invalid = mutate(kind);
        for (const route of routes)
          await status('/api/' + route + '/docs-json', 401, {
            Authorization: 'Bearer ' + invalid,
          });
      }
      const parts = access.split('.');
      parts[1] = Buffer.from('{}').toString('base64url');
      for (const route of routes) {
        await status('/api/' + route + '/docs-json', 401, {
          Authorization: 'Bearer ' + parts.join('.'),
        });
        await status('/api/' + route + '/docs-json', 401, {
          Authorization:
            'Bearer ' +
            cookies.find((c) => c.name === 'ambrosia_refresh').value,
        });
      }
      const bad = await context.request.post(base + '/api/auth/logout', {
        headers: { Origin: base, 'X-CSRF-Token': 'invalid' },
      });
      assert.equal(bad.status(), 403);
      // Swagger middleware also enforces CSRF on mutable requests before its handlers.
      for (const route of routes.slice(1))
        assert.equal(
          (
            await context.request.post(base + '/api/' + route + '/docs/', {
              headers: { Origin: base },
            })
          ).status(),
          403,
        );
      compose('stop', 'identity-service');
      for (const route of routes.slice(1)) {
        await status('/api/' + route + '/docs-json', 200, {
          Authorization: 'Bearer ' + access,
        });
        await status('/api/' + route + '/health/ready', 200);
      }
      compose('start', 'identity-service');
      await ready();
      pass(
        'JWT negativos rechazados, CSRF real rechazado y caché autentica sin Identity',
      );
    }
    const csrf = await (
      await context.request.get(base + '/api/auth/csrf')
    ).json();
    assert.equal(
      (
        await context.request.post(base + '/api/auth/logout', {
          headers: { Origin: base, 'X-CSRF-Token': csrf.csrfToken },
        })
      ).status(),
      200,
    );
    for (const route of routes)
      assert.equal(
        (await context.request.get(base + '/api/' + route + '/docs/')).status(),
        401,
      );
    pass(role + ': logout elimina acceso a Swagger');
    await context.close();
  }
} catch {
  results.push({ test: stage, status: 'failed' });
  console.error('FAIL ' + stage + ' (detalles sensibles omitidos)');
  process.exitCode = 1;
} finally {
  await browser?.close();
  try {
    compose('start', 'identity-service');
    await ready();
    for (const email of users) fixtureUser('delete', email);
    pass('Usuarios temporales eliminados e Identity restaurada');
  } catch {
    process.exitCode = 1;
    results.push({ test: 'limpieza', status: 'failed' });
  }
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(
    'artifacts/distributed-auth-verification.json',
    JSON.stringify(results, null, 2),
  );
}
