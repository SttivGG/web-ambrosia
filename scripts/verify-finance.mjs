import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { fixtureUser } from './auth-test-fixture.mjs';
loadEnvFile('.env');
const args = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infrastructure/docker-compose.yml',
];
const base = 'http://localhost:' + (process.env.GATEWAY_PORT || 8080);
const prefix = 'F6-' + randomBytes(6).toString('hex').toUpperCase();
const actorId = randomUUID(),
  users = [],
  checks = [],
  browserErrors = [],
  createdSaleIds = [];
let browser, fixtures, accountId;
function pass(name) {
  checks.push({ name, status: 'passed' });
  console.log('PASS ' + name);
}
function compose(command, options = {}) {
  const result = spawnSync('docker', [...args, ...command], {
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
async function session(role) {
  const email = 'fase6.' + randomBytes(6).toString('hex') + '@ambrosia.test';
  const password =
    'Temporal ' + randomBytes(18).toString('base64url') + ' 2026';
  users.push(email);
  fixtureUser('create', email, password, role);
  const context = await browser.newContext(),
    page = await context.newPage();
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto(base + '/login?returnTo=%2Ffinanzas');
  await page.getByLabel('Correo', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Iniciar sesión', exact: true })
    .click();
  await page.waitForURL((url) => url.pathname === '/dashboard');
  await page.goto(base + '/finanzas');
  await page.waitForURL((url) => url.pathname === '/finanzas');
  return { context, page };
}
async function api(context, resource, method = 'GET', data, expected = 200) {
  const headers = { Origin: base };
  if (method !== 'GET') {
    const csrf = await context.request.get(base + '/api/auth/csrf');
    headers['X-CSRF-Token'] = (await csrf.json()).csrfToken;
  }
  const response = await context.request.fetch(
    base + '/api/finance/finance/' + resource,
    { method, data, headers },
  );
  const text = await response.text();
  assert.equal(
    response.status(),
    expected,
    method + ' ' + resource + ': ' + text,
  );
  return text ? JSON.parse(text) : null;
}
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
  });
  fixtures = JSON.parse(
    own(
      'inventory',
      `
    const {StockService}=require('./dist/purchases/stock.service');const {randomUUID}=require('node:crypto');
    const category=await db.category.create({data:{name:input.prefix,normalizedName:input.prefix.toLowerCase(),slug:input.prefix.toLowerCase()}});
    const item=await db.catalogItem.create({data:{sku:input.prefix,normalizedSku:input.prefix,name:input.prefix+' Yogurt',normalizedName:(input.prefix+' yogurt').toLowerCase(),itemType:'FINISHED_PRODUCT',categoryId:category.id,inventoryBaseUnit:'UNIT',defaultOperationUnit:'UNIT'}});
    const stock=new StockService(db);await stock.adjust({itemId:item.id,type:'ADJUSTMENT_IN',quantity:'3',reason:'Fixture Fase 6',operationId:randomUUID()},input.actorId);
    const supplier=await db.supplier.create({data:{code:input.prefix,name:input.prefix+' Proveedor'}});
    const purchase=await db.purchase.create({data:{supplierId:supplier.id,reference:input.prefix,purchasedAt:new Date(),status:'RECEIVED',subtotal:'10000',total:'10000',receivedAt:new Date(),lines:{create:{itemId:item.id,quantity:'1',unitCost:'10000',subtotal:'10000',baseUnit:'UNIT'}}}});
    console.log(JSON.stringify({categoryId:category.id,itemId:item.id,supplierId:supplier.id,purchaseId:purchase.id}));`,
      { prefix, actorId },
    ),
  );
  const owner = await session('OWNER');
  assert.match(
    await owner.page.locator('body').innerText(),
    /Código/,
    'La vista de cuentas debe mostrar las mutaciones de finance.write.',
  );
  await owner.page.getByLabel('Código').fill(prefix);
  await owner.page.getByLabel('Nombre').fill('Caja ' + prefix);
  await owner.page
    .getByRole('button', { name: 'Crear cuenta', exact: true })
    .click();
  await owner.page.getByText('Operación confirmada').waitFor();
  await owner.page.keyboard.press('Escape');
  const account = (
    await api(owner.context, 'accounts?page=1&pageSize=10&search=' + prefix)
  ).data[0];
  assert.ok(account);
  accountId = account.id;
  pass('Playwright real crea cuenta por el gateway');
  const manual = await api(
    owner.context,
    'movements',
    'POST',
    {
      operationId: randomUUID(),
      accountId,
      kind: 'ADDITIONAL_INCOME',
      amount: '0.10',
      paymentMethod: 'CASH',
      occurredAt: new Date().toISOString(),
      reference: prefix,
      description: 'Prueba Decimal ' + prefix,
    },
    201,
  );
  assert.equal(manual.amount, '0.10');
  const firstPayment = await api(
    owner.context,
    'payments',
    'POST',
    {
      operationId: randomUUID(),
      purchaseId: fixtures.purchaseId,
      accountId,
      amount: '4000.00',
      paymentMethod: 'BANK_TRANSFER',
      occurredAt: new Date().toISOString(),
      reference: prefix,
      description: null,
    },
    201,
  );
  assert.equal(firstPayment.purchaseSnapshot.status, 'RECEIVED');
  await api(
    owner.context,
    'payments',
    'POST',
    {
      operationId: randomUUID(),
      purchaseId: fixtures.purchaseId,
      accountId,
      amount: '6001.00',
      paymentMethod: 'CASH',
      occurredAt: new Date().toISOString(),
      reference: null,
      description: null,
    },
    409,
  );
  const concurrent = await Promise.all(
    [6000, 6000].map(async (amount) => {
      try {
        await api(
          owner.context,
          'payments',
          'POST',
          {
            operationId: randomUUID(),
            purchaseId: fixtures.purchaseId,
            accountId,
            amount: amount.toFixed(2),
            paymentMethod: 'CASH',
            occurredAt: new Date().toISOString(),
            reference: prefix,
            description: null,
          },
          201,
        );
        return 201;
      } catch {
        return 409;
      }
    }),
  );
  assert.equal(concurrent.filter((status) => status === 201).length, 1);
  pass('Pagos parciales y carrera concurrente no exceden la compra');
  const operationId = randomUUID();
  const saleInput = {
    operationId,
    accountId,
    paymentMethod: 'CASH',
    occurredAt: new Date().toISOString(),
    reference: prefix + '-SALE',
    description: 'Venta real ' + prefix,
    lines: [{ itemId: fixtures.itemId, quantity: '2', unitPrice: '3333.33' }],
  };
  const sale = await api(owner.context, 'sales', 'POST', saleInput, 201);
  createdSaleIds.push(sale.id);
  assert.equal(sale.status, 'CONFIRMED');
  assert.equal(sale.total, '6666.66');
  assert.equal(
    (await api(owner.context, 'sales', 'POST', saleInput, 201)).id,
    sale.id,
  );
  const rejected = await api(
    owner.context,
    'sales',
    'POST',
    {
      ...saleInput,
      operationId: randomUUID(),
      reference: prefix + '-NO-STOCK',
      lines: [{ ...saleInput.lines[0], quantity: '9' }],
    },
    201,
  );
  createdSaleIds.push(rejected.id);
  assert.equal(rejected.status, 'REJECTED');
  const cancelled = await api(
    owner.context,
    'sales/' + sale.id + '/cancel',
    'POST',
    {
      operationId: randomUUID(),
      expectedVersion: sale.version,
      reason: 'Anulación de verificación',
    },
  );
  assert.equal(cancelled.status, 'CANCELLED');
  const stock = JSON.parse(
    own(
      'inventory',
      `const row=await db.inventoryBalance.findUnique({where:{itemId:input.itemId}});const movements=await db.inventoryMovement.count({where:{itemId:input.itemId,origin:'SALE'}});console.log(JSON.stringify({quantity:row.quantity.toFixed(),movements}));`,
      { itemId: fixtures.itemId },
    ),
  );
  assert.deepEqual(stock, { quantity: '3', movements: 2 });
  pass(
    'Venta idempotente, rechazo por stock y anulación compensatoria trazables',
  );
  assert.equal(
    (
      await owner.context.request.get(
        base + '/api/inventory/internal/finance/saleable-items',
      )
    ).status(),
    404,
  );
  const viewer = await session('VIEWER');
  await api(viewer.context, 'accounts?page=1&pageSize=10');
  await api(
    viewer.context,
    'accounts',
    'POST',
    { code: 'NO', name: 'Sin permiso', type: 'CASH' },
    403,
  );
  await assert.rejects(
    viewer.page
      .getByRole('button', { name: 'Crear cuenta' })
      .waitFor({ timeout: 500 }),
  );
  pass('Rutas internas ocultas y permisos finance.read/write verificados');
  assert.deepEqual(browserErrors, []);
} finally {
  if (browser) await browser.close();
  if (accountId) {
    try {
      const cleanup = JSON.parse(
        own(
          'finance-reporting',
          `
      const sales=await db.sale.findMany({where:{accountId:input.accountId},select:{id:true}});const saleIds=sales.map(row=>row.id);
      await db.purchasePayment.deleteMany({where:{purchaseId:input.purchaseId}});
      await db.financeMovement.deleteMany({where:{accountId:input.accountId}});
      await db.saleOperation.deleteMany({where:{saleId:{in:saleIds}}});
      await db.saleLine.deleteMany({where:{saleId:{in:saleIds}}});
      await db.sale.deleteMany({where:{id:{in:saleIds}}});
      await db.moneyAccount.deleteMany({where:{id:input.accountId}});console.log(JSON.stringify({saleIds}));`,
          {
            accountId,
            purchaseId: fixtures?.purchaseId,
          },
        ),
      );
      for (const id of cleanup.saleIds)
        if (!createdSaleIds.includes(id)) createdSaleIds.push(id);
    } catch {
      // El informe y el estado final permiten diagnosticar una limpieza fallida.
    }
  }
  if (fixtures) {
    try {
      own(
        'inventory',
        `
      const operations=await db.saleStockOperation.findMany({where:{saleId:{in:input.saleIds}},select:{id:true}});const operationIds=operations.map(row=>row.id);
      await db.inventoryMovement.deleteMany({where:{itemId:input.itemId}});
      await db.saleStockOperation.deleteMany({where:{id:{in:operationIds}}});
      await db.inventoryBalance.deleteMany({where:{itemId:input.itemId}});
      await db.purchaseLine.deleteMany({where:{purchaseId:input.purchaseId}});
      await db.purchase.deleteMany({where:{id:input.purchaseId}});
      await db.supplier.deleteMany({where:{id:input.supplierId}});
      await db.catalogItem.deleteMany({where:{id:input.itemId}});
      await db.category.deleteMany({where:{id:input.categoryId}});`,
        { ...fixtures, saleIds: createdSaleIds },
      );
    } catch {
      // La limpieza se limita a fixtures; un fallo no autoriza ampliar el borrado.
    }
  }
  for (const email of users) {
    try {
      fixtureUser('delete', email);
    } catch {
      // Identity puede estar indisponible durante la limpieza best-effort.
    }
  }
  mkdirSync('artifacts/phase6', { recursive: true });
  writeFileSync(
    'artifacts/phase6/verification.json',
    JSON.stringify(
      { timestamp: new Date().toISOString(), checks, browserErrors },
      null,
      2,
    ),
  );
}
console.log('Fase 6 verificada con API, PostgreSQL y navegador reales.');
