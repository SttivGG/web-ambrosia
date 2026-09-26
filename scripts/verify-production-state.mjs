import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const args = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infrastructure/docker-compose.yml',
];
function run(command, input) {
  const r = spawnSync('docker', [...args, ...command], {
    input,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  assert.equal(r.status, 0, 'Verificación local de datos');
  return r.stdout.trim();
}
function sql(service, query) {
  return run(
    [
      'exec',
      '-T',
      'postgres',
      'sh',
      '-c',
      'PGPASSWORD="$' +
        service.toUpperCase() +
        '_DB_PASSWORD" psql -h 127.0.0.1 -U ' +
        service +
        '_user -d ambrosia_' +
        service +
        ' -At -v ON_ERROR_STOP=1',
    ],
    query,
  );
}
const state = {};
for (const service of ['inventory', 'production']) {
  const tables = JSON.parse(
    sql(
      service,
      `SELECT coalesce(json_agg(tablename ORDER BY tablename),'[]') FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations';`,
    ),
  );
  state[service] = {};
  for (const table of tables)
    state[service][table] = JSON.parse(
      sql(
        service,
        'SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),' +
          "'[]'" +
          '::jsonb) FROM "' +
          table +
          '" t;',
      ),
    );
  assert.equal(
    sql(
      service,
      `SELECT count(*) FROM information_schema.schemata WHERE schema_name ~ '^phase(4|5)_(clean|upgrade|recovery)_';`,
    ),
    '0',
  );
}
mkdirSync('artifacts/phase5', { recursive: true });
if (process.argv.includes('--snapshot')) {
  writeFileSync('artifacts/phase5/before-tests.json', JSON.stringify(state));
  console.log('PASS instantánea local guardada sin imprimir datos.');
} else {
  const expected = JSON.parse(
    readFileSync(
      process.argv.includes('--phase5-baseline')
        ? 'artifacts/phase5/before-tests.json'
        : 'artifacts/phase4/before-tests.json',
      'utf8',
    ),
  );
  for (const table of ['ProductionYield', 'PackagingOperation'])
    expected.production[table] ??= [];
  assert.deepEqual(state, expected, 'Datos idénticos a antes de las pruebas');
  assert.equal(
    sql(
      'inventory',
      `WITH ledger AS (SELECT "itemId",sum(CASE WHEN type IN ('PURCHASE_IN','ADJUSTMENT_IN','PRODUCTION_RETURN','PRODUCTION_IN','PACKAGED_PRODUCT_IN') THEN quantity ELSE -quantity END) q FROM "InventoryMovement" GROUP BY "itemId") SELECT count(*) FROM ledger l FULL JOIN "InventoryBalance" b ON l."itemId"=b."itemId" WHERE coalesce(l.q,0)<>coalesce(b.quantity,0) OR b.quantity<0;`,
    ),
    '0',
  );
  const containers = run(['ps', '--format', 'json'])
    .split(/\r?\n/)
    .filter(Boolean)
    .map(JSON.parse);
  assert.equal(containers.length, 8);
  assert.ok(
    containers.every((c) => c.State === 'running' && c.Health === 'healthy'),
  );
  for (const c of containers)
    for (const p of c.Publishers ?? [])
      if (p.PublishedPort)
        assert.ok(c.Service === 'gateway' && p.PublishedPort === 8080);
  writeFileSync(
    'artifacts/phase5/final-state.json',
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        preserved: true,
        ledger: true,
        clean: true,
        containers: 8,
        sha256: createHash('sha256')
          .update(JSON.stringify(state))
          .digest('hex'),
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS datos intactos, fixtures limpios, ledger reconciliado, ocho contenedores saludables y solo 8080.',
  );
}
