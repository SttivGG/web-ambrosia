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
  (n) => 'phase5_' + n + '_' + randomBytes(8).toString('hex'),
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
    const bulk = await prisma.catalogItem.create({
      data: {
        sku: 'F5-BULK',
        normalizedSku: 'F5-BULK',
        name: 'Producto a granel',
        normalizedName: 'producto a granel',
        itemType: 'FINISHED_PRODUCT',
        categoryId: category.id,
        inventoryBaseUnit: 'GRAM',
        defaultOperationUnit: 'GRAM',
      },
    });
    const presentation = await prisma.catalogItem.create({
      data: {
        sku: 'F5-PRESENTATION',
        normalizedSku: 'F5-PRESENTATION',
        name: 'Presentación 270 g',
        normalizedName: 'presentación 270 g',
        itemType: 'FINISHED_PRODUCT',
        categoryId: category.id,
        inventoryBaseUnit: 'UNIT',
        defaultOperationUnit: 'UNIT',
        nominalCapacityValue: '270',
        nominalCapacityUnit: 'GRAM',
      },
    });
    const packaging = await prisma.catalogItem.create({
      data: {
        sku: 'F5-PACKAGING',
        normalizedSku: 'F5-PACKAGING',
        name: 'Envase',
        normalizedName: 'envase',
        itemType: 'PACKAGING',
        categoryId: category.id,
        inventoryBaseUnit: 'UNIT',
        defaultOperationUnit: 'UNIT',
      },
    });
    await stock.adjust(
      {
        itemId: packaging.id,
        quantity: '10',
        type: 'ADJUSTMENT_IN',
        reason: 'Empaques iniciales',
        operationId: randomUUID(),
      },
      actor,
    );
    const productionId = randomUUID();
    const yieldRequest = {
      operationId: randomUUID(),
      productionId,
      actorId: actor,
      kind: 'YIELD',
      reason: 'Rendimiento aislado',
      output: { itemId: bulk.id, baseUnit: 'GRAM', quantity: '540' },
    };
    const yieldResult = await service.execute(yieldRequest);
    assert.equal(yieldResult.status, 'CONFIRMED');
    assert.deepEqual(await service.execute(yieldRequest), yieldResult);
    await assert.rejects(
      service.execute({ ...yieldRequest, reason: 'Payload diferente' }),
    );
    assert.equal((await stock.stock(bulk.id)).quantity, '540');
    const packageRequest = {
      operationId: randomUUID(),
      productionId,
      actorId: actor,
      kind: 'PACKAGE',
      reason: 'Envasado aislado',
      source: { itemId: bulk.id, baseUnit: 'GRAM', quantity: '540' },
      materials: [{ itemId: packaging.id, baseUnit: 'UNIT', quantity: '2' }],
      output: {
        itemId: presentation.id,
        baseUnit: 'UNIT',
        quantity: '2',
      },
    };
    await Promise.allSettled([
      service.execute(packageRequest),
      service.execute(packageRequest),
    ]);
    const packaged = await service.execute(packageRequest);
    assert.equal(packaged.status, 'CONFIRMED');
    assert.deepEqual(await service.execute(packageRequest), packaged);
    assert.equal((await stock.stock(bulk.id)).quantity, '0');
    assert.equal((await stock.stock(packaging.id)).quantity, '8');
    assert.equal((await stock.stock(presentation.id)).quantity, '2');
    const raceProduction = randomUUID();
    await service.execute({
      ...yieldRequest,
      operationId: randomUUID(),
      productionId: raceProduction,
      output: { ...yieldRequest.output, quantity: '270' },
    });
    const race = (operationId) => ({
      ...packageRequest,
      operationId,
      productionId: raceProduction,
      source: { ...packageRequest.source, quantity: '270' },
      materials: [{ ...packageRequest.materials[0], quantity: '1' }],
      output: { ...packageRequest.output, quantity: '1' },
    });
    const raceA = race(randomUUID()),
      raceB = race(randomUUID());
    await Promise.allSettled([service.execute(raceA), service.execute(raceB)]);
    const raceResults = await Promise.all([
      service.execute(raceA),
      service.execute(raceB),
    ]);
    assert.equal(
      raceResults.filter((entry) => entry.status === 'CONFIRMED').length,
      1,
    );
    assert.equal((await stock.stock(bulk.id)).quantity, '0');
    const reconciliation = await prisma.$queryRawUnsafe(
      'SELECT b."itemId" FROM "InventoryBalance" b LEFT JOIN "InventoryMovement" m ON m."itemId"=b."itemId" GROUP BY b."itemId",b.quantity HAVING b.quantity <> coalesce(sum(CASE WHEN m.type IN (' +
        "'PURCHASE_IN','ADJUSTMENT_IN','PRODUCTION_RETURN','PRODUCTION_IN','PACKAGED_PRODUCT_IN'" +
        ') THEN m.quantity ELSE -m.quantity END),0)',
    );
    assert.equal(reconciliation.length, 0);
    console.log(
      'PASS PostgreSQL Inventory: rendimiento y envasado idempotentes, payload distinto, rollback, competencia concurrente, saldo no negativo y ledger consistente.',
    );
  } finally {
    await prisma.$disconnect();
  }
}
await db.connect();
try {
  for (const name of names) {
    assert.match(name, /^phase5_(clean|upgrade)_[a-f0-9]{16}$/);
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
