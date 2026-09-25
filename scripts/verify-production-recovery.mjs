import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const require = createRequire('/app/services/production-service/package.json');
const { Client } = require('pg'),
  { PrismaClient } = require('./dist/generated/prisma/client'),
  { PrismaPg } = require('@prisma/adapter-pg');
const { ProductionService } = require('./dist/production/production.service'),
  { InventoryClient } = require('./dist/production/inventory.client');
let text = '';
for await (const chunk of process.stdin) text += chunk;
const input = JSON.parse(text);
const schema = 'phase4_recovery_' + randomBytes(8).toString('hex');
assert.match(schema, /^phase4_recovery_[a-f0-9]{16}$/);
const pg = new Client({ connectionString: process.env.DATABASE_URL });
await pg.connect();
let db;
try {
  await pg.query('CREATE SCHEMA "' + schema + '"');
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('schema', schema);
  const migrated = spawnSync(
    'pnpm',
    [
      '--filter',
      '@ambrosia/production-service',
      'exec',
      'prisma',
      'migrate',
      'deploy',
    ],
    { env: { ...process.env, DATABASE_URL: url.toString() }, encoding: 'utf8' },
  );
  assert.equal(migrated.status, 0, migrated.stderr);
  db = new PrismaClient({
    adapter: new PrismaPg(
      {
        connectionString: process.env.DATABASE_URL,
        options: '-c search_path=' + schema,
      },
      { schema },
    ),
  });
  const client = new InventoryClient(),
    service = new ProductionService(db, client);
  const formula = await service.saveFormula({
    name: 'Recuperación',
    productId: input.productId,
    baseUnit: 'GRAM',
    active: true,
    ingredients: [{ itemId: input.itemId, quantity: '1', baseUnit: 'GRAM' }],
  });
  const create = (batch) =>
    service.save(
      {
        batch,
        formulaId: formula.id,
        quantity: '2',
        scheduledAt: new Date().toISOString(),
      },
      input.actorId,
    );
  let order = await create('BEFORE');
  const before = new ProductionService(db, {
    execute: async () => {
      throw Error('network before consumption');
    },
  });
  await assert.rejects(
    before.transition(order.id, order.version, 'start', input.actorId),
  );
  order = await service.get(order.id);
  assert.equal(order.status, 'DRAFT');
  assert.equal(order.operations[0].status, 'PENDING');
  const beforeId = order.operations[0].id;
  order = await service.reconcile(order.id);
  assert.equal(order.status, 'IN_PROGRESS');
  assert.equal(order.operations[0].id, beforeId);
  assert.equal(order.operations[0].status, 'CONFIRMED');
  let after = await create('AFTER');
  let consumed;
  const lost = new ProductionService(db, {
    execute: async (p) => {
      consumed = await client.execute(p);
      throw Error('timeout after commit');
    },
  });
  await assert.rejects(
    lost.transition(after.id, after.version, 'start', input.actorId),
  );
  after = await service.get(after.id);
  assert.equal(after.status, 'DRAFT');
  assert.equal(after.operations[0].status, 'PENDING');
  assert.equal(consumed.status, 'CONFIRMED');
  const newProcess = new ProductionService(db, client);
  await newProcess.recover();
  after = await service.get(after.id);
  assert.equal(after.status, 'IN_PROGRESS');
  assert.deepEqual(after.operations[0].result.movements, consumed.movements);
  // An actual PostgreSQL failure in Production after Inventory commits.
  let local = await create('LOCAL');
  await db.$executeRawUnsafe(
    'CREATE FUNCTION fail_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status = ' +
      "'CONFIRMED'" +
      ' THEN RAISE EXCEPTION ' +
      "'local failure'" +
      '; END IF; RETURN NEW; END $$',
  );
  await db.$executeRawUnsafe(
    'CREATE TRIGGER fail_confirmation BEFORE UPDATE ON "ProductionOperation" FOR EACH ROW EXECUTE FUNCTION fail_confirmation()',
  );
  await assert.rejects(
    service.transition(local.id, local.version, 'start', input.actorId),
  );
  local = await service.get(local.id);
  assert.equal(local.status, 'DRAFT');
  const localId = local.operations[0].id;
  assert.equal(
    (await client.request('operations/' + localId)).status,
    'CONFIRMED',
  );
  await db.$executeRawUnsafe(
    'DROP TRIGGER fail_confirmation ON "ProductionOperation"',
  );
  await db.$executeRawUnsafe('DROP FUNCTION fail_confirmation()');
  await newProcess.recover();
  local = await service.get(local.id);
  assert.equal(local.status, 'IN_PROGRESS');
  assert.equal(local.operations[0].id, localId);
  await assert.rejects(
    lost.transition(
      after.id,
      after.version,
      'cancel',
      input.actorId,
      'Compensación tras timeout',
    ),
  );
  after = await service.get(after.id);
  assert.equal(after.status, 'IN_PROGRESS');
  await newProcess.recover();
  after = await service.get(after.id);
  assert.equal(after.status, 'CANCELLED');
  assert.equal(after.operations.length, 2);
  assert.equal(
    after.operations[1].result.movements[0].reversesId,
    after.operations[0].result.movements[0].id,
  );
  await service.reconcile(after.id);
  assert.equal((await service.get(after.id)).operations.length, 2);
  const edited = await service.saveFormula(
    { ...formula, name: 'Nueva revisión' },
    formula.id,
    formula.version,
  );
  assert.equal(edited.version, 2);
  assert.equal((await service.get(order.id)).formula.version, 1);
  order = await service.transition(
    order.id,
    order.version,
    'complete',
    input.actorId,
  );
  assert.equal(order.status, 'COMPLETED');
  await assert.rejects(
    service.transition(
      order.id,
      order.version,
      'cancel',
      input.actorId,
      'No permitido',
    ),
  );
  const draft = await create('DRAFT');
  assert.equal(
    (
      await service.transition(
        draft.id,
        draft.version,
        'cancel',
        input.actorId,
        'Sin consumo',
      )
    ).operations.length,
    0,
  );
  console.log(
    'PASS recuperación real: fallo antes del consumo, respuesta perdida, fallo PostgreSQL local después de consumo, nuevo proceso, mismo UUID, compensación recuperable, historial de fórmula, cierre y cancelación de borrador.',
  );
} finally {
  if (db) await db.$disconnect();
  await pg.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
  await pg.end();
}
