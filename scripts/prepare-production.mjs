import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const args = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infrastructure/docker-compose.yml',
];
function run(command, options = {}) {
  const r = spawnSync('docker', command, {
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    r.status,
    0,
    'Docker ' + command[0] + ' falló (salida sensible omitida).',
  );
  return r.stdout;
}
const endpoint = JSON.parse(
  run(['context', 'inspect'], { encoding: 'utf8' }),
)[0].Endpoints.docker.Host;
assert.ok(
  endpoint.startsWith('npipe://') || endpoint.startsWith('unix://'),
  'Solo Docker local',
);
mkdirSync('artifacts/phase4', { recursive: true });
mkdirSync('artifacts/backups', { recursive: true });
const evidence = { timestamp: new Date().toISOString(), services: [] };
function sql(service, query) {
  const variable = service.toUpperCase() + '_DB_PASSWORD';
  return run(
    [
      ...args,
      'exec',
      '-T',
      'postgres',
      'sh',
      '-c',
      'PGPASSWORD="$' +
        variable +
        '" psql -h 127.0.0.1 -U ' +
        service +
        '_user -d ambrosia_' +
        service +
        ' -At -v ON_ERROR_STOP=1',
    ],
    { input: query, encoding: 'utf8' },
  ).trim();
}
const snapshots = [];
for (const service of ['inventory', 'production']) {
  const variable = service.toUpperCase() + '_DB_PASSWORD',
    file =
      'artifacts/backups/' + service + '-before-phase4-' + Date.now() + '.dump';
  const dump = run([
    ...args,
    'exec',
    '-T',
    'postgres',
    'sh',
    '-c',
    'PGPASSWORD="$' +
      variable +
      '" pg_dump -h 127.0.0.1 -U ' +
      service +
      '_user -d ambrosia_' +
      service +
      ' -Fc --no-owner --no-acl',
  ]);
  writeFileSync(file, dump, { flag: 'wx' });
  assert.ok(dump.length > 100);
  run([...args, 'exec', '-T', 'postgres', 'pg_restore', '--list'], {
    input: dump,
  });
  run([...args, 'exec', '-T', 'postgres', 'pg_restore', '--file=/dev/null'], {
    input: dump,
  });
  const tables = JSON.parse(
    sql(
      service,
      `SELECT coalesce(json_agg(x),'[]') FROM (SELECT table_name, array_agg(column_name ORDER BY ordinal_position) cols FROM information_schema.columns WHERE table_schema='public' AND table_name<>'_prisma_migrations' GROUP BY table_name ORDER BY table_name) x;`,
    ),
  );
  const queries = tables.map(
    (t) =>
      'SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),' +
      "'[]'" +
      '::jsonb) FROM (SELECT ' +
      t.cols.map((c) => '"' + c + '"').join(',') +
      ' FROM "' +
      t.table_name +
      '") t;',
  );
  const snapshot = queries.map((q) => sql(service, q));
  snapshots.push({ service, queries, snapshot });
  evidence.services.push({
    service,
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
    'artifacts/production-migration.json',
    JSON.stringify(evidence, null, 2),
  );
save();
console.log('PASS respaldos Inventory y Production legibles.');
if (process.argv.includes('--migrate')) {
  run([...args, 'build', 'inventory-migrate', 'production-migrate'], {
    stdio: 'inherit',
  });
  for (const row of evidence.services) {
    run(
      [
        ...args,
        'run',
        '--rm',
        '--no-deps',
        row.service + '-migrate',
        'node',
        'scripts/verify-production-isolated.mjs',
        row.service,
      ],
      { stdio: 'inherit' },
    );
    row.isolated = true;
    save();
  }
  for (const row of evidence.services) {
    run([...args, 'run', '--rm', '--no-deps', row.service + '-migrate'], {
      stdio: 'inherit',
    });
    run([...args, 'run', '--rm', '--no-deps', row.service + '-migrate'], {
      stdio: 'inherit',
    });
    row.migrated = true;
    const old = snapshots.find((s) => s.service === row.service);
    assert.deepEqual(
      old.queries.map((q) => sql(row.service, q)),
      old.snapshot,
      'Datos existentes conservados',
    );
    row.preserved = true;
    save();
  }
  console.log(
    'PASS migraciones y conservación exacta de todas las columnas y filas existentes.',
  );
}
