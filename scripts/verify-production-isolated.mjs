import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
const service = process.argv[2];
assert.ok(['inventory', 'production'].includes(service));
const require = createRequire(
  '/app/services/' + service + '-service/package.json',
);
const { Client } = require('pg'),
  { PrismaClient } = require('./dist/generated/prisma/client'),
  { PrismaPg } = require('@prisma/adapter-pg');
const db = new Client({ connectionString: process.env.DATABASE_URL });
const names = ['clean', 'upgrade'].map(
  (n) => 'phase4_' + n + '_' + randomBytes(8).toString('hex'),
);
const root = 'services/' + service + '-service/prisma/migrations/';
const migrations = fs
  .readdirSync(root)
  .filter((n) => /^\d/.test(n))
  .sort();
function migrate(schema, command = 'deploy', extra = []) {
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema', schema);
  const r = spawnSync(
    'pnpm',
    [
      '--filter',
      '@ambrosia/' + service + '-service',
      'exec',
      'prisma',
      'migrate',
      command,
      ...extra,
    ],
    { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8' },
  );
  assert.equal(r.status, 0, 'Migración aislada: ' + r.stderr);
}
async function inventory(schema) {
  const prisma = new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: process.env.DATABASE_URL,
        options: '-c search_path=' + schema,
      },
      { schema },
    ),
  });
  const { StockService } = require('./dist/purchases/stock.service'),
    {
      ProductionStockService,
    } = require('./dist/production/production-stock.service');
  const stock = new StockService(prisma),
    service = new ProductionStockService(prisma, stock),
    actor = randomUUID();
  try {
    const category = await prisma.category.create({
      data: { name: 'Prueba', normalizedName: 'prueba', slug: 'prueba' },
    });
    const items = [];
    for (let i = 0; i < 2; i++) {
      const item = await prisma.catalogItem.create({
        data: {
          sku: 'F4-' + i,
          normalizedSku: 'F4-' + i,
          name: 'Insumo ' + i,
          normalizedName: 'insumo ' + i,
          itemType: 'RAW_MATERIAL',
          categoryId: category.id,
          inventoryBaseUnit: 'GRAM',
          defaultOperationUnit: 'GRAM',
        },
      });
      items.push(item);
      await stock.adjust(
        {
          itemId: item.id,
          quantity: '10',
          type: 'ADJUSTMENT_IN',
          reason: 'Saldo inicial',
          operationId: randomUUID(),
        },
        actor,
      );
    }
    const request = (quantity = '3') => ({
      operationId: randomUUID(),
      productionId: randomUUID(),
      actorId: actor,
      kind: 'CONSUME',
      originalOperationId: null,
      reason: 'Prueba producción',
      lines: items.map((i) => ({ itemId: i.id, baseUnit: 'GRAM', quantity })),
    });
    const first = request();
    await Promise.allSettled([service.execute(first), service.execute(first)]);
    const result = await service.execute(first);
    assert.equal(result.status, 'CONFIRMED');
    assert.equal(result.movements.length, 2);
    assert.deepEqual(await service.execute(first), result);
    assert.deepEqual(
      await service.execute({
        ...first,
        operationId: first.operationId.toUpperCase(),
        lines: first.lines.map((l) => ({
          ...l,
          itemId: l.itemId.toUpperCase(),
        })),
      }),
      result,
    );
    assert.deepEqual(await service.get(first.operationId), result);
    await assert.rejects(
      service.execute({ ...first, reason: 'Otra solicitud' }),
    );
    assert.equal((await stock.stock(items[0].id)).quantity, '7');
    const reverse = {
      ...first,
      operationId: randomUUID(),
      kind: 'REVERSE',
      originalOperationId: first.operationId,
      reason: 'Cancelar lote',
    };
    const reversed = await service.execute(reverse);
    assert.equal(reversed.status, 'CONFIRMED');
    assert.deepEqual(await service.execute(reverse), reversed);
    assert.equal((await stock.stock(items[0].id)).quantity, '10');
    assert.ok(
      reversed.movements.every((m) =>
        result.movements.some((o) => o.id === m.reversesId),
      ),
    );
    const insufficient = await service.execute(request('11'));
    assert.equal(insufficient.status, 'REJECTED');
    assert.equal(insufficient.movements.length, 0);
    // Inject a database failure after the first line has already changed stock.
    const count = await prisma.inventoryMovement.count();
    await prisma.$executeRawUnsafe(
      'CREATE FUNCTION fail_production() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."itemId" = ' +
        "'" +
        items.map((i) => i.id).sort()[1] +
        "'" +
        '::uuid AND NEW.type = ' +
        "'PRODUCTION_OUT'" +
        ' THEN RAISE EXCEPTION ' +
        "'test rollback'" +
        '; END IF; RETURN NEW; END $$',
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER fail_production BEFORE INSERT ON "InventoryMovement" FOR EACH ROW EXECUTE FUNCTION fail_production()',
    );
    const failed = request();
    await assert.rejects(service.execute(failed));
    assert.equal(
      await prisma.productionStockOperation.count({
        where: { id: failed.operationId },
      }),
      0,
    );
    assert.equal(await prisma.inventoryMovement.count(), count);
    assert.equal((await stock.stock(items[0].id)).quantity, '10');
    assert.equal((await stock.stock(items[1].id)).quantity, '10');
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER fail_production ON "InventoryMovement"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION fail_production()');
    // Two productions competing for ten units. Retry serializable aborts with the SAME ID.
    const a = request('8'),
      b = request('8');
    await Promise.allSettled([service.execute(a), service.execute(b)]);
    const ra = await service.execute(a),
      rb = await service.execute(b);
    assert.equal([ra, rb].filter((r) => r.status === 'CONFIRMED').length, 1);
    assert.equal((await stock.stock(items[0].id)).quantity, '2');
    await assert.rejects(
      prisma.inventoryBalance.update({
        where: { itemId: items[0].id },
        data: { quantity: '-1' },
      }),
    );
    const winner = ra.status === 'CONFIRMED' ? a : b;
    const alt = await service.execute({ ...winner, operationId: randomUUID() });
    assert.equal(alt.status, 'REJECTED');
    const reconciliation = await prisma.$queryRawUnsafe(
      'SELECT b."itemId" FROM "InventoryBalance" b LEFT JOIN "InventoryMovement" m ON m."itemId"=b."itemId" GROUP BY b."itemId",b.quantity HAVING b.quantity <> coalesce(sum(CASE WHEN m.type IN (' +
        "'PURCHASE_IN','ADJUSTMENT_IN','PRODUCTION_RETURN'" +
        ') THEN m.quantity ELSE -m.quantity END),0)',
    );
    assert.equal(reconciliation.length, 0);
    console.log(
      'PASS PostgreSQL Inventory: duplicados, payload distinto, compensación idempotente, rechazo persistente, rollback después de primera línea, dos producciones concurrentes, saldo no negativo y ledger consistente.',
    );
  } finally {
    await prisma.$disconnect();
  }
}
await db.connect();
try {
  for (const name of names) {
    assert.match(name, /^phase4_(clean|upgrade)_[a-f0-9]{16}$/);
    await db.query('CREATE SCHEMA "' + name + '"');
  }
  if (service === 'inventory') {
    await db.query('SET search_path TO "' + names[1] + '"');
    for (const migration of migrations.filter((n) => n < '20260924')) {
      await db.query(
        fs
          .readFileSync(root + migration + '/migration.sql', 'utf8')
          .replace('CREATE SCHEMA IF NOT EXISTS "public";', ''),
      );
      migrate(names[1], 'resolve', ['--applied', migration]);
    }
    await db.query(
      'INSERT INTO "Category" (id,name,"normalizedName",slug,"updatedAt") VALUES (' +
        "'11111111-1111-4111-8111-111111111111','Conservar','conservar','conservar',now()" +
        ')',
    );
  }
  for (const name of names) {
    migrate(name);
    migrate(name);
  }
  if (service === 'inventory') {
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int n FROM "' + names[1] + '"."Category"',
        )
      ).rows[0].n,
      1,
    );
    await inventory(names[0]);
  }
  console.log(
    'PASS ' +
      service +
      ': instalación limpia, actualización aislada y deploy repetido.',
  );
} finally {
  await db.query('SET search_path TO public');
  for (const name of names)
    await db.query('DROP SCHEMA IF EXISTS "' + name + '" CASCADE');
  await db.end();
}
