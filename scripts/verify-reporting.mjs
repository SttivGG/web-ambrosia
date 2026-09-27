import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { chromium } from 'playwright';
import { fixtureUser } from './auth-test-fixture.mjs';

loadEnvFile('.env');
const composeArgs = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infrastructure/docker-compose.yml',
];
const base = 'http://localhost:' + (process.env.GATEWAY_PORT || 8080);
const prefix = 'F8A-' + randomBytes(6).toString('hex').toUpperCase();
const actorId = randomUUID();
const users = [];
const checks = [];
let browser;
let fixtures;

function pass(name) {
  checks.push({ name, status: 'passed' });
  console.log('PASS ' + name);
}

function compose(command, options = {}) {
  const result = spawnSync('docker', [...composeArgs, ...command], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  assert.equal(result.status, 0, 'Docker ' + command[0] + ': ' + result.stderr);
  return result.stdout;
}

function own(service, code, input = {}) {
  const source = `const {PrismaService}=require('./dist/prisma.service');const {ConfigService}=require('@nestjs/config');let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',async()=>{const input=JSON.parse(text);const db=new PrismaService(new ConfigService({DATABASE_URL:process.env.DATABASE_URL}));try{${code}}catch(e){console.error(e);process.exitCode=1}finally{await db.$disconnect()}})`;
  return compose(['exec', '-T', service + '-service', 'node', '-e', source], {
    input: JSON.stringify(input),
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(path, expected = 200, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = 'network';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(base + path, {
        signal: AbortSignal.timeout(5_000),
      });
      last = response.status;
      if (response.status === expected) return response;
    } catch {
      last = 'network';
    }
    await delay(1_000);
  }
  throw new Error(path + ': esperado ' + expected + ', recibido ' + last);
}

async function session(role) {
  const email = 'fase8a.' + randomBytes(6).toString('hex') + '@ambrosia.test';
  const password =
    'Temporal ' + randomBytes(18).toString('base64url') + ' 2026';
  users.push(email);
  fixtureUser('create', email, password, role);
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base + '/login?returnTo=%2Freportes');
  await page.getByLabel('Correo', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Iniciar sesión', exact: true })
    .click();
  await page.waitForURL((url) => url.pathname === '/dashboard');
  return { context, page };
}

async function api(context, path, method = 'GET', expected = 200) {
  const headers = { Origin: base };
  if (method !== 'GET') {
    const csrf = await context.request.get(base + '/api/auth/csrf');
    headers['X-CSRF-Token'] = (await csrf.json()).csrfToken;
  }
  const response = await context.request.fetch(
    base + '/api/finance/reports/' + path,
    { method, headers, timeout: 60_000 },
  );
  const responseText = await response.text();
  assert.equal(
    response.status(),
    expected,
    method + ' ' + path + ': ' + responseText,
  );
  return responseText ? JSON.parse(responseText) : null;
}

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
  });
  const owner = await session('OWNER');
  compose(['stop', 'finance-reporting-service']);
  await waitFor('/api/finance/health/live', 503);
  fixtures = JSON.parse(
    own(
      'inventory',
      `const {StockService}=require('./dist/purchases/stock.service');const {randomUUID}=require('node:crypto');
      const category=await db.category.create({data:{name:input.prefix,normalizedName:input.prefix.toLowerCase(),slug:input.prefix.toLowerCase()}});
      const item=await db.catalogItem.create({data:{sku:input.prefix,normalizedSku:input.prefix,name:input.prefix+' sin valorar',normalizedName:(input.prefix+' sin valorar').toLowerCase(),itemType:'RAW_MATERIAL',categoryId:category.id,inventoryBaseUnit:'GRAM',defaultOperationUnit:'GRAM'}});
      const movement=await new StockService(db).adjust({itemId:item.id,type:'ADJUSTMENT_IN',quantity:'7.5',reason:'Recuperación Reporting Fase 8A',operationId:randomUUID()},input.actorId);
      const balance=await db.inventoryBalance.findUniqueOrThrow({where:{itemId:item.id}});
      console.log(JSON.stringify({categoryId:category.id,itemId:item.id,movementId:movement.id,onHand:balance.quantity.toFixed(),inventoryValue:balance.inventoryValue?.toFixed()??null}));`,
      { prefix, actorId },
    ),
  );
  assert.deepEqual(
    { onHand: fixtures.onHand, inventoryValue: fixtures.inventoryValue },
    { onHand: '7.5', inventoryValue: null },
  );
  await waitFor('/api/inventory/health/ready');
  pass(
    'Inventory confirma una operación UNVALUED mientras Reporting está detenido',
  );

  compose(['start', 'finance-reporting-service']);
  await waitFor('/api/finance/health/ready');
  let inventory;
  const deadline = Date.now() + 60_000;
  do {
    inventory = await api(
      owner.context,
      'inventory?page=1&pageSize=100&search=' + prefix,
    );
    if (inventory.data.length) break;
    await delay(1_000);
  } while (Date.now() < deadline);
  assert.equal(inventory.data.length, 1);
  assert.equal(inventory.data[0].onHand, '7.5');
  assert.equal(inventory.data[0].valuationStatus, 'UNVALUED');
  assert.equal(inventory.data[0].weightedAverageCost, null);
  assert.equal(inventory.data[0].inventoryValue, null);
  const movements = await api(
    owner.context,
    'inventory/movements?page=1&pageSize=10&itemId=' + fixtures.itemId,
  );
  assert.equal(movements.data.length, 1);
  assert.equal(movements.data[0].balanceAfter, '7.5');
  pass('JetStream recupera item y movimiento sin fabricar costo');

  const firstReconcile = await api(
    owner.context,
    'admin/inventory/reconcile',
    'POST',
  );
  const secondReconcile = await api(
    owner.context,
    'admin/inventory/reconcile',
    'POST',
  );
  assert.equal(firstReconcile.status, 'ok');
  assert.equal(secondReconcile.status, 'ok');
  assert.ok(secondReconcile.duplicates > 0);
  const before = await api(
    owner.context,
    'inventory?page=1&pageSize=100&search=' + prefix,
  );
  const rebuilt = await api(owner.context, 'admin/inventory/rebuild', 'POST');
  assert.equal(rebuilt.status, 'ok');
  const after = await api(
    owner.context,
    'inventory?page=1&pageSize=100&search=' + prefix,
  );
  const stableProjection = (row) =>
    Object.fromEntries(
      Object.entries(row).filter(([key]) => key !== 'processedAt'),
    );
  assert.deepEqual(
    after.data.map(stableProjection),
    before.data.map(stableProjection),
  );
  pass('Reconciliación repetible y reconstrucción preservan el estado final');

  await api(owner.context, 'finance?page=1&pageSize=1');
  await api(owner.context, 'inventory?page=1&pageSize=101', 'GET', 400);
  await api(
    owner.context,
    'inventory?page=1&pageSize=10&from=2026-01-02T00%3A00%3A00.000Z&to=2026-01-01T00%3A00%3A00.000Z',
    'GET',
    400,
  );
  const admin = await session('ADMIN');
  await api(admin.context, 'admin/inventory/reconcile', 'POST');
  const operator = await session('OPERATOR');
  await api(operator.context, 'admin/inventory/reconcile', 'POST', 403);
  const viewer = await session('VIEWER');
  await api(viewer.context, 'inventory?page=1&pageSize=1');
  await api(viewer.context, 'finance?page=1&pageSize=1', 'GET', 403);
  await api(viewer.context, 'admin/inventory/reconcile', 'POST', 403);
  pass(
    'API valida límites y fechas; RBAC separa lectura, finanzas y administración',
  );

  await owner.page.goto(base + '/reportes');
  await owner.page.getByRole('heading', { name: 'Reportes' }).waitFor();
  await owner.page
    .getByRole('heading', { name: 'Inventario proyectado' })
    .waitFor();
  pass('La UI mínima de Reportes responde a través del gateway');
} finally {
  try {
    compose(['start', 'finance-reporting-service']);
    if (fixtures) {
      own(
        'finance-reporting',
        `const rows=await db.reportProcessedEvent.findMany({where:{sourceEntityId:{in:[input.itemId,input.movementId]}},select:{eventId:true}});
        await db.reportInventoryMovement.deleteMany({where:{itemId:input.itemId}});
        await db.reportInventoryItem.deleteMany({where:{itemId:input.itemId}});
        await db.reportProcessedEvent.deleteMany({where:{eventId:{in:rows.map(row=>row.eventId)}}});`,
        fixtures,
      );
      own(
        'inventory',
        `await db.inventoryMovement.deleteMany({where:{itemId:input.itemId}});await db.inventoryBalance.deleteMany({where:{itemId:input.itemId}});await db.catalogItem.deleteMany({where:{id:input.itemId}});await db.category.deleteMany({where:{id:input.categoryId}});`,
        fixtures,
      );
    }
  } finally {
    if (browser) await browser.close();
    for (const email of users) {
      try {
        fixtureUser('delete', email);
      } catch {
        // La limpieza se limita a fixtures de la prueba.
      }
    }
    mkdirSync('artifacts/phase8a', { recursive: true });
    writeFileSync(
      'artifacts/phase8a/verification.json',
      JSON.stringify({ timestamp: new Date().toISOString(), checks }, null, 2),
    );
  }
}

console.log(
  'Fase 8A verificada con API, PostgreSQL, JetStream y navegador reales.',
);
