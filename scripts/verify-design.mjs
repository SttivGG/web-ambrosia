// Visual regression harness: local fixtures only, no database or real credentials.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const artifacts = resolve('artifacts/dakadesing');
mkdirSync(artifacts, { recursive: true });
const user = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Equipo Ambrosia',
  email: 'diseno@example.test',
  role: 'OWNER',
  permissions: ['inventory.read', 'inventory.write'],
};
const record = {
  id: '22222222-2222-4222-8222-222222222222',
  active: true,
  version: 1,
  createdAt: '2026-09-19T00:00:00.000Z',
  updatedAt: '2026-09-19T00:00:00.000Z',
  archivedAt: null,
};
const category = {
  ...record,
  name: 'Leche y cultivos',
  description: 'Ingredientes para cada preparación.',
  slug: 'leche-cultivos',
};
const item = {
  ...record,
  id: '33333333-3333-4333-8333-333333333333',
  sku: 'MAT-001',
  name: 'Leche entera',
  description: null,
  itemType: 'RAW_MATERIAL',
  categoryId: category.id,
  inventoryBaseUnit: 'MILLILITER',
  defaultOperationUnit: 'LITER',
  nominalCapacityValue: null,
  nominalCapacityUnit: null,
  minimumStockBase: null,
  barcode: null,
  trackInventory: true,
};
const supplier = {
  ...record,
  code: 'PROV-001',
  name: 'Lácteos de la Sabana',
  tradeName: null,
  identificationType: null,
  identificationNumber: null,
  contactName: 'Equipo comercial',
  email: 'contacto@example.test',
  phone: null,
  address: null,
  municipality: 'Bogotá',
  department: 'Bogotá D. C.',
  notes: null,
  items: [],
};
const list = (data) => ({
  data,
  pagination: {
    page: 1,
    pageSize: 20,
    totalItems: data.length,
    totalPages: data.length ? 1 : 0,
  },
});
const identity = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (
    request.url === '/api/v1/auth/me' &&
    request.headers.cookie?.includes('ambrosia_access=design-fixture')
  )
    response.end(JSON.stringify(user));
  else {
    response.statusCode = 401;
    response.end('{}');
  }
});
await new Promise((done) => identity.listen(0, '127.0.0.1', done));
// Reserve a free port before launching the isolated production frontend.
const reservation = createServer();
await new Promise((done) => reservation.listen(0, '127.0.0.1', done));
const port = reservation.address().port;
await new Promise((done) => reservation.close(done));
const base = `http://127.0.0.1:${port}`;
const frontend = spawn(
  process.execPath,
  [
    resolve('apps/admin-web/node_modules/next/dist/bin/next'),
    'start',
    '-H',
    '127.0.0.1',
    '-p',
    String(port),
  ],
  {
    cwd: resolve('apps/admin-web'),
    env: {
      ...process.env,
      IDENTITY_INTERNAL_URL: `http://127.0.0.1:${identity.address().port}`,
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let serverLog = '';
frontend.stdout.on('data', (data) => {
  serverLog += data;
});
frontend.stderr.on('data', (data) => {
  serverLog += data;
});
let browser;
const results = [];
const passed = (name) => {
  results.push(name);
  console.log('PASS ' + name);
};
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(base + '/health/live')).ok) {
        ready = true;
        break;
      }
    } catch {
      /* starting */
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  assert.ok(ready, 'Frontend listo');
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  });
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  let mutations = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', async (dialog) => {
    errors.push('Diálogo nativo inesperado');
    await dialog.dismiss();
  });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') mutations++;
    let body;
    if (url.pathname === '/api/auth/me') body = user;
    else if (url.pathname.endsWith('/health/ready')) {
      const service = {
        auth: 'identity-service',
        inventory: 'inventory-service',
        production: 'production-service',
        finance: 'finance-reporting-service',
      }[url.pathname.split('/')[2]];
      body = {
        service,
        status: 'ok',
        dependencies: { database: true, nats: true },
      };
    } else if (url.pathname.includes('/catalog/categories'))
      body = list([category]);
    else if (url.pathname.includes('/catalog/items')) body = list([item]);
    else if (url.pathname.endsWith('/suppliers/' + supplier.id))
      body = supplier;
    else if (url.pathname.includes('/suppliers')) body = list([supplier]);
    else throw new Error('Petición no prevista: ' + url.pathname);
    await route.fulfill({ json: body });
  });
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(base + '/login');
    await page.getByRole('heading', { name: 'Inicia sesión' }).waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.screenshot({
      path: `${artifacts}/login-${width}.png`,
      fullPage: true,
    });
  }
  passed('Login en escritorio y móvil sin desbordamiento');
  await context.addCookies([
    {
      name: 'ambrosia_access',
      value: 'design-fixture',
      url: base,
      httpOnly: true,
    },
  ]);
  for (const path of [
    '/dashboard',
    '/inventario/catalogo',
    '/inventario/proveedores',
  ]) {
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(base + path);
      await page.locator('.dashboard-main h1').waitFor();
      if (path.includes('catalogo'))
        await page.getByText('Leche entera', { exact: true }).waitFor();
      if (path.includes('proveedores'))
        await page.getByRole('heading', { name: supplier.name }).waitFor();
      if (path === '/dashboard')
        await page.getByRole('button', { name: 'Actualizar estado' }).waitFor();
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        path + ': overflow ' + width,
      );
      await page.screenshot({
        path: `${artifacts}/${path.split('/').pop()}-${width}.png`,
        fullPage: true,
      });
    }
  }
  passed('Inicio, catálogo y proveedores: 1440, 768 y 375 px');
  for (const path of ['/inventario/catalogo', '/inventario/proveedores']) {
    await page.goto(base + path);
    if (path.endsWith('catalogo')) {
      await page
        .getByRole('button', { name: 'Editar Leche entera', exact: true })
        .click();
      await page.locator('dialog input[name="name"]').fill('Nombre pendiente');
    } else {
      await page
        .getByRole('button', { name: 'Nuevo proveedor', exact: true })
        .click();
      await page.locator('#supplier-name').fill('Nombre pendiente');
    }
    const field = path.endsWith('catalogo')
      ? 'dialog input[name="name"]'
      : '#supplier-name';
    await page
      .locator('dialog')
      .getByRole('button', { name: 'Cancelar', exact: true })
      .click();
    await page
      .getByRole('dialog', { name: '¿Descartar los cambios?' })
      .waitFor();
    assert.equal(await page.locator('dialog[open]').count(), 0);
    assert.ok(
      await page
        .getByRole('button', { name: 'Seguir editando' })
        .evaluate((el) => el === document.activeElement),
    );
    await page.screenshot({
      path: `${artifacts}/confirmacion-${path.split('/').pop()}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Seguir editando' }).click();
    await page.locator('dialog[open]').waitFor();
    assert.equal(await page.locator(field).inputValue(), 'Nombre pendiente');
    await page.keyboard.press('Escape');
    await page
      .getByRole('dialog', { name: '¿Descartar los cambios?' })
      .waitFor();
    await page.keyboard.press('Escape');
    await page.locator('dialog[open]').waitFor();
    assert.equal(await page.locator(field).inputValue(), 'Nombre pendiente');
    await page
      .locator('dialog')
      .getByRole('button', { name: 'Cancelar', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Descartar cambios', exact: true })
      .click();
    await page.locator('dialog').waitFor({ state: 'detached' });
  }
  assert.equal(mutations, 0);
  passed(
    'SweetAlert2: foco, seguir editando, Escape y descarte sin mutaciones',
  );
  assert.deepEqual(errors, []);
  passed('Sin errores JavaScript ni diálogos nativos');
  writeFileSync(
    `${artifacts}/results.json`,
    JSON.stringify({ fixtures: true, results }, null, 2),
  );
} finally {
  await browser?.close();
  frontend.kill();
  identity.close();
  writeFileSync(`${artifacts}/server.log`, serverLog);
}
