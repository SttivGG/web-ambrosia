import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
const serviceName = process.argv[2];
assert.ok(['inventory', 'finance-reporting'].includes(serviceName));
const require = createRequire(
  '/app/services/' + serviceName + '-service/package.json',
);
const { Client } = require('pg');
const { PrismaClient } = require('./dist/generated/prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const database = new Client({ connectionString: process.env.DATABASE_URL });
const prefix = serviceName === 'inventory' ? 'inventory' : 'finance';
const schemas = ['clean', 'upgrade'].map(
  (kind) =>
    'phase6_' + prefix + '_' + kind + '_' + randomBytes(6).toString('hex'),
);
const root = 'services/' + serviceName + '-service/prisma/migrations/';
const migrations = fs
  .readdirSync(root)
  .filter((name) => /^\d/.test(name))
  .sort();
function migrate(schema, command = 'deploy', extra = []) {
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema', schema);
  const result = spawnSync(
    'pnpm',
    [
      '--filter',
      '@ambrosia/' + serviceName + '-service',
      'exec',
      'prisma',
      'migrate',
      command,
      ...extra,
    ],
    { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
}
function client(schema) {
  return new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: process.env.DATABASE_URL,
        options: '-c search_path=' + schema,
      },
      { schema },
    ),
  });
}
async function inventoryChecks(schema) {
  const db = client(schema);
  const { StockService } = require('./dist/purchases/stock.service');
  const { SaleStockService } = require('./dist/finance/sale-stock.service');
  const stock = new StockService(db),
    sales = new SaleStockService(db, stock);
  const actorId = randomUUID();
  try {
    const category = await db.category.create({
      data: { name: 'Venta', normalizedName: 'venta', slug: 'venta' },
    });
    const item = await db.catalogItem.create({
      data: {
        sku: 'F6-UNIT',
        normalizedSku: 'F6-UNIT',
        name: 'Yogurt unitario',
        normalizedName: 'yogurt unitario',
        itemType: 'FINISHED_PRODUCT',
        categoryId: category.id,
        inventoryBaseUnit: 'UNIT',
        defaultOperationUnit: 'UNIT',
      },
    });
    await stock.adjust(
      {
        itemId: item.id,
        type: 'ADJUSTMENT_IN',
        quantity: '2',
        reason: 'Saldo inicial',
        operationId: randomUUID(),
      },
      actorId,
    );
    const request = {
      operationId: randomUUID(),
      saleId: randomUUID(),
      kind: 'CONFIRM',
      actorId,
      reason: 'Venta aislada',
      lines: [{ itemId: item.id, quantity: '1' }],
    };
    const result = await sales.execute(request);
    assert.equal(result.status, 'CONFIRMED');
    assert.deepEqual(await sales.execute(request), result);
    assert.equal((await stock.stock(item.id)).quantity, '1');
    await assert.rejects(
      sales.execute({ ...request, reason: 'Payload distinto' }),
    );
    const insufficient = await sales.execute({
      ...request,
      operationId: randomUUID(),
      saleId: randomUUID(),
      lines: [{ itemId: item.id, quantity: '3' }],
    });
    assert.equal(insufficient.status, 'REJECTED');
    assert.equal((await stock.stock(item.id)).quantity, '1');
    const cancel = {
      ...request,
      operationId: randomUUID(),
      kind: 'CANCEL',
      originalOperationId: request.operationId,
      reason: 'Anulación aislada',
    };
    const returned = await sales.execute(cancel);
    assert.equal(returned.status, 'CONFIRMED');
    assert.deepEqual(await sales.execute(cancel), returned);
    assert.equal((await stock.stock(item.id)).quantity, '2');
    const raceA = {
      ...request,
      operationId: randomUUID(),
      saleId: randomUUID(),
      lines: [{ itemId: item.id, quantity: '2' }],
    };
    const raceB = { ...raceA, operationId: randomUUID(), saleId: randomUUID() };
    await Promise.allSettled([sales.execute(raceA), sales.execute(raceB)]);
    const outcomes = await Promise.all([
      sales.execute(raceA),
      sales.execute(raceB),
    ]);
    assert.equal(
      outcomes.filter((entry) => entry.status === 'CONFIRMED').length,
      1,
    );
    assert.equal((await stock.stock(item.id)).quantity, '0');
    const ledger = await db.$queryRawUnsafe(
      `SELECT b."itemId" FROM "InventoryBalance" b LEFT JOIN "InventoryMovement" m ON m."itemId"=b."itemId" GROUP BY b."itemId",b.quantity HAVING b.quantity <> coalesce(sum(CASE WHEN m.type IN ('PURCHASE_IN','ADJUSTMENT_IN','PRODUCTION_RETURN','PRODUCTION_IN','PACKAGED_PRODUCT_IN','SALE_RETURN') THEN m.quantity ELSE -m.quantity END),0)`,
    );
    assert.equal(ledger.length, 0);
    console.log(
      'PASS PostgreSQL Inventory F6: venta idempotente, stock insuficiente, carrera, anulación y ledger.',
    );
  } finally {
    await db.$disconnect();
  }
}
async function financeChecks(schema) {
  const db = client(schema);
  const { FinanceService } = require('./dist/finance/finance.service');
  const snapshot = {
    id: randomUUID(),
    reference: 'F6-COMPRA',
    status: 'RECEIVED',
    total: '10000.00',
    currency: 'COP',
    supplier: { id: randomUUID(), code: 'F6', name: 'Proveedor F6' },
    purchasedAt: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    version: 2,
  };
  let failOnce = true;
  const inventory = {
    purchase: async () => snapshot,
    execute: async (payload) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('respuesta perdida');
      }
      return {
        operationId: payload.operationId,
        saleId: payload.saleId,
        status: 'CONFIRMED',
        error: null,
        movements: [randomUUID()],
      };
    },
  };
  const finance = new FinanceService(db, inventory);
  const actorId = randomUUID();
  try {
    const account = await finance.createAccount({
      code: 'CAJA-F6',
      name: 'Caja F6',
      type: 'CASH',
      description: null,
    });
    await finance.createMovement(
      {
        operationId: randomUUID(),
        accountId: account.id,
        kind: 'ADDITIONAL_INCOME',
        amount: '0.10',
        paymentMethod: 'CASH',
        occurredAt: new Date().toISOString(),
        reference: null,
        description: 'Decimal exacto',
      },
      actorId,
    );
    await finance.createPayment(
      {
        operationId: randomUUID(),
        purchaseId: snapshot.id,
        accountId: account.id,
        amount: '4000.00',
        paymentMethod: 'BANK_TRANSFER',
        occurredAt: new Date().toISOString(),
        reference: null,
        description: null,
      },
      actorId,
    );
    const attempts = await Promise.allSettled(
      ['6000.00', '6000.00'].map((amount) =>
        finance.createPayment(
          {
            operationId: randomUUID(),
            purchaseId: snapshot.id,
            accountId: account.id,
            amount,
            paymentMethod: 'BANK_TRANSFER',
            occurredAt: new Date().toISOString(),
            reference: null,
            description: null,
          },
          actorId,
        ),
      ),
    );
    assert.equal(
      attempts.filter((entry) => entry.status === 'fulfilled').length,
      1,
    );
    assert.equal(
      (
        await db.purchasePayment.aggregate({
          where: { purchaseId: snapshot.id },
          _sum: { amount: true },
        })
      )._sum.amount.toFixed(),
      '10000',
    );
    const saleId = randomUUID(),
      operationId = randomUUID(),
      itemId = randomUUID();
    const payload = {
      operationId,
      saleId,
      kind: 'CONFIRM',
      actorId,
      reason: 'Venta recuperable',
      lines: [{ itemId, quantity: '1' }],
    };
    await db.sale.create({
      data: {
        id: saleId,
        accountId: account.id,
        subtotal: '3333.33',
        total: '3333.33',
        paymentMethod: 'CASH',
        occurredAt: new Date(),
        actorId,
        lines: {
          create: {
            itemId,
            sku: 'F6',
            name: 'Producto F6',
            quantity: 1,
            unitPrice: '3333.33',
            subtotal: '3333.33',
          },
        },
        operations: { create: { id: operationId, kind: 'CONFIRM', payload } },
      },
    });
    const operation = await db.saleOperation.findUniqueOrThrow({
      where: { id: operationId },
    });
    await assert.rejects(finance.resolve(operation), /respuesta perdida/);
    assert.equal(await db.financeMovement.count({ where: { saleId } }), 0);
    const restarted = new FinanceService(db, inventory);
    await restarted.resolve(operation);
    assert.equal(await db.financeMovement.count({ where: { saleId } }), 1);
    assert.equal(
      (await db.sale.findUniqueOrThrow({ where: { id: saleId } })).status,
      'CONFIRMED',
    );
    console.log(
      'PASS PostgreSQL Finance F6: Decimal, pagos parciales/concurrentes y recuperación tras reinicio lógico.',
    );
  } finally {
    await db.$disconnect();
  }
}
await database.connect();
try {
  for (const schema of schemas)
    await database.query('CREATE SCHEMA "' + schema + '"');
  if (serviceName === 'inventory') {
    await database.query('SET search_path TO "' + schemas[1] + '"');
    for (const migration of migrations.filter(
      (name) => name < '202609260001',
    )) {
      const sql = fs
        .readFileSync(root + migration + '/migration.sql', 'utf8')
        .replace('CREATE SCHEMA IF NOT EXISTS "public";', '');
      for (const statement of sql
        .split(/;\s*(?:\r?\n|$)/)
        .map((value) => value.trim())
        .filter(Boolean))
        await database.query(statement);
      migrate(schemas[1], 'resolve', ['--applied', migration]);
    }
    await database.query(
      `INSERT INTO "Category" (id,name,"normalizedName",slug,"updatedAt") VALUES ('11111111-1111-4111-8111-111111111111','Conservar','conservar','conservar',now())`,
    );
  }
  for (const schema of schemas) {
    migrate(schema);
    migrate(schema);
  }
  if (serviceName === 'inventory') {
    assert.equal(
      (
        await database.query(
          'SELECT count(*)::int n FROM "' + schemas[1] + '"."Category"',
        )
      ).rows[0].n,
      1,
    );
    await inventoryChecks(schemas[0]);
  } else await financeChecks(schemas[0]);
  console.log(
    'PASS ' +
      serviceName +
      ': instalación limpia, actualización aditiva y deploy repetido.',
  );
} finally {
  await database.query('SET search_path TO public');
  for (const schema of schemas)
    await database.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
  await database.end();
}
