import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
const require = createRequire('/app/services/inventory-service/package.json');
const { Client } = require('pg');
const { PrismaClient } = require('./dist/generated/prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { PurchasesService } = require('./dist/purchases/purchases.service');
const { StockService } = require('./dist/purchases/stock.service');
const root = 'services/inventory-service/prisma/migrations/';
const migrations = fs
  .readdirSync(root)
  .filter((n) => /^\d/.test(n))
  .sort();
const names = ['purchase_upgrade_', 'purchase_clean_'].map(
  (n) => n + randomBytes(8).toString('hex'),
);
const db = new Client({ connectionString: process.env.DATABASE_URL });
function migrate(schema, command, extra = []) {
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema', schema);
  const r = spawnSync(
    'pnpm',
    [
      '--filter',
      '@ambrosia/inventory-service',
      'exec',
      'prisma',
      'migrate',
      command,
      ...extra,
    ],
    { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' },
  );
  assert.equal(r.status, 0, 'Prisma ' + command);
}
async function integration(schema) {
  const prisma = new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: process.env.DATABASE_URL,
        options: '-c search_path=' + schema,
      },
      { schema },
    ),
  });
  const stock = new StockService(prisma),
    purchases = new PurchasesService(prisma, stock),
    actor = randomUUID();
  try {
    const category = await prisma.category.create({
      data: { name: 'Prueba', normalizedName: 'prueba', slug: 'prueba' },
    });
    const items = [];
    for (let i = 0; i < 2; i++)
      items.push(
        await prisma.catalogItem.create({
          data: {
            sku: 'TEST-' + i,
            normalizedSku: 'TEST-' + i,
            name: 'Artículo ' + i,
            normalizedName: 'articulo ' + i,
            itemType: 'SUPPLY',
            categoryId: category.id,
            inventoryBaseUnit: 'GRAM',
            defaultOperationUnit: 'GRAM',
          },
        }),
      );
    const supplier = await prisma.supplier.create({
      data: {
        code: 'TEST',
        name: 'Prueba',
        items: { create: items.map((item) => ({ itemId: item.id })) },
      },
    });
    const data = {
      supplierId: supplier.id,
      reference: 'P-1',
      purchasedAt: new Date().toISOString(),
      lines: items.map((i) => ({
        itemId: i.id,
        quantity: '10',
        unitCost: '0.15',
      })),
    };
    let p = await purchases.create(data);
    assert.equal(p.total, '3.00');
    assert.equal((await stock.stock(items[0].id)).quantity, '0');
    p = await purchases.update(p.id, {
      ...data,
      expectedVersion: p.version,
      notes: 'Borrador editado',
    });
    const edit = await Promise.allSettled([
      purchases.update(p.id, {
        ...data,
        expectedVersion: p.version,
        notes: 'A',
      }),
      purchases.update(p.id, {
        ...data,
        expectedVersion: p.version,
        notes: 'B',
      }),
    ]);
    assert.equal(edit.filter((r) => r.status === 'fulfilled').length, 1);
    p = await purchases.get(p.id);
    const race = await Promise.allSettled([
      purchases.receive(p.id, p.version, actor),
      purchases.receive(p.id, p.version, actor),
    ]);
    assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
    for (const r of race.filter((r) => r.status === 'rejected'))
      assert.equal(r.reason.getStatus(), 409);
    assert.equal(await prisma.inventoryMovement.count(), 2);
    assert.equal((await stock.stock(items[0].id)).quantity, '10');
    p = await purchases.get(p.id);
    await assert.rejects(
      purchases.update(p.id, { ...data, expectedVersion: p.version }),
    );
    await assert.rejects(purchases.receive(p.id, p.version, actor));
    const adjustments = await Promise.allSettled(
      [1, 2].map(() =>
        stock.adjust(
          {
            itemId: items[0].id,
            type: 'ADJUSTMENT_OUT',
            quantity: '8',
            reason: 'Conteo físico',
            operationId: randomUUID(),
          },
          actor,
        ),
      ),
    );
    assert.equal(adjustments.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal((await stock.stock(items[0].id)).quantity, '2');
    await assert.rejects(
      purchases.cancel(p.id, p.version, 'Revertir compra', actor),
    );
    assert.equal((await purchases.get(p.id)).status, 'RECEIVED');
    assert.equal(
      await prisma.inventoryMovement.count({ where: { type: 'REVERSAL' } }),
      0,
    );
    const operationId = randomUUID();
    await stock.adjust(
      {
        itemId: items[0].id,
        type: 'ADJUSTMENT_IN',
        quantity: '8',
        reason: 'Reponer conteo',
        operationId,
      },
      actor,
    );
    await assert.rejects(
      stock.adjust(
        {
          itemId: items[0].id,
          type: 'ADJUSTMENT_IN',
          quantity: '8',
          reason: 'Reponer conteo',
          operationId,
        },
        actor,
      ),
    );
    await purchases.cancel(p.id, p.version, 'Reversión completa', actor);
    for (const item of items)
      assert.equal((await stock.stock(item.id)).quantity, '0');
    assert.equal(
      await prisma.inventoryMovement.count({ where: { type: 'REVERSAL' } }),
      2,
    );
    const cancelled = await purchases.create({ ...data, reference: 'CANCEL' });
    await purchases.cancel(
      cancelled.id,
      cancelled.version,
      'Cancelación borrador',
      actor,
    );
    assert.equal(await prisma.inventoryMovement.count(), 6);
    // Trigger-induced failure proves no purchase state, ledger or balance can partially commit.
    const rollback = await purchases.create({ ...data, reference: 'ROLLBACK' });
    await db.query('SET search_path TO "' + schema + '"');
    await db.query(
      `CREATE FUNCTION fail_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."itemId" = '${items.map((i) => i.id).sort()[1]}'::uuid THEN RAISE EXCEPTION 'isolated failure'; END IF; END $$; CREATE TRIGGER fail_movement BEFORE INSERT ON "InventoryMovement" FOR EACH ROW EXECUTE FUNCTION fail_movement();`,
    );
    try {
      await assert.rejects(
        purchases.receive(rollback.id, rollback.version, actor),
      );
    } finally {
      await db.query(
        'DROP TRIGGER fail_movement ON "InventoryMovement"; DROP FUNCTION fail_movement();',
      );
    }
    assert.equal((await purchases.get(rollback.id)).status, 'DRAFT');
    assert.equal(await prisma.inventoryMovement.count(), 6);
    for (const item of items)
      assert.equal((await stock.stock(item.id)).quantity, '0');
    // Tiny quantity and large money retain all decimal digits.
    const decimal = await purchases.create({
      ...data,
      reference: 'DECIMAL',
      lines: [
        { itemId: items[0].id, quantity: '1', unitCost: '9007199254740993.01' },
      ],
    });
    assert.equal(decimal.total, '9007199254740993.01');
    await purchases.receive(decimal.id, decimal.version, actor);
    assert.equal(
      (
        await stock.movements({
          page: 1,
          pageSize: 1,
          itemId: items[0].id,
          type: 'PURCHASE_IN',
        })
      ).pagination.totalItems,
      2,
    );
    assert.equal(
      (await stock.stocks({ page: 1, pageSize: 1, categoryId: category.id }))
        .data.length,
      1,
    );
    await assert.rejects(
      prisma.inventoryBalance.update({
        where: { itemId: items[0].id },
        data: { quantity: '-1' },
      }),
    );
    const reconciliation = await prisma.$queryRawUnsafe(
      `SELECT b."itemId" FROM "InventoryBalance" b LEFT JOIN "InventoryMovement" m ON m."itemId"=b."itemId" GROUP BY b."itemId",b.quantity HAVING b.quantity <> coalesce(sum(CASE WHEN m.type IN ('PURCHASE_IN','ADJUSTMENT_IN','PRODUCTION_RETURN') THEN m.quantity ELSE -m.quantity END),0)`,
    );
    assert.equal(reconciliation.length, 0);
    console.log(
      'PASS PostgreSQL: compras, redondeo, edición/recepción concurrente, ajustes concurrentes, idempotencia, reversión, rollback, filtros, constraints y reconciliación.',
    );
  } finally {
    await prisma.$disconnect();
  }
}
await db.connect();
try {
  for (const name of names) {
    assert.match(name, /^purchase_(upgrade|clean)_[a-f0-9]{16}$/);
    await db.query('CREATE SCHEMA "' + name + '"');
  }
  await db.query('SET search_path TO "' + names[0] + '"');
  for (const migration of migrations.slice(0, 2)) {
    await db.query(
      fs
        .readFileSync(root + migration + '/migration.sql', 'utf8')
        .replace('CREATE SCHEMA IF NOT EXISTS "public";', ''),
    );
    migrate(names[0], 'resolve', ['--applied', migration]);
  }
  await db.query(
    `INSERT INTO "Category" ("id","name","normalizedName","slug","updatedAt") VALUES ('11111111-1111-4111-8111-111111111111','Conservar','conservar','conservar',now()); INSERT INTO "Supplier" ("id","code","name","updatedAt") VALUES ('22222222-2222-4222-8222-222222222222','CONSERVAR','Conservar',now());`,
  );
  const before = (
    await db.query('SELECT row_to_json(t) AS value FROM "Supplier" t')
  ).rows;
  for (const name of names) {
    migrate(name, 'deploy');
    migrate(name, 'deploy');
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM "' +
            name +
            '"."_prisma_migrations" WHERE finished_at IS NOT NULL',
        )
      ).rows[0].n,
      migrations.length,
    );
  }
  assert.deepEqual(
    (await db.query('SELECT row_to_json(t) AS value FROM "Supplier" t')).rows,
    before,
  );
  await integration(names[1]);
  console.log(
    'PASS migración limpia y actualización 2B, conservación e idempotencia.',
  );
} finally {
  await db.query('SET search_path TO public');
  for (const name of names)
    await db.query('DROP SCHEMA IF EXISTS "' + name + '" CASCADE');
  await db.end();
}
