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
const prefix = 'F8B-' + randomBytes(6).toString('hex').toUpperCase();
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

async function waitFor(path, expected = 200, timeoutMs = 90_000) {
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
  const email = 'fase8b.' + randomBytes(6).toString('hex') + '@ambrosia.test';
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
    { method, headers, timeout: 90_000 },
  );
  const responseText = await response.text();
  assert.equal(
    response.status(),
    expected,
    method + ' ' + path + ': ' + responseText,
  );
  return responseText ? JSON.parse(responseText) : null;
}

const stableProjection = (row) =>
  Object.fromEntries(
    Object.entries(row).filter(([key]) => key !== 'processedAt'),
  );

try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
  });
  const owner = await session('OWNER');
  compose(['stop', 'finance-reporting-service']);
  await waitFor('/api/finance/health/live', 503);

  const inventory = JSON.parse(
    own(
      'inventory',
      `const {StockService}=require('./dist/purchases/stock.service');const {randomUUID}=require('node:crypto');
      const category=await db.category.create({data:{name:input.prefix,normalizedName:input.prefix.toLowerCase(),slug:input.prefix.toLowerCase()}});
      const item=await db.catalogItem.create({data:{sku:input.prefix,normalizedSku:input.prefix,name:input.prefix+' sin valorar',normalizedName:(input.prefix+' sin valorar').toLowerCase(),itemType:'RAW_MATERIAL',categoryId:category.id,inventoryBaseUnit:'GRAM',defaultOperationUnit:'GRAM'}});
      const movement=await new StockService(db).adjust({itemId:item.id,type:'ADJUSTMENT_IN',quantity:'7.5',reason:'Recuperación Reporting Fase 8B',operationId:randomUUID()},input.actorId);
      const balance=await db.inventoryBalance.findUniqueOrThrow({where:{itemId:item.id}});
      const supplier=await db.supplier.create({data:{code:input.prefix,name:input.prefix+' Proveedor'}});
      const purchase=await db.purchase.create({data:{supplierId:supplier.id,reference:input.prefix,purchasedAt:new Date(),status:'RECEIVED',subtotal:'37.50',total:'37.50',receivedAt:new Date(),lines:{create:{itemId:item.id,quantity:'7.5',unitCost:'5.00',subtotal:'37.50',baseUnit:'GRAM'}}},include:{lines:true}});
      console.log(JSON.stringify({categoryId:category.id,itemId:item.id,movementId:movement.id,operationId:movement.operationId,supplierId:supplier.id,purchaseId:purchase.id,purchaseLineId:purchase.lines[0].id,onHand:balance.quantity.toFixed(),inventoryValue:balance.inventoryValue?.toFixed()??null}));`,
      { prefix, actorId },
    ),
  );
  fixtures = inventory;
  const production = JSON.parse(
    own(
      'production',
      `const {randomUUID}=require('node:crypto');const now=new Date();const formulaId=randomUUID(),revisionId=randomUUID(),presentationProductId=randomUUID();
      const formula=await db.formula.create({data:{id:formulaId,name:input.prefix,active:true,version:1}});
      const revision=await db.formulaRevision.create({data:{id:revisionId,formulaId:formula.id,version:1,snapshot:{id:formula.id,revisionId,version:1,name:input.prefix,productId:input.productId,baseUnit:'GRAM',ingredients:[{itemId:input.productId,quantity:'7.5',baseUnit:'GRAM'}],active:true,createdAt:now.toISOString(),updatedAt:now.toISOString()}}});
      const order=await db.productionOrder.create({data:{batch:input.prefix,formulaRevisionId:revision.id,quantity:'7.5',ingredients:[],scheduledAt:now,status:'COMPLETED',actorId:input.actorId,startedAt:now,completedAt:now}});
      const yieldOperation=await db.productionOperation.create({data:{orderId:order.id,kind:'YIELD',status:'CONFIRMED',payload:{},result:{}}});
      const result=await db.productionYield.create({data:{orderId:order.id,operationId:yieldOperation.id,productId:input.productId,plannedQuantity:'7.5',actualQuantity:'6',differenceQuantity:'-1.5',yieldPercentage:'80',wasteQuantity:'1.5',wastePercentage:'20',totalCost:'30',unitCost:'5',baseUnit:'GRAM',occurredAt:now,actorId:input.actorId,status:'CONFIRMED'}});
      const packageOperation=await db.productionOperation.create({data:{orderId:order.id,kind:'PACKAGE',status:'CONFIRMED',payload:{},result:{}}});
      const packaging=await db.packagingOperation.create({data:{orderId:order.id,yieldId:result.id,operationId:packageOperation.id,bulkProductId:input.productId,presentationProductId,unitsPackaged:'3',productQuantityPerUnit:'2',productQuantityUsed:'6',packagingWasteQuantity:'0',baseUnit:'GRAM',materials:[],bulkProductCost:'30',packagingMaterialsCost:'6',totalCost:'36',unitCost:'12',occurredAt:now,actorId:input.actorId,status:'CONFIRMED'}});
      console.log(JSON.stringify({formulaId:formula.id,revisionId:revision.id,batchId:order.id,yieldId:result.id,yieldOperationId:yieldOperation.id,packageOperationId:packageOperation.id,packagingId:packaging.id,presentationProductId}));`,
      { prefix, actorId, productId: inventory.itemId },
    ),
  );
  fixtures = { ...inventory, ...production };
  assert.deepEqual(
    { onHand: fixtures.onHand, inventoryValue: fixtures.inventoryValue },
    { onHand: '7.5', inventoryValue: null },
  );
  pass(
    'Fuentes crean compra, Kardex, UNVALUED y lote sin depender de Reporting',
  );

  compose(['start', 'finance-reporting-service']);
  await waitFor('/api/finance/health/ready');
  let purchases;
  const deadline = Date.now() + 90_000;
  do {
    purchases = await api(
      owner.context,
      'purchases?page=1&pageSize=10&supplierId=' + fixtures.supplierId,
    );
    if (purchases.data.length) break;
    await delay(1_000);
  } while (Date.now() < deadline);
  assert.equal(purchases.data.length, 1);
  assert.equal(purchases.data[0].subtotal, '37.5');
  const purchaseSummary = await api(
    owner.context,
    'purchases/summary?page=1&pageSize=10&supplierId=' + fixtures.supplierId,
  );
  assert.equal(purchaseSummary.metrics.costoPromedioPonderado, '5');
  const supplier = await api(owner.context, 'suppliers/' + fixtures.supplierId);
  assert.equal(supplier.purchaseCount, 1);
  assert.equal(supplier.priceHistory.length, 1);
  pass('Compras y proveedores conservan costos Decimal y promedio ponderado');

  const inventoryReport = await api(
    owner.context,
    'inventory?page=1&pageSize=100&search=' + prefix,
  );
  assert.equal(inventoryReport.data.length, 1);
  assert.equal(inventoryReport.data[0].valuationStatus, 'UNVALUED');
  assert.equal(inventoryReport.data[0].weightedAverageCost, null);
  assert.equal(inventoryReport.data[0].inventoryValue, null);
  const movements = await api(
    owner.context,
    'inventory/movements?page=1&pageSize=10&operationId=' +
      fixtures.operationId,
  );
  assert.equal(movements.data.length, 1);
  assert.equal(movements.data[0].balanceAfter, '7.5');
  assert.equal(movements.data[0].operationId, fixtures.operationId);
  pass('Inventario y Kardex preservan UNVALUED, saldo y operationId');

  let batches;
  do {
    batches = await api(
      owner.context,
      'production?page=1&pageSize=10&productId=' + fixtures.itemId,
    );
    if (batches.data.some((row) => row.batchId === fixtures.batchId)) break;
    await delay(1_000);
  } while (Date.now() < deadline);
  const batch = batches.data.find((row) => row.batchId === fixtures.batchId);
  assert.equal(batch.outputQuantity, '6');
  assert.equal(batch.yieldPercentage, '80');
  assert.equal(batch.wasteQuantity, '1.5');
  assert.equal(batch.accumulatedCost, '30');
  const packaging = await api(
    owner.context,
    'packaging?page=1&pageSize=10&productId=' + fixtures.presentationProductId,
  );
  const packaged = packaging.data.find(
    (row) => row.packagingOperationId === fixtures.packagingId,
  );
  assert.deepEqual(
    [packaged.bulkCost, packaged.materialsCost, packaged.totalCost],
    ['30', '6', '36'],
  );
  const yieldSummary = await api(
    owner.context,
    'yield/summary?page=1&pageSize=10&productId=' + fixtures.itemId,
  );
  const wasteSummary = await api(
    owner.context,
    'waste/summary?page=1&pageSize=10&productId=' + fixtures.itemId,
  );
  assert.equal(yieldSummary.metrics.promedio, '80');
  assert.equal(wasteSummary.metrics.mermaTotal, '1.5');
  pass(
    'Producción, rendimiento, merma y envasado conservan hechos y costos separados',
  );

  const firstReconcile = await api(owner.context, 'admin/reconcile', 'POST');
  const secondReconcile = await api(owner.context, 'admin/reconcile', 'POST');
  assert.equal(firstReconcile.inventory.status, 'ok');
  assert.equal(firstReconcile.production.status, 'ok');
  assert.ok(secondReconcile.inventory.duplicates > 0);
  assert.ok(secondReconcile.production.duplicates > 0);
  const before = {
    inventory: inventoryReport.data.map(stableProjection),
    purchases: purchases.data.map(stableProjection),
    production: batches.data
      .filter((row) => row.batchId === fixtures.batchId)
      .map(stableProjection),
    packaging: packaging.data
      .filter((row) => row.packagingOperationId === fixtures.packagingId)
      .map(stableProjection),
  };
  const rebuilt = await api(owner.context, 'admin/rebuild', 'POST');
  assert.equal(rebuilt.inventory.status, 'ok');
  assert.equal(rebuilt.production.status, 'ok');
  const after = {
    inventory: (
      await api(owner.context, 'inventory?page=1&pageSize=100&search=' + prefix)
    ).data.map(stableProjection),
    purchases: (
      await api(
        owner.context,
        'purchases?page=1&pageSize=10&supplierId=' + fixtures.supplierId,
      )
    ).data.map(stableProjection),
    production: (
      await api(
        owner.context,
        'production?page=1&pageSize=10&productId=' + fixtures.itemId,
      )
    ).data
      .filter((row) => row.batchId === fixtures.batchId)
      .map(stableProjection),
    packaging: (
      await api(
        owner.context,
        'packaging?page=1&pageSize=10&productId=' +
          fixtures.presentationProductId,
      )
    ).data
      .filter((row) => row.packagingOperationId === fixtures.packagingId)
      .map(stableProjection),
  };
  assert.deepEqual(after, before);
  pass(
    'Reconciliación repetida no duplica y rebuild restaura el estado funcional',
  );

  await api(owner.context, 'inventory?page=1&pageSize=101', 'GET', 400);
  await api(
    owner.context,
    'inventory?page=1&pageSize=10&from=2026-01-02T00%3A00%3A00.000Z&to=2026-01-01T00%3A00%3A00.000Z',
    'GET',
    400,
  );
  const admin = await session('ADMIN');
  await api(admin.context, 'admin/reconcile', 'POST');
  const operator = await session('OPERATOR');
  await api(operator.context, 'admin/reconcile', 'POST', 403);
  const viewer = await session('VIEWER');
  const viewerPurchases = await api(
    viewer.context,
    'purchases?page=1&pageSize=10&supplierId=' + fixtures.supplierId,
  );
  assert.equal(viewerPurchases.data[0].unitCost, null);
  assert.equal(viewerPurchases.data[0].subtotal, null);
  const viewerProduction = await api(
    viewer.context,
    'production?page=1&pageSize=10&productId=' + fixtures.itemId,
  );
  assert.equal(
    viewerProduction.data.find((row) => row.batchId === fixtures.batchId)
      .accumulatedCost,
    null,
  );
  await api(viewer.context, 'finance?page=1&pageSize=1', 'GET', 403);
  await api(viewer.context, 'admin/reconcile', 'POST', 403);
  pass(
    'RBAC permite cantidades con reports.read y redacta costos sin reports.finance',
  );

  await owner.page.goto(base + '/reportes');
  await owner.page.getByRole('heading', { name: 'Reportes' }).waitFor();
  for (const name of [
    'Resumen',
    'Compras',
    'Proveedores',
    'Inventario',
    'Kardex',
    'Producción',
    'Rendimiento',
    'Merma',
    'Envasado',
  ])
    await owner.page.getByRole('button', { name, exact: true }).waitFor();
  await owner.page.getByRole('button', { name: 'Compras' }).click();
  await owner.page.getByRole('heading', { name: 'Compras' }).waitFor();
  pass('La UI operativa completa responde a través del gateway');
} finally {
  try {
    compose(['start', 'finance-reporting-service']);
    if (fixtures) {
      own(
        'finance-reporting',
        `const ids=[input.itemId,input.movementId,input.purchaseLineId,input.batchId,input.packagingId];const rows=await db.reportProcessedEvent.findMany({where:{sourceEntityId:{in:ids}},select:{eventId:true}});await db.reportInventoryMovement.deleteMany({where:{itemId:input.itemId}});await db.reportPurchaseItem.deleteMany({where:{purchaseLineId:input.purchaseLineId}});await db.reportInventoryItem.deleteMany({where:{itemId:input.itemId}});await db.reportPackagingOperation.deleteMany({where:{packagingOperationId:input.packagingId}});await db.reportProductionBatch.deleteMany({where:{batchId:input.batchId}});await db.reportProcessedEvent.deleteMany({where:{eventId:{in:rows.map(row=>row.eventId)}}});`,
        fixtures,
      );
      own(
        'production',
        `await db.packagingOperation.deleteMany({where:{id:input.packagingId}});await db.productionYield.deleteMany({where:{id:input.yieldId}});await db.productionOperation.deleteMany({where:{orderId:input.batchId}});await db.productionOrder.deleteMany({where:{id:input.batchId}});await db.formulaRevision.deleteMany({where:{id:input.revisionId}});await db.formula.deleteMany({where:{id:input.formulaId}});`,
        fixtures,
      );
      own(
        'inventory',
        `await db.purchaseLine.deleteMany({where:{id:input.purchaseLineId}});await db.purchase.deleteMany({where:{id:input.purchaseId}});await db.supplier.deleteMany({where:{id:input.supplierId}});await db.inventoryMovement.deleteMany({where:{itemId:input.itemId}});await db.inventoryBalance.deleteMany({where:{itemId:input.itemId}});await db.catalogItem.deleteMany({where:{id:input.itemId}});await db.category.deleteMany({where:{id:input.categoryId}});`,
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
    mkdirSync('artifacts/phase8b', { recursive: true });
    writeFileSync(
      'artifacts/phase8b/verification.json',
      JSON.stringify({ timestamp: new Date().toISOString(), checks }, null, 2),
    );
  }
}

console.log(
  'Fase 8B verificada con API, PostgreSQL, JetStream y navegador reales.',
);
