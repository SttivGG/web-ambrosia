import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
const { Client } = createRequire(import.meta.url)(
  '/app/services/inventory-service/node_modules/pg',
);
const db = new Client({ connectionString: process.env.DATABASE_URL });
const suffix = randomBytes(8).toString('hex');
const names = ['supplier_upgrade_' + suffix, 'supplier_clean_' + suffix];
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
(async () => {
  await db.connect();
  try {
    for (const schema of names) {
      assert.match(schema, /^supplier_(upgrade|clean)_[a-f0-9]{16}$/);
      await db.query('CREATE SCHEMA "' + schema + '"');
    }
    await db.query('SET search_path TO "' + names[0] + '"');
    await db.query(
      fs
        .readFileSync(
          'services/inventory-service/prisma/migrations/202609170001_catalog/migration.sql',
          'utf8',
        )
        .replace('CREATE SCHEMA IF NOT EXISTS "public";', ''),
    );
    await db.query(
      `INSERT INTO "Category" ("id","name","normalizedName","slug","updatedAt") VALUES ('11111111-1111-4111-8111-111111111111','Conservar','conservar','conservar',now()); INSERT INTO "CatalogItem" ("id","sku","normalizedSku","name","normalizedName","itemType","categoryId","inventoryBaseUnit","defaultOperationUnit","updatedAt") VALUES ('22222222-2222-4222-8222-222222222222','CONSERVAR','CONSERVAR','Conservar','conservar','SUPPLY','11111111-1111-4111-8111-111111111111','UNIT','UNIT',now());`,
    );
    const before = (
      await db.query('SELECT row_to_json(t) AS value FROM "CatalogItem" t')
    ).rows;
    migrate(names[0], 'resolve', ['--applied', '202609170001_catalog']);
    for (const schema of names) {
      migrate(schema, 'deploy');
      migrate(schema, 'deploy');
      const count = await db.query(
        'SELECT count(*)::int AS n FROM "' +
          schema +
          '"."_prisma_migrations" WHERE finished_at IS NOT NULL',
      );
      assert.equal(count.rows[0].n, 3);
    }
    assert.deepEqual(
      (await db.query('SELECT row_to_json(t) AS value FROM "CatalogItem" t'))
        .rows,
      before,
    );
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM "Category"')).rows[0].n,
      1,
    );
  } finally {
    await db.query('SET search_path TO public');
    for (const schema of names)
      await db.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    await db.end();
  }
})().catch(() => {
  console.error('Falló ensayo aislado; no se migra public.');
  process.exitCode = 1;
});
