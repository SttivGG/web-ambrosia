import { URLSearchParams } from 'node:url';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { fixtureUser } from './auth-test-fixture.mjs';
loadEnvFile('.env');
const base = 'http://localhost:' + (process.env.GATEWAY_PORT || 8080),
  prefix = 'F3-' + randomBytes(8).toString('hex').toUpperCase();
const args = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infrastructure/docker-compose.yml',
];
const users = [],
  results = [],
  errors = [],
  requests = [];
let browser,
  activePage,
  stage = 'inicio';
function pass(test) {
  results.push({ test, status: 'passed' });
  console.log('PASS ' + test);
}
function compose(...command) {
  const r = spawnSync('docker', [...args, ...command], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(r.status, 0, 'Docker ' + command[0]);
  return r.stdout;
}
function inventory(code, input = {}) {
  const script = `const assert=require('node:assert/strict');const {PrismaService}=require('./dist/prisma.service');const {ConfigService}=require('@nestjs/config');let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',async()=>{const input=JSON.parse(text);const db=new PrismaService(new ConfigService({DATABASE_URL:process.env.DATABASE_URL}));try{${code}}catch(error){console.error(error.name,error.code??'verification');process.exitCode=1;}finally{await db.$disconnect();}});`;
  const r = spawnSync(
    'docker',
    [...args, 'exec', '-T', 'inventory-service', 'node', '-e', script],
    { encoding: 'utf8', input: JSON.stringify(input) },
  );
  assert.equal(r.status, 0, 'Verificación de Inventory: ' + r.stderr);
  return r.stdout;
}
async function api(
  context,
  path,
  method = 'GET',
  data,
  expected = 200,
  csrf = true,
) {
  const headers = { Origin: base, 'X-Request-ID': 'purchases-verification' };
  if (method !== 'GET' && csrf) {
    const token = await context.request.get(base + '/api/auth/csrf');
    assert.equal(token.status(), 200);
    headers['X-CSRF-Token'] = (await token.json()).csrfToken;
  }
  const r = await context.request.fetch(base + '/api/inventory/' + path, {
    method,
    data,
    headers,
  });
  assert.equal(r.status(), expected, method + ' ' + path);
  return r.json();
}
async function login(role) {
  const email = 'fase3.' + randomBytes(10).toString('hex') + '@ambrosia.test',
    password = 'Temporal ' + randomBytes(20).toString('base64url') + ' 2026';
  users.push(email);
  fixtureUser('create', email, password, role);
  const context = await browser.newContext(),
    page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(30000);
  page.on('pageerror', () => errors.push(role + ': JS'));
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(base + '/login?returnTo=%2Finventario%2Fcompras');
  await page.getByLabel('Correo', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Iniciar sesión', exact: true })
    .click();
  await page.waitForURL(/\/inventario\/compras/);
  return { context, page };
}
async function search(page, label, value, path, param = 'search') {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === path &&
      new URL(r.url()).searchParams.get(param) === value &&
      r.request().method() === 'GET',
  );
  const target = (await page.getByRole('dialog').count())
    ? page.getByRole('dialog')
    : page;
  await target.getByLabel(label, { exact: true }).fill(value);
  await response;
  await page.waitForFunction(
    () => !document.querySelector('.purchases [role="status"]'),
  );
}
try {
  mkdirSync('artifacts/phase3', { recursive: true });
  stage = 'PostgreSQL aislado';
  compose(
    'run',
    '--rm',
    '--no-deps',
    'inventory-migrate',
    'node',
    'scripts/prepare-purchases-isolated.mjs',
  );
  pass(
    'PostgreSQL aislado: migraciones, carreras, rollback, idempotencia y reconciliación',
  );
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  });
  const { context, page } = await login('OWNER');
  stage = 'API';
  const anonymous = await browser.newContext();
  await api(anonymous, 'purchases', 'GET', undefined, 401);
  await api(anonymous, 'inventory/stocks', 'GET', undefined, 401);
  await anonymous.close();
  const category = await api(
    context,
    'catalog/categories',
    'POST',
    { name: prefix },
    201,
  );
  const items = [];
  for (let i = 0; i < 2; i++)
    items.push(
      await api(
        context,
        'catalog/items',
        'POST',
        {
          sku: prefix + '-' + i,
          name: prefix + ' Artículo ' + i,
          categoryId: category.id,
          itemType: 'SUPPLY',
          inventoryBaseUnit: 'GRAM',
          defaultOperationUnit: 'GRAM',
        },
        201,
      ),
    );
  const supplier = await api(
    context,
    'suppliers',
    'POST',
    {
      code: prefix,
      name: prefix + ' Proveedor',
      itemIds: items.map((i) => i.id),
    },
    201,
  );
  const data = {
    supplierId: supplier.id,
    reference: prefix + '-API',
    purchasedAt: new Date().toISOString(),
    lines: items.map((i) => ({
      itemId: i.id,
      quantity: '2.5',
      unitCost: '100.01',
    })),
  };
  await api(context, 'purchases', 'POST', data, 403, false);
  for (const patch of [
    { lines: [] },
    { total: '1' },
    { supplierId: 'bad' },
    { lines: [{ itemId: items[0].id, quantity: '-1', unitCost: '2' }] },
    { lines: [{ itemId: items[0].id, quantity: '1', unitCost: '1.001' }] },
  ])
    await api(context, 'purchases', 'POST', { ...data, ...patch }, 400);
  await api(context, 'purchases/not-a-uuid', 'GET', undefined, 400);
  await api(
    context,
    'purchases',
    'POST',
    { ...data, supplierId: randomUUID() },
    404,
  );
  let p = await api(context, 'purchases', 'POST', data, 201);
  assert.equal(p.total, '500.06');
  await api(context, 'purchases', 'POST', data, 409);
  assert.equal(
    (await api(context, 'inventory/stocks/' + items[0].id)).quantity,
    '0',
  );
  p = await api(context, 'purchases/' + p.id, 'PATCH', {
    ...data,
    expectedVersion: p.version,
    notes: 'Editada',
  });
  await api(
    context,
    'purchases/' + p.id,
    'PATCH',
    { ...data, expectedVersion: 1 },
    409,
  );
  p = await api(context, 'purchases/' + p.id + '/receive', 'POST', {
    expectedVersion: p.version,
  });
  await api(
    context,
    'purchases/' + p.id + '/receive',
    'POST',
    { expectedVersion: p.version },
    409,
  );
  await api(
    context,
    'purchases/' + p.id,
    'PATCH',
    { ...data, expectedVersion: p.version },
    409,
  );
  await api(
    context,
    'catalog/items/' + items[0].id,
    'PATCH',
    {
      expectedVersion: items[0].version,
      inventoryBaseUnit: 'MILLILITER',
      defaultOperationUnit: 'MILLILITER',
    },
    409,
  );
  const operationId = randomUUID();
  await api(
    context,
    'inventory/adjustments',
    'POST',
    {
      itemId: items[0].id,
      type: 'ADJUSTMENT_OUT',
      quantity: '1',
      reason: 'Conteo de prueba',
      operationId,
    },
    201,
  );
  await api(
    context,
    'inventory/adjustments',
    'POST',
    {
      itemId: items[0].id,
      type: 'ADJUSTMENT_OUT',
      quantity: '1',
      reason: 'Conteo de prueba',
      operationId,
    },
    409,
  );
  await api(
    context,
    'purchases/' + p.id + '/cancel',
    'POST',
    { expectedVersion: p.version, reason: 'Sin saldo suficiente' },
    409,
  );
  await api(
    context,
    'inventory/adjustments',
    'POST',
    {
      itemId: items[0].id,
      type: 'ADJUSTMENT_IN',
      quantity: '1',
      reason: 'Reponer conteo',
      operationId: randomUUID(),
    },
    201,
  );
  p = await api(context, 'purchases/' + p.id + '/cancel', 'POST', {
    expectedVersion: p.version,
    reason: 'Reversión de prueba',
  });
  assert.equal(p.status, 'CANCELLED');
  assert.equal(
    (await api(context, 'inventory/stocks/' + items[0].id)).quantity,
    '0',
  );
  const filtered = await api(
    context,
    'purchases?' +
      new URLSearchParams({
        supplierId: supplier.id,
        status: 'CANCELLED',
        reference: prefix,
        pageSize: '1',
      }),
  );
  assert.equal(filtered.data.length, 1);
  assert.equal(filtered.pagination.totalItems, 1);
  const movements = await api(
    context,
    'inventory/movements?' +
      new URLSearchParams({
        itemId: items[0].id,
        type: 'REVERSAL',
        origin: 'PURCHASE',
        pageSize: '1',
        from: '2020-01-01T00:00:00Z',
      }),
  );
  assert.equal(movements.data[0].purchaseId, p.id);
  assert.ok(movements.data[0].reversesId);
  assert.ok(movements.data[0].actorId);
  await api(
    context,
    'inventory/movements/' + movements.data[0].id,
    'DELETE',
    undefined,
    404,
  );
  const swagger = await context.request.get(base + '/api/inventory/docs-json');
  assert.equal(swagger.status(), 200);
  const paths = (await swagger.json()).paths;
  for (const path of [
    '/api/v1/purchases',
    '/api/v1/purchases/{id}/receive',
    '/api/v1/inventory/stocks',
    '/api/v1/inventory/movements',
    '/api/v1/inventory/adjustments',
  ])
    assert.ok(paths[path], path);
  assert.equal(
    paths['/api/v1/purchases'].post.requestBody.content['application/json']
      .schema.additionalProperties,
    false,
  );
  assert.ok(
    JSON.stringify(paths['/api/v1/purchases'].post.responses['401']).includes(
      'AUTHENTICATION_REQUIRED',
    ),
  );
  assert.equal(
    paths['/api/v1/purchases'].post.requestBody.content['application/json']
      .schema.example.lines[0].unitCost,
    '1200.50',
  );
  pass(
    'API real: contratos, decimal, estados, versiones, CSRF, filtros, historial y Swagger',
  );
  stage = 'navegador compra completa';
  await page.getByRole('button', { name: 'Nueva compra', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await search(page, 'Buscar proveedor', prefix, '/api/inventory/suppliers');
  await dialog
    .getByRole('button', { name: prefix + ' — ' + supplier.name, exact: true })
    .click();
  await dialog.getByLabel('Referencia', { exact: true }).fill(prefix + '-UI');
  await dialog
    .getByRole('button', {
      name: 'Agregar ' + items[0].sku + ' — ' + items[0].name,
      exact: true,
    })
    .click();
  await dialog
    .getByLabel('Cantidad — ' + items[0].name + ' (g)', { exact: true })
    .fill('7.5');
  await dialog
    .getByLabel('Costo unitario — ' + items[0].name + ' (COP)', { exact: true })
    .fill('0.15');
  await dialog
    .getByRole('button', { name: 'Guardar borrador', exact: true })
    .click();
  await dialog.waitFor({ state: 'hidden' });
  await search(
    page,
    'Buscar referencia',
    prefix + '-UI',
    '/api/inventory/purchases',
    'reference',
  );
  await page
    .locator('.purchase-state')
    .filter({ hasText: 'Borrador' })
    .waitFor();
  // Concurrent edit keeps local input and requires explicit version adoption.
  await page
    .getByRole('button', { name: 'Editar borrador', exact: true })
    .click();
  dialog = page.getByRole('dialog');
  await dialog.getByText('Seleccionado:', { exact: false }).waitFor();
  await dialog
    .getByLabel('Observaciones', { exact: true })
    .fill('Mis observaciones');
  let ui = (await api(context, 'purchases?reference=' + prefix + '-UI'))
    .data[0];
  await api(context, 'purchases/' + ui.id, 'PATCH', {
    supplierId: ui.supplierId,
    reference: ui.reference,
    purchasedAt: ui.purchasedAt,
    lines: ui.lines.map((l) => ({
      itemId: l.itemId,
      quantity: l.quantity,
      unitCost: l.unitCost,
    })),
    expectedVersion: ui.version,
    notes: 'Edición externa',
  });
  await dialog
    .getByRole('button', { name: 'Guardar borrador', exact: true })
    .click();
  await dialog.getByRole('heading', { name: 'La compra cambió' }).waitFor();
  assert.equal(
    await dialog.getByLabel('Observaciones', { exact: true }).inputValue(),
    'Mis observaciones',
  );
  await dialog
    .getByRole('button', {
      name: 'Conservar mis cambios y adoptar versión actual',
      exact: true,
    })
    .click();
  await dialog
    .getByRole('button', { name: 'Guardar borrador', exact: true })
    .click();
  await dialog.waitFor({ state: 'hidden' });
  await page
    .getByRole('button', { name: 'Recibir compra', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Confirmar recibir compra', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page
    .locator('.purchase-state')
    .filter({ hasText: 'Recibida' })
    .waitFor();
  await page.getByRole('link', { name: 'Existencias', exact: true }).click();
  await search(
    page,
    'Buscar existencias por artículo',
    items[0].sku,
    '/api/inventory/inventory/stocks',
  );
  await page.getByText('Existencia: 7.5 g', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Ver historial', exact: true }).click();
  await page.getByText('Entrada +7.5 g', { exact: true }).waitFor();
  await page
    .getByText('Origen: Compra · Referencia: ' + prefix + '-UI', {
      exact: true,
    })
    .waitFor();
  pass(
    'Playwright real: login, compra, conflicto comparado, recepción, existencia e historial',
  );
  stage = 'ajuste y responsive';
  await page.getByRole('link', { name: 'Existencias', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo ajuste', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Buscar artículo por nombre, SKU o código de barras', {
      exact: true,
    })
    .fill(items[0].sku);
  await dialog
    .getByRole('checkbox', {
      name: items[0].sku + ' — ' + items[0].name,
      exact: true,
    })
    .check();
  await dialog
    .getByLabel('Cantidad en unidad base', { exact: true })
    .fill('0.5');
  await dialog
    .getByLabel('Motivo del ajuste', { exact: true })
    .fill('Conteo físico real de prueba');
  await dialog
    .getByRole('button', { name: 'Revisar ajuste', exact: true })
    .click();
  await dialog
    .getByRole('button', { name: 'Confirmar ajuste', exact: true })
    .click();
  await dialog.waitFor({ state: 'hidden' });
  await search(
    page,
    'Buscar existencias por artículo',
    items[0].sku,
    '/api/inventory/inventory/stocks',
  );
  await page.getByText('Existencia: 8 g', { exact: true }).waitFor();
  for (const [width, height] of [
    [1440, 1000],
    [375, 812],
    [812, 375],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({
      path: 'artifacts/phase3/stocks-' + width + '.png',
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      'Sin desbordamiento ' + width,
    );
  }
  pass('Playwright real: ajuste confirmado, saldo actualizado y tres tamaños');
  stage = 'permisos';
  const viewer = await login('VIEWER');
  assert.equal(
    await viewer.page
      .getByRole('button', { name: 'Nueva compra', exact: true })
      .count(),
    0,
  );
  await api(
    viewer.context,
    'purchases',
    'POST',
    { ...data, reference: prefix + '-DENIED' },
    403,
  );
  await api(
    viewer.context,
    'inventory/adjustments',
    'POST',
    {
      itemId: items[0].id,
      type: 'ADJUSTMENT_IN',
      quantity: '1',
      reason: 'Sin permiso',
      operationId: randomUUID(),
    },
    403,
  );
  await viewer.page.goto(base + '/inventario/existencias');
  assert.equal(
    await viewer.page
      .getByRole('button', { name: 'Nuevo ajuste', exact: true })
      .count(),
    0,
  );
  await viewer.context.close();
  for (const role of ['ADMIN', 'OPERATOR']) {
    const user = await login(role);
    assert.equal(
      await user.page
        .getByRole('button', { name: 'Nueva compra', exact: true })
        .count(),
      1,
    );
    const draft = await api(
      user.context,
      'purchases',
      'POST',
      { ...data, reference: prefix + '-' + role },
      201,
    );
    await api(user.context, 'purchases/' + draft.id + '/cancel', 'POST', {
      expectedVersion: draft.version,
      reason: 'Cancelar borrador de prueba',
    });
    await user.context.close();
  }
  pass('Cuatro roles: compras y ajustes autorizados; VIEWER solo consulta');
  stage = 'persistencia y reconciliación';
  compose('restart', 'inventory-service');
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + '/api/inventory/health/ready')).ok) break;
    } catch {
      /* reinicio */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  assert.equal(
    (await api(context, 'inventory/stocks/' + items[0].id)).quantity,
    '8',
  );
  inventory(
    `const rows=await db.$queryRawUnsafe('SELECT b."itemId" FROM "InventoryBalance" b LEFT JOIN "InventoryMovement" m ON m."itemId"=b."itemId" GROUP BY b."itemId",b.quantity HAVING b.quantity <> coalesce(sum(CASE WHEN m.type IN (\\'PURCHASE_IN\\',\\'ADJUSTMENT_IN\\') THEN m.quantity ELSE -m.quantity END),0)');assert.equal(rows.length,0);`,
  );
  assert.deepEqual(errors, []);
  assert.equal(
    requests.some(
      (u) => /:300[0-4]\b/.test(u) || /[?&](token|authorization)=/i.test(u),
    ),
    false,
  );
  assert.equal(
    await page.evaluate(
      () => window.localStorage.length + window.sessionStorage.length,
    ),
    0,
  );
  pass(
    'Persistencia tras reinicio, ledger reconciliado y navegador sin errores ni tokens',
  );
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage
      .screenshot({ path: 'artifacts/phase3/failure.png', fullPage: true })
      .catch(() => {});
    console.error(
      'Visible dialogs:',
      await activePage
        .locator('dialog')
        .evaluateAll((ds) =>
          ds.map((d) => ({
            open: d.open,
            title: d.getAttribute('aria-label'),
            labels: [...d.querySelectorAll('label')].map((l) => l.textContent),
          })),
        )
        .catch(() => []),
    );
  }
  results.push({ test: stage, status: 'failed', message: String(error) });
  console.error(stage + ': ' + String(error));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try {
    inventory(
      `assert.match(input.prefix,/^F3-[A-F0-9]{16}$/);await db.$transaction(async tx=>{const items=await tx.catalogItem.findMany({where:{sku:{startsWith:input.prefix}},select:{id:true}});const ids=items.map(i=>i.id);const purchases=await tx.purchase.findMany({where:{reference:{startsWith:input.prefix}},select:{id:true}});const pids=purchases.map(p=>p.id);await tx.inventoryMovement.deleteMany({where:{itemId:{in:ids},type:'REVERSAL'}});await tx.inventoryMovement.deleteMany({where:{itemId:{in:ids}}});await tx.inventoryBalance.deleteMany({where:{itemId:{in:ids}}});await tx.purchaseLine.deleteMany({where:{purchaseId:{in:pids}}});await tx.purchase.deleteMany({where:{id:{in:pids}}});const suppliers=await tx.supplier.findMany({where:{code:{startsWith:input.prefix}},select:{id:true}});await tx.supplierItem.deleteMany({where:{supplierId:{in:suppliers.map(s=>s.id)}}});await tx.supplier.deleteMany({where:{id:{in:suppliers.map(s=>s.id)}}});await tx.catalogItem.deleteMany({where:{id:{in:ids}}});await tx.category.deleteMany({where:{name:input.prefix}});});assert.equal(await db.purchase.count({where:{reference:{startsWith:input.prefix}}}),0);assert.equal(await db.catalogItem.count({where:{sku:{startsWith:input.prefix}}}),0);`,
      { prefix },
    );
    for (const email of users) fixtureUser('delete', email);
    pass(
      'Fixtures propios de compras, ledger, catálogo, proveedores y usuarios eliminados',
    );
  } catch {
    console.error('Revisar limpieza de fixtures ' + prefix);
    process.exitCode = 1;
  }
  writeFileSync(
    'artifacts/purchases-verification.json',
    JSON.stringify(
      { timestamp: new Date().toISOString(), prefix, results },
      null,
      2,
    ),
  );
}
