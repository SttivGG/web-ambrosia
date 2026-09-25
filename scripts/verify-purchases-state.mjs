import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const args = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infrastructure/docker-compose.yml',
];
function run(command, input) {
  const r = spawnSync('docker', command, {
    encoding: 'utf8',
    input,
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(r.status, 0, 'Comprobación Docker ' + command[0]);
  return r.stdout;
}
const sql = (query) =>
  run(
    [
      ...args,
      'exec',
      '-T',
      'postgres',
      'sh',
      '-c',
      'PGPASSWORD="$INVENTORY_DB_PASSWORD" psql -h 127.0.0.1 -U inventory_user -d ambrosia_inventory -At -v ON_ERROR_STOP=1',
    ],
    query,
  );
const snapshot = sql(
  `SELECT json_build_object('categories',(SELECT coalesce(json_agg(t ORDER BY t.id),'[]'::json) FROM "Category" t),'items',(SELECT coalesce(json_agg(t ORDER BY t.id),'[]'::json) FROM "CatalogItem" t),'suppliers',(SELECT coalesce(json_agg(t ORDER BY t.id),'[]'::json) FROM "Supplier" t),'links',(SELECT coalesce(json_agg(t ORDER BY t."supplierId",t."itemId"),'[]'::json) FROM "SupplierItem" t));`,
);
assert.equal(
  snapshot,
  readFileSync('artifacts/phase3/original-inventory.json', 'utf8'),
  'Datos originales conservados exactamente',
);
assert.equal(
  sql(`SELECT count(*) FROM "Purchase" WHERE reference LIKE 'F3-%';`).trim(),
  '0',
);
assert.equal(
  sql(
    `SELECT count(*) FROM information_schema.schemata WHERE schema_name ~ '^purchase_(upgrade|clean)_[a-f0-9]{16}$';`,
  ).trim(),
  '0',
);
assert.equal(
  sql(
    `WITH ledger AS (SELECT "itemId",sum(CASE WHEN type IN ('PURCHASE_IN','ADJUSTMENT_IN','PRODUCTION_RETURN') THEN quantity ELSE -quantity END) q FROM "InventoryMovement" GROUP BY "itemId") SELECT count(*) FROM ledger l FULL JOIN "InventoryBalance" b ON l."itemId"=b."itemId" WHERE coalesce(l.q,0) <> coalesce(b.quantity,0) OR b."itemId" IS NULL;`,
  ).trim(),
  '0',
);
const identity = `const {PrismaService}=require('./dist/database/prisma.service');const {ConfigService}=require('@nestjs/config');const db=new PrismaService(new ConfigService({DATABASE_URL:process.env.DATABASE_URL}));db.user.count({where:{email:{startsWith:'fase3.'}}}).then(n=>{if(n)process.exitCode=1;else console.log('0');}).finally(()=>db.$disconnect());`;
assert.equal(
  run([
    ...args,
    'exec',
    '-T',
    'identity-service',
    'node',
    '-e',
    identity,
  ]).trim(),
  '0',
);
const rows = run([...args, 'ps', '--format', 'json'])
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map(JSON.parse);
assert.equal(rows.length, 8);
assert.ok(rows.every((r) => r.State === 'running' && r.Health === 'healthy'));
assert.deepEqual(
  rows
    .filter((r) => (r.Publishers ?? []).some((p) => p.PublishedPort > 0))
    .map((r) => r.Service),
  ['gateway'],
);
assert.ok(
  rows
    .filter((r) => r.Service === 'gateway')
    .every((r) => r.Publishers.every((p) => p.PublishedPort === 8080)),
);
const temporary = run([
  'ps',
  '--filter',
  'label=com.docker.compose.project=ambrosia',
  '--filter',
  'label=com.docker.compose.oneoff=True',
  '--format',
  '{{.Names}}',
]).trim();
assert.equal(temporary, '');
const result = {
  timestamp: new Date().toISOString(),
  preserved: true,
  originalSha256: createHash('sha256').update(snapshot).digest('hex'),
  fixturesRemoved: true,
  reconciled: true,
  containers: rows.map((r) => ({
    service: r.Service,
    state: r.State,
    health: r.Health,
    ports: r.Ports,
  })),
  onlyGateway8080: true,
  noTemporaryContainers: true,
};
writeFileSync(
  'artifacts/phase3/final-state.json',
  JSON.stringify(result, null, 2),
);
console.log(
  'PASS datos originales idénticos, ledger reconciliado, fixtures eliminados, ocho contenedores saludables y solo gateway:8080.',
);
