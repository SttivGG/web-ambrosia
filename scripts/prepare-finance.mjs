import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const compose = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infrastructure/docker-compose.yml',
];
const definitions = [
  {
    name: 'inventory',
    user: 'inventory_user',
    database: 'ambrosia_inventory',
    password: 'INVENTORY_DB_PASSWORD',
    migrator: 'inventory-migrate',
    isolated: 'inventory',
  },
  {
    name: 'finance',
    user: 'finance_user',
    database: 'ambrosia_finance_reports',
    password: 'FINANCE_DB_PASSWORD',
    migrator: 'finance-migrate',
    isolated: 'finance-reporting',
  },
];
function run(command, options = {}) {
  const result = spawnSync('docker', command, {
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    'Docker ' + command[0] + ' falló; salida sensible omitida.',
  );
  return result.stdout;
}
const endpoint = JSON.parse(
  run(['context', 'inspect'], { encoding: 'utf8' }),
)[0].Endpoints.docker.Host;
assert.ok(
  endpoint.startsWith('npipe://') || endpoint.startsWith('unix://'),
  'Solo se permite Docker local.',
);
mkdirSync('artifacts/backups', { recursive: true });
const evidence = { timestamp: new Date().toISOString(), services: [] };
const snapshots = [];
function sql(definition, query) {
  return run(
    [
      ...compose,
      'exec',
      '-T',
      'postgres',
      'sh',
      '-c',
      'PGPASSWORD="$' +
        definition.password +
        '" psql -h 127.0.0.1 -U ' +
        definition.user +
        ' -d ' +
        definition.database +
        ' -At -v ON_ERROR_STOP=1',
    ],
    { input: query, encoding: 'utf8' },
  ).trim();
}
for (const definition of definitions) {
  const dump = run([
    ...compose,
    'exec',
    '-T',
    'postgres',
    'sh',
    '-c',
    'PGPASSWORD="$' +
      definition.password +
      '" pg_dump -h 127.0.0.1 -U ' +
      definition.user +
      ' -d ' +
      definition.database +
      ' -Fc --no-owner --no-acl',
  ]);
  const file =
    'artifacts/backups/' +
    definition.name +
    '-before-phase6-' +
    Date.now() +
    '.dump';
  writeFileSync(file, dump, { flag: 'wx' });
  assert.ok(dump.length > 100);
  run([...compose, 'exec', '-T', 'postgres', 'pg_restore', '--list'], {
    input: dump,
  });
  run(
    [...compose, 'exec', '-T', 'postgres', 'pg_restore', '--file=/dev/null'],
    { input: dump },
  );
  const tables = JSON.parse(
    sql(
      definition,
      `SELECT coalesce(json_agg(x),'[]') FROM (SELECT table_name,array_agg(column_name ORDER BY ordinal_position) cols FROM information_schema.columns WHERE table_schema='public' AND table_name<>'_prisma_migrations' GROUP BY table_name ORDER BY table_name)x;`,
    ),
  );
  const queries = tables.map(
    (table) =>
      "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM (SELECT " +
      table.cols.map((column) => '"' + column + '"').join(',') +
      ' FROM "' +
      table.table_name +
      '")t;',
  );
  snapshots.push({
    definition,
    queries,
    values: queries.map((query) => sql(definition, query)),
  });
  evidence.services.push({
    service: definition.name,
    backup: file,
    sha256: createHash('sha256').update(dump).digest('hex'),
    readable: true,
    isolated: false,
    migrated: false,
    preserved: false,
  });
}
const save = () =>
  writeFileSync(
    'artifacts/phase6-migration.json',
    JSON.stringify(evidence, null, 2),
  );
save();
console.log('PASS respaldos Inventory y Finance legibles y verificables.');
if (process.argv.includes('--migrate')) {
  run([...compose, 'build', 'inventory-migrate', 'finance-migrate'], {
    stdio: 'inherit',
  });
  for (let index = 0; index < definitions.length; index++) {
    const definition = definitions[index];
    run(
      [
        ...compose,
        'run',
        '--rm',
        '--no-deps',
        definition.migrator,
        'node',
        'scripts/verify-finance-isolated.mjs',
        definition.isolated,
      ],
      { stdio: 'inherit' },
    );
    evidence.services[index].isolated = true;
    save();
  }
  for (let index = 0; index < definitions.length; index++) {
    const definition = definitions[index],
      before = snapshots[index];
    run([...compose, 'run', '--rm', '--no-deps', definition.migrator], {
      stdio: 'inherit',
    });
    run([...compose, 'run', '--rm', '--no-deps', definition.migrator], {
      stdio: 'inherit',
    });
    evidence.services[index].migrated = true;
    assert.deepEqual(
      before.queries.map((query) => sql(definition, query)),
      before.values,
      'Los datos existentes cambiaron.',
    );
    evidence.services[index].preserved = true;
    save();
  }
  console.log(
    'PASS instalación limpia, actualización, repetición y conservación de datos.',
  );
}
