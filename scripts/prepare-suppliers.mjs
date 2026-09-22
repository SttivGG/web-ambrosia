import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const args = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infrastructure/docker-compose.yml',
];
const run = (command, options = {}) => {
  const result = spawnSync('docker', command, {
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    'Falló Docker ' + command[0] + ' (sin imprimir credenciales).',
  );
  return result.stdout;
};
const endpoint = JSON.parse(
  run(['context', 'inspect'], { encoding: 'utf8' }),
)[0].Endpoints.docker.Host;
assert.ok(
  endpoint.startsWith('npipe://') || endpoint.startsWith('unix://'),
  'Solo Docker local.',
);
const ps = run([...args, 'ps', '--format', 'json'], { encoding: 'utf8' })
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map(JSON.parse);
assert.ok(
  ps.some((row) => row.Service === 'postgres' && row.State === 'running'),
  'Inicia PostgreSQL local.',
);
mkdirSync('artifacts/backups', { recursive: true });
const path =
  'artifacts/backups/inventory-before-2b-' +
  new Date().toISOString().replace(/[:.]/g, '-') +
  '.dump';
const dump = run([
  ...args,
  'exec',
  '-T',
  'postgres',
  'sh',
  '-c',
  'PGPASSWORD="$INVENTORY_DB_PASSWORD" pg_dump -h 127.0.0.1 -U inventory_user -d ambrosia_inventory -Fc --no-owner --no-acl',
]);
writeFileSync(path, dump, { flag: 'wx' });
assert.ok(dump.length > 100);
run([...args, 'exec', '-T', 'postgres', 'pg_restore', '--list'], {
  input: readFileSync(path),
});
run([...args, 'exec', '-T', 'postgres', 'pg_restore', '--file=/dev/null'], {
  input: readFileSync(path),
});
const snapshotSQL = `SELECT json_build_object('categories', (SELECT coalesce(json_agg(t ORDER BY t.id),'[]'::json) FROM "Category" t),'items',(SELECT coalesce(json_agg(t ORDER BY t.id),'[]'::json) FROM "CatalogItem" t));`;
const snapshot = () =>
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
    { input: snapshotSQL, encoding: 'utf8' },
  );
const before = snapshot();
const evidence = {
  timestamp: new Date().toISOString(),
  backup: path,
  sha256: createHash('sha256').update(dump).digest('hex'),
  readable: true,
  migrated: false,
  preserved: false,
  isolated: false,
};
writeFileSync(
  'artifacts/suppliers-migration.json',
  JSON.stringify(evidence, null, 2),
);
console.log('PASS respaldo local completo y legible: ' + path);
if (!process.argv.includes('--migrate')) process.exit(0);
run([...args, 'build', 'inventory-migrate'], { stdio: 'inherit' });
run(
  [
    ...args,
    'run',
    '--rm',
    '--no-deps',
    'inventory-migrate',
    'node',
    'scripts/prepare-suppliers-isolated.mjs',
  ],
  { stdio: 'inherit' },
);
evidence.isolated = true;
writeFileSync(
  'artifacts/suppliers-migration.json',
  JSON.stringify(evidence, null, 2),
);
run([...args, 'run', '--rm', '--no-deps', 'inventory-migrate'], {
  stdio: 'inherit',
});
run([...args, 'run', '--rm', '--no-deps', 'inventory-migrate'], {
  stdio: 'inherit',
});
evidence.migrated = true;
const after = snapshot();
assert.equal(
  after,
  before,
  'Catálogo y categorías deben conservarse exactamente.',
);
evidence.preserved = true;
evidence.catalogSha256 = createHash('sha256').update(after).digest('hex');
writeFileSync(
  'artifacts/suppliers-migration.json',
  JSON.stringify(evidence, null, 2),
);
console.log(
  'PASS migración limpia, actualización 2A, deploy idempotente y datos locales conservados.',
);
