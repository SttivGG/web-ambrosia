import { fixtureUser } from './auth-test-fixture.mjs';
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import assert from 'node:assert/strict';
loadEnvFile('.env');
const args = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infrastructure/docker-compose.yml',
];
const base = 'http://localhost:' + (process.env.GATEWAY_PORT || 8080);
const email = 'fase1b.' + randomBytes(8).toString('hex') + '@ambrosia.test';
const password = 'Inicial ' + randomBytes(18).toString('base64url') + ' 2026';
const nextPassword = 'Nueva ' + randomBytes(18).toString('base64url') + ' 2027';
const results = [];
let browser,
  context,
  stage = 'inicio';
function compose(...command) {
  return spawnSync('docker', [...args, ...command], {
    encoding: 'utf8',
    env: process.env,
  });
}
function sql(query) {
  const result = compose(
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
  assert.equal(result.status, 0, 'SQL de prueba debe terminar correctamente');
  return result.stdout.trim();
}
function pass(message) {
  results.push({ test: message, status: 'passed' });
  console.log('PASS ' + message);
}
async function waitReady(path) {
  for (let attempt = 0; attempt < 45; attempt++) {
    try {
      if ((await fetch(base + path, { signal: AbortSignal.timeout(3000) })).ok)
        return;
    } catch {
      /* Recovery pending. */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Readiness pendiente');
}
async function dashboard(page) {
  await page.waitForURL(/\/dashboard/);
  await page.getByRole('heading', { name: 'Inicio', exact: true }).waitFor();
}
async function signIn(page, passphrase = password) {
  await page.getByLabel('Correo', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(passphrase);
  await page
    .getByRole('button', { name: 'Iniciar sesión', exact: true })
    .click();
}
async function signOut(page) {
  const menu = page.locator('.user-menu');
  if (!(await menu.getAttribute('open')))
    await menu.locator('> summary').click();
  await page
    .getByRole('button', { name: 'Cerrar sesión', exact: true })
    .click();
  await page.waitForURL(/\/login/);
}
try {
  stage = 'bootstrap temporal';
  fixtureUser('create', email, password);
  stage = 'inicio de Chromium';
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [],
    external = [];
  page.on('pageerror', () => errors.push('JavaScript error'));
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== base) external.push('Origen ajeno');
  });
  stage = 'protección anónima';
  await page.goto(base + '/dashboard?view=health');
  await page.waitForURL(/\/login/);
  assert.equal(
    await page.getByRole('heading', { name: 'Inicio', exact: true }).count(),
    0,
  );
  assert.equal(
    new URL(page.url()).searchParams.get('returnTo'),
    '/dashboard?view=health',
  );
  pass('Dashboard anónimo redirige a login sin contenido protegido');
  stage = 'login incorrecto y teclado';
  await page.getByLabel('Correo', { exact: true }).focus();
  await page.keyboard.press('Tab');
  assert.equal(
    await page
      .locator('#password')
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await signIn(page, 'Incorrecta solo prueba 2026');
  await page
    .getByRole('alert')
    .filter({ hasText: 'Correo o contraseña incorrectos.' })
    .waitFor();
  await page
    .getByRole('button', { name: 'Mostrar contraseña', exact: true })
    .click();
  assert.equal(await page.locator('#password').getAttribute('type'), 'text');
  await page
    .getByRole('button', { name: 'Ocultar contraseña', exact: true })
    .click();
  pass('Error genérico, navegación por teclado y mostrar/ocultar');
  stage = 'login correcto';
  await signIn(page);
  await dashboard(page);
  assert.equal(new URL(page.url()).searchParams.get('view'), 'health');
  await page.getByText('Propietaria Fase 1B', { exact: true }).waitFor();
  await page
    .getByText('Propietario · Sesión activa', { exact: true })
    .waitFor();
  const cookies = await context.cookies();
  for (const name of ['ambrosia_access', 'ambrosia_refresh'])
    assert.equal(
      cookies.find((cookie) => cookie.name === name)?.httpOnly,
      true,
    );
  const me = await context.request.get(base + '/api/auth/me');
  assert.equal(me.status(), 200);
  assert.match(me.headers()['cache-control'], /no-store/);
  const publicUser = await me.json();
  assert.deepEqual(Object.keys(publicUser).sort(), [
    'displayName',
    'email',
    'id',
    'permissions',
    'role',
  ]);
  await page.reload();
  await dashboard(page);
  await page.goto(base + '/login');
  await dashboard(page);
  pass(
    'Login real con cookies HttpOnly, me, usuario/rol, returnTo interno y recarga',
  );
  stage = 'health real y responsive';
  await page.getByRole('button', { name: 'Actualizar estado' }).waitFor();
  assert.equal(await page.getByText('Disponible', { exact: true }).count(), 4);
  await page.getByRole('button', { name: 'Actualizar estado' }).click();
  await page.getByRole('button', { name: 'Actualizar estado' }).waitFor();
  assert.match(await page.getByRole('status').innerText(), /Colombia/);
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({
    path: 'artifacts/admin-desktop.png',
    fullPage: true,
  });
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.getByRole('button', { name: /^Menú/ }).click();
    assert.equal(
      await page
        .getByRole('button', { name: /^Menú/ })
        .getAttribute('aria-expanded'),
      'true',
    );
    await page.getByRole('button', { name: /^Menú/ }).click();
    for (const button of await page
      .locator('button:visible, summary:visible')
      .all()) {
      const box = await button.boundingBox();
      assert.ok(box && box.width >= 44 && box.height >= 44);
    }
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: 'artifacts/admin-mobile.png', fullPage: true });
  pass(
    'Cuatro servicios reales, actualización Colombia, menú móvil, 375×812 y 812×375 sin scroll y controles de 44px',
  );
  stage = 'caída y recuperación de servicios';
  assert.equal(compose('stop', 'finance-reporting-service').status, 0);
  await page.getByRole('button', { name: 'Actualizar estado' }).click();
  await page.getByRole('button', { name: 'Actualizar estado' }).waitFor();
  assert.equal(
    await page.getByText('No disponible', { exact: true }).count(),
    1,
  );
  assert.equal(compose('start', 'finance-reporting-service').status, 0);
  await waitReady('/api/finance/health/ready');
  await page.getByRole('button', { name: 'Actualizar estado' }).click();
  await page.getByRole('button', { name: 'Actualizar estado' }).waitFor();
  assert.equal(await page.getByText('Disponible', { exact: true }).count(), 4);
  assert.equal(compose('stop', 'identity-service').status, 0);
  await page.reload();
  await page
    .getByRole('heading', { name: 'No podemos verificar tu sesión' })
    .waitFor();
  assert.equal(
    await page.getByRole('heading', { name: 'Inicio', exact: true }).count(),
    0,
  );
  assert.ok(
    (await context.cookies()).some(
      (cookie) => cookie.name === 'ambrosia_refresh',
    ),
  );
  assert.equal(
    (await context.request.get(base + '/api/production/health/ready')).status(),
    200,
  );
  assert.equal(compose('start', 'identity-service').status, 0);
  await waitReady('/api/auth/health/ready');
  await page.getByRole('button', { name: 'Reintentar' }).click();
  await dashboard(page);
  pass(
    'Caídas reales: estados de finanzas, Identity bloquea el panel sin borrar cookies y producción sigue disponible; recuperación correcta',
  );
  stage = 'access firmado expirado';
  const access = (await context.cookies()).find(
    (cookie) => cookie.name === 'ambrosia_access',
  );
  assert.ok(access);
  // Test process only: signing material never leaves Identity; expired token is never logged.
  const expired = compose(
    'exec',
    '-T',
    '-e',
    'AUTH_TEST_ACCESS=' + access.value,
    'identity-service',
    'node',
    '-e',
    "const {createPrivateKey}=require('node:crypto'); const {SignJWT,decodeJwt}=require('jose'); const p=decodeJwt(process.env.AUTH_TEST_ACCESS); p.exp=Math.floor(Date.now()/1000)-60; p.iat=p.exp-900; new SignJWT(p).setProtectedHeader({alg:'RS256',kid:process.env.JWT_KEY_ID,typ:'JWT'}).sign(createPrivateKey(Buffer.from(process.env.JWT_PRIVATE_KEY_BASE64,'base64').toString())).then(t=>process.stdout.write(t));",
  );
  assert.equal(expired.status, 0);
  await context.addCookies([{ ...access, value: expired.stdout.trim() }]);
  assert.equal(
    (await context.request.get(base + '/api/auth/me')).status(),
    401,
  );
  let refreshes = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/auth/refresh') refreshes++;
  });
  await page.goto(base + '/dashboard');
  await dashboard(page);
  assert.equal(refreshes, 1);
  assert.equal(
    (await context.request.get(base + '/api/auth/me')).status(),
    200,
  );
  pass('Access firmado expirado se recupera con un solo refresh real');
  stage = 'access ausente';
  await context.clearCookies({ name: 'ambrosia_access' });
  await page.goto(base + '/dashboard');
  await dashboard(page);
  assert.equal(refreshes, 2);
  pass('Access eliminado por expiración del navegador también se recupera');
  stage = 'refresh inválido';
  const refresh = (await context.cookies()).find(
    (cookie) => cookie.name === 'ambrosia_refresh',
  );
  await context.addCookies([{ ...refresh, value: 'invalid-refresh-test' }]);
  await context.clearCookies({ name: 'ambrosia_access' });
  await page.goto(base + '/dashboard');
  await page.waitForURL(/\/login/);
  assert.equal(refreshes, 3);
  pass('Refresh inválido termina en login sin bucle');
  stage = 'logout y open redirect';
  await signIn(page);
  await dashboard(page);
  await signOut(page);
  await page.goto(base + '/dashboard');
  await page.waitForURL(/\/login/);
  await page.goto(
    base + '/login?returnTo=' + encodeURIComponent('https://example.org/'),
  );
  await signIn(page);
  await dashboard(page);
  assert.equal(new URL(page.url()).origin, base);
  pass('Logout protege navegación posterior y returnTo externo es rechazado');
  stage = 'cambio de contraseña';
  await page.locator('.user-menu > summary').click();
  await page.getByText('Cambiar contraseña', { exact: true }).click();
  await page.getByLabel('Contraseña actual', { exact: true }).fill(password);
  await page.getByLabel('Contraseña nueva', { exact: true }).fill(nextPassword);
  await page
    .getByLabel('Confirmar contraseña', { exact: true })
    .fill(nextPassword);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await page.waitForURL(/reason=password-changed/);
  await page
    .getByText('Contraseña actualizada. Inicia sesión nuevamente.', {
      exact: true,
    })
    .waitFor();
  await signIn(page, password);
  await page
    .getByRole('alert')
    .filter({ hasText: 'Correo o contraseña incorrectos.' })
    .waitFor();
  await signIn(page, nextPassword);
  await dashboard(page);
  pass(
    'Cambio confirmado de contraseña revoca sesión y exige la contraseña nueva',
  );
  stage = 'almacenamiento y errores';
  assert.deepEqual(
    await page.evaluate(() => ({
      local: window.localStorage.length,
      session: window.sessionStorage.length,
    })),
    { local: 0, session: 0 },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await signOut(page);
  pass(
    'Sin tokens en Web Storage, errores JavaScript ni peticiones a puertos internos',
  );
} catch {
  results.push({ test: stage, status: 'failed' });
  console.error('FAIL navegador: ' + stage + ' (detalles sensibles omitidos)');
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (
    compose('start', 'identity-service', 'finance-reporting-service').status !==
    0
  )
    process.exitCode = 1;
  try {
    sql(
      `DELETE FROM "AuthAuditLog" WHERE "userId" IN (SELECT id FROM "User" WHERE email='${email}'); DELETE FROM "RefreshSession" WHERE "userId" IN (SELECT id FROM "User" WHERE email='${email}'); DELETE FROM "User" WHERE email='${email}';`,
    );
    assert.equal(
      sql(`SELECT COUNT(*) FROM "User" WHERE email='${email}';`),
      '0',
    );
    pass('Usuario temporal y sus sesiones eliminados');
  } catch {
    console.error('FAIL limpieza de usuario temporal');
    process.exitCode = 1;
  }
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(
    'artifacts/ui-verification.json',
    JSON.stringify({ origin: base, results }, null, 2),
  );
}
