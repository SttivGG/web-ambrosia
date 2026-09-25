import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { fixtureUser } from './auth-test-fixture.mjs';
loadEnvFile('.env');
const args = [
    'compose',
    '--env-file',
    '.env',
    '-f',
    'infrastructure/docker-compose.yml',
  ],
  base = 'http://localhost:' + (process.env.GATEWAY_PORT || 8080),
  prefix = 'F4-' + randomBytes(8).toString('hex').toUpperCase(),
  actorId = randomUUID();
const users = [],
  reports = [],
  errors = [];
let browser, fixtures;
mkdirSync('artifacts/phase4', { recursive: true });
function pass(test) {
  reports.push({ test, status: 'passed' });
  console.log('PASS ' + test);
}
function compose(command, options = {}) {
  const r = spawnSync('docker', [...args, ...command], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  assert.equal(r.status, 0, 'Docker ' + command[0] + ': ' + r.stderr);
  return r.stdout;
}
function own(service, code, input = {}) {
  const source = `const {PrismaService}=require('./dist/prisma.service');const {ConfigService}=require('@nestjs/config');const {randomUUID}=require('node:crypto');let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',async()=>{const input=JSON.parse(text);const db=new PrismaService(new ConfigService({DATABASE_URL:process.env.DATABASE_URL}));try{${code}}catch(e){console.error(e.name,e.code??'verification');process.exitCode=1}finally{await db.$disconnect()}});`;
  return compose(['exec', '-T', service + '-service', 'node', '-e', source], {
    input: JSON.stringify(input),
  });
}
async function api(
  context,
  resource,
  method = 'GET',
  data,
  expected = 200,
  csrf = true,
) {
  const headers = { Origin: base };
  if (method !== 'GET' && csrf) {
    const r = await context.request.get(base + '/api/auth/csrf');
    headers['X-CSRF-Token'] = (await r.json()).csrfToken;
  }
  const r = await context.request.fetch(
    base + '/api/production/production/' + resource,
    { method, data, headers },
  );
  assert.equal(
    r.status(),
    expected,
    method + ' ' + resource + ' ' + (await r.text()),
  );
  return r.json();
}
async function login(role) {
  const email = 'fase4.' + randomBytes(8).toString('hex') + '@ambrosia.test',
    password = 'Temporal ' + randomBytes(20).toString('base64url') + ' 2026';
  users.push(email);
  fixtureUser('create', email, password, role);
  const context = await browser.newContext(),
    page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.setDefaultTimeout(20000);
  await page.goto(base + '/login?returnTo=%2Fproduccion%2Flotes');
  await page.getByLabel('Correo', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Iniciar sesión', exact: true })
    .click();
  await page.waitForURL(/produccion\/lotes/);
  return { context, page };
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  compose([
    'run',
    '--rm',
    '--no-deps',
    '-T',
    '-v',
    path
      .resolve('scripts/verify-production-isolated.mjs')
      .replaceAll('\\', '/') +
      ':/app/scripts/verify-production-isolated.mjs:ro',
    'inventory-migrate',
    'node',
    'scripts/verify-production-isolated.mjs',
    'inventory',
  ]);
  pass(
    'PostgreSQL aislado: dos consumos concurrentes, duplicados, rollback, compensación y ledger',
  );
  fixtures = JSON.parse(
    own(
      'inventory',
      `const c=await db.category.create({data:{name:input.prefix,normalizedName:input.prefix.toLowerCase(),slug:input.prefix.toLowerCase()}});const items=[];for(const [suffix,type] of [['INSUMO','RAW_MATERIAL'],['PRODUCTO','FINISHED_PRODUCT']])items.push(await db.catalogItem.create({data:{sku:input.prefix+'-'+suffix,normalizedSku:input.prefix+'-'+suffix,name:input.prefix+' '+suffix,normalizedName:(input.prefix+' '+suffix).toLowerCase(),categoryId:c.id,itemType:type,inventoryBaseUnit:'GRAM',defaultOperationUnit:'GRAM'}}));const {StockService}=require('./dist/purchases/stock.service');await new StockService(db).adjust({itemId:items[0].id,quantity:'1000',type:'ADJUSTMENT_IN',reason:'Fixture Fase 4',operationId:randomUUID()},input.actorId);console.log(JSON.stringify({categoryId:c.id,itemId:items[0].id,productId:items[1].id}));`,
      { prefix, actorId },
    ),
  );
  compose(
    [
      'run',
      '--rm',
      '--no-deps',
      '-T',
      '--env-from-file',
      'secrets/production.local.env',
      '-e',
      'INVENTORY_INTERNAL_URL=http://inventory-service:3001',
      '-v',
      path
        .resolve('scripts/verify-production-recovery.mjs')
        .replaceAll('\\', '/') +
        ':/app/scripts/verify-production-recovery.mjs:ro',
      'production-migrate',
      'node',
      'scripts/verify-production-recovery.mjs',
    ],
    { input: JSON.stringify({ ...fixtures, actorId }) },
  );
  pass(
    'Recuperación real entre dos bases: timeout, fallo antes/después, reinicio lógico y compensación',
  );
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
  });
  const { context, page } = await login('OWNER');
  await page.goto(base + '/produccion/formulas');
  await page
    .getByRole('button', { name: 'Nueva fórmula', exact: true })
    .click();
  await page.getByLabel('Nombre', { exact: true }).fill(prefix);
  const product = page.getByRole('group', { name: 'Seleccionar producto' });
  await product.getByLabel('Buscar artículo').fill(prefix + ' PRODUCTO');
  await product
    .getByRole('button', { name: prefix + ' PRODUCTO · g', exact: true })
    .click();
  const ingredient = page.getByRole('group', { name: 'Agregar insumo' });
  await ingredient.getByLabel('Buscar artículo').fill(prefix + ' INSUMO');
  await ingredient
    .getByRole('button', { name: prefix + ' INSUMO · g', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Guardar fórmula', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  const formula = (await api(context, 'formulas?search=' + prefix)).data[0];
  assert.ok(formula);
  await api(context, 'formulas', 'POST', { name: 'Invalid' }, 400);
  await api(
    context,
    'formulas/' + formula.id,
    'PATCH',
    {
      name: formula.name,
      productId: formula.productId,
      baseUnit: formula.baseUnit,
      ingredients: formula.ingredients,
      active: true,
      expectedVersion: formula.version,
    },
    403,
    false,
  );
  const changed = await api(context, 'formulas/' + formula.id, 'PATCH', {
    name: formula.name,
    productId: formula.productId,
    baseUnit: formula.baseUnit,
    ingredients: formula.ingredients,
    active: true,
    expectedVersion: formula.version,
  });
  assert.equal(changed.version, 2);
  pass('Fórmulas: interfaz real, versiones, validación y CSRF');
  await page.goto(base + '/produccion/lotes');
  await page
    .getByRole('button', { name: 'Nueva producción', exact: true })
    .click();
  await page.getByLabel('Lote', { exact: true }).fill(prefix);
  await page.getByLabel('Buscar fórmula', { exact: true }).fill(prefix);
  await page
    .getByRole('button', { name: prefix + ' · versión 2 · g', exact: true })
    .click();
  await page.getByLabel('Cantidad planificada').fill('2');
  await page
    .getByLabel('Observaciones', { exact: true })
    .fill('Borrador inicial');
  await page
    .getByRole('button', { name: 'Guardar borrador', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByLabel('Buscar lote').fill(prefix);
  let order = (await api(context, 'orders?search=' + prefix)).data[0];
  assert.equal(order.status, 'DRAFT');
  await page
    .getByRole('button', { name: 'Editar borrador', exact: true })
    .click();
  await page
    .getByLabel('Observaciones', { exact: true })
    .fill('Datos locales conservados');
  const values = {
    batch: order.batch,
    formulaId: order.formulaId,
    quantity: order.quantity,
    scheduledAt: order.scheduledAt,
    notes: 'Cambio concurrente',
  };
  order = await api(context, 'orders/' + order.id, 'PATCH', {
    ...values,
    expectedVersion: order.version,
  });
  await page
    .getByRole('button', { name: 'Guardar borrador', exact: true })
    .click();
  await page.getByRole('button', { name: 'Adoptar versión actual' }).waitFor();
  assert.equal(
    await page.getByLabel('Observaciones', { exact: true }).inputValue(),
    'Datos locales conservados',
  );
  await page.getByRole('button', { name: 'Adoptar versión actual' }).click();
  await page
    .getByRole('button', { name: 'Guardar borrador', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Iniciar', exact: true }).click();
  await page
    .getByRole('button', { name: 'Iniciar producción', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  order = await api(context, 'orders/' + order.id);
  assert.equal(order.status, 'IN_PROGRESS');
  assert.equal(order.operations[0].result.movements.length, 1);
  const operationId = order.operations[0].id;
  await api(context, 'orders/' + order.id + '/reconcile', 'POST', {
    expectedVersion: order.version,
  });
  assert.equal(
    (await api(context, 'orders/' + order.id)).operations[0].id,
    operationId,
  );
  await page.getByRole('button', { name: 'Ver detalle', exact: true }).click();
  await page.getByText('Consumo y trazabilidad', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Cerrar detalle' }).click();
  pass(
    'Playwright: crear, editar con conflicto sin pérdida, iniciar, detalle y ledger',
  );
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.screenshot({
      path: 'artifacts/phase4/production-' + width + '.png',
      fullPage: true,
    });
  }
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page
    .getByLabel('Motivo de cancelación', { exact: true })
    .fill('Prueba compensación');
  await page
    .getByRole('button', { name: 'Cancelar producción', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  order = await api(context, 'orders/' + order.id);
  assert.equal(order.status, 'CANCELLED');
  assert.equal(
    order.operations[1].result.movements[0].reversesId,
    order.operations[0].result.movements[0].id,
  );
  let complete = await api(
    context,
    'orders',
    'POST',
    { ...values, batch: prefix + '-COMPLETAR' },
    201,
  );
  complete = await api(context, 'orders/' + complete.id + '/start', 'POST', {
    expectedVersion: complete.version,
  });
  await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
  await page.getByRole('button', { name: 'Completar', exact: true }).click();
  await page
    .getByRole('button', { name: 'Completar producción', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  complete = await api(context, 'orders/' + complete.id);
  assert.equal(complete.status, 'COMPLETED');
  await api(
    context,
    'orders/' + complete.id + '/cancel',
    'POST',
    { expectedVersion: complete.version, reason: 'No permitido' },
    409,
  );
  const formulaInput = {
    name: formula.name,
    productId: formula.productId,
    baseUnit: formula.baseUnit,
    ingredients: formula.ingredients,
  };
  const inactive = await api(context, 'formulas/' + formula.id, 'PATCH', {
    ...formulaInput,
    active: false,
    expectedVersion: changed.version,
  });
  await api(
    context,
    'orders',
    'POST',
    { ...values, batch: prefix + '-INACTIVA' },
    409,
  );
  await api(context, 'formulas/' + formula.id, 'PATCH', {
    ...formulaInput,
    active: true,
    expectedVersion: inactive.version,
  });
  assert.equal(
    (await api(context, 'orders/' + complete.id)).formula.version,
    2,
  );
  pass('Compensación explícita, cierre mínimo y responsive 1440/768/375');
  for (const role of ['ADMIN', 'OPERATOR', 'VIEWER']) {
    const u = await login(role);
    await api(u.context, 'orders?search=' + prefix);
    const docs = await u.context.request.get(
      base + '/api/production/docs-json',
    );
    assert.equal(docs.status(), role === 'ADMIN' ? 200 : 403);
    if (role === 'VIEWER') {
      assert.equal(
        await u.page
          .getByRole('button', { name: 'Nueva producción', exact: true })
          .count(),
        0,
      );
      await api(
        u.context,
        'orders',
        'POST',
        { ...values, batch: prefix + '-' + role },
        403,
      );
    } else {
      let draft = await api(
        u.context,
        'orders',
        'POST',
        { ...values, batch: prefix + '-' + role },
        201,
      );
      draft = await api(u.context, 'orders/' + draft.id + '/cancel', 'POST', {
        expectedVersion: draft.version,
        reason: 'Cancelar borrador',
      });
      assert.equal(draft.operations.length, 0);
    }
    await u.context.close();
  }
  const anon = await browser.newContext();
  await api(anon, 'orders', 'GET', undefined, 401);
  await anon.close();
  for (const route of [
    '/api/inventory/internal/production/operations',
    '/api/inventory/api/v1/internal/production/operations',
  ])
    assert.equal((await context.request.get(base + route)).status(), 404);
  const spec = await (
    await context.request.get(base + '/api/production/docs-json')
  ).json();
  assert.ok(spec.paths['/api/v1/production/orders/{id}/start']);
  pass(
    'OWNER/ADMIN/OPERATOR/VIEWER, anónimo, Swagger protegido y rutas técnicas privadas',
  );
  compose(['restart', 'production-service', 'inventory-service']);
  for (let n = 0; n < 40; n++) {
    await delay(1000);
    try {
      if (
        (
          await context.request.get(base + '/api/production/health/ready')
        ).status() === 200 &&
        (
          await context.request.get(base + '/api/inventory/health/ready')
        ).status() === 200
      )
        break;
    } catch {
      /* Services may still be restarting. */
    }
  }
  assert.equal((await api(context, 'orders/' + order.id)).status, 'CANCELLED');
  assert.equal(
    (await api(context, 'orders/' + complete.id)).status,
    'COMPLETED',
  );
  assert.deepEqual(errors, []);
  pass('Persistencia tras reinicio y cero errores JavaScript');
} catch (e) {
  reports.push({ test: 'production', status: 'failed', message: String(e) });
  console.error(e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  try {
    own(
      'production',
      `const orders=await db.productionOrder.findMany({where:{batch:{startsWith:input.prefix}},select:{id:true}});await db.productionOperation.deleteMany({where:{orderId:{in:orders.map(o=>o.id)}}});await db.productionOrder.deleteMany({where:{id:{in:orders.map(o=>o.id)}}});const formulas=await db.formula.findMany({where:{name:{startsWith:input.prefix}},select:{id:true}});await db.formulaRevision.deleteMany({where:{formulaId:{in:formulas.map(f=>f.id)}}});await db.formula.deleteMany({where:{id:{in:formulas.map(f=>f.id)}}});`,
      { prefix },
    );
    if (fixtures)
      own(
        'inventory',
        `const ids=[input.itemId,input.productId];const movements=await db.inventoryMovement.findMany({where:{itemId:{in:ids}}});const operations=[...new Set(movements.map(m=>m.productionOperationId).filter(Boolean))];await db.inventoryMovement.deleteMany({where:{itemId:{in:ids},reversesId:{not:null}}});await db.inventoryMovement.deleteMany({where:{itemId:{in:ids}}});await db.productionStockOperation.deleteMany({where:{id:{in:operations},kind:'REVERSE'}});await db.productionStockOperation.deleteMany({where:{OR:[{id:{in:operations}},{payload:{path:['actorId'],equals:input.actorId}}]}});await db.inventoryBalance.deleteMany({where:{itemId:{in:ids}}});await db.catalogItem.deleteMany({where:{id:{in:ids}}});await db.category.delete({where:{id:input.categoryId}});`,
        { ...fixtures, actorId },
      );
  } catch (e) {
    console.error('Limpieza de fixtures incompleta: ' + String(e));
    process.exitCode = 1;
  }
  for (const email of users) fixtureUser('delete', email);
  writeFileSync(
    'artifacts/production-verification.json',
    JSON.stringify(reports, null, 2),
  );
}
