import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
const reports = [];
function pass(test) {
  reports.push({ test, status: 'passed' });
  console.log('PASS ' + test);
}
const git = (...args) => {
  const result = spawnSync(
    'git',
    ['-c', 'safe.directory=' + process.cwd().replaceAll('\\', '/'), ...args],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, 'Git debe estar disponible');
  return result.stdout;
};
const tracked = git('ls-files').split(/\r?\n/).filter(Boolean);
assert.ok(
  !tracked.some((path) => /(^|\/)(\.env$|secrets\/|artifacts\/)/.test(path)),
  'Secretos y artifacts no deben estar rastreados',
);
const source = git('ls-files', '--cached', '--others', '--exclude-standard')
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((path) => existsSync(path))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');
const privateKey = /-----BEGIN (?:RSA )?PRIVATE KEY-----/;
const jwt = /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}/;
assert.ok(
  !privateKey.test(source) && !jwt.test(source),
  'Sin claves privadas ni JWT rastreados',
);
pass(
  'Git excluye .env, secrets y artifacts; sin claves privadas ni JWT en archivos rastreados',
);
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : [join(dir, entry.name)],
  );
}
const clientFiles = files(resolve('apps/admin-web/.next/static')).filter(
  (path) => /\.js$/.test(path),
);
assert.ok(clientFiles.length > 0, 'Build de Next requerido');
const client = clientFiles.map((path) => readFileSync(path, 'utf8')).join('\n');
assert.ok(
  !/PRODUCTION_INVENTORY_TOKEN|INVENTORY_INTERNAL_URL|IDENTITY_INTERNAL_URL|identity-service:3004|IDENTITY_DATABASE_URL|JWT_PRIVATE_KEY_BASE64|AUTH_CSRF_SECRET/.test(
    client,
  ),
  'Bundle sin variables privadas',
);
assert.ok(
  !privateKey.test(client) && !jwt.test(client),
  'Bundle sin tokens ni claves',
);
pass('Bundle de navegador sin URLs/variables privadas, JWT ni claves');
const log = spawnSync(
  'docker',
  [
    'compose',
    '--env-file',
    '.env',
    '-f',
    'infrastructure/docker-compose.yml',
    'logs',
    '--no-color',
  ],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
);
assert.equal(log.status, 0, 'Logs Docker disponibles');
const output = log.stdout + log.stderr;
assert.ok(
  !jwt.test(output) && !privateKey.test(output),
  'Logs sin JWT ni claves',
);
assert.ok(
  !/ambrosia_(?:access|refresh|csrf)=|"(?:password|currentPassword|newPassword|csrfToken)"\s*:/.test(
    output,
  ),
  'Logs sin valores de cookies/contraseñas/CSRF',
);
for (const path of ['.env', 'secrets/auth.local.env']) {
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^(JWT_PRIVATE_KEY_BASE64|AUTH_CSRF_SECRET)=(.+)$/.exec(line);
    if (match) {
      const value = match[2].replace(/^['"]|['"]$/g, '');
      assert.ok(
        !source.includes(value) &&
          !client.includes(value) &&
          !output.includes(value),
        'Material secreto local no expuesto',
      );
    }
  }
}
pass(
  'Logs revisados sin cookies completas, contraseñas, CSRF, JWT ni material privado local',
);
mkdirSync('artifacts', { recursive: true });
writeFileSync(
  'artifacts/auth-boundary-verification.json',
  JSON.stringify(reports, null, 2),
);

const coordinationFile = resolve('secrets/production.local.env');
if (existsSync(coordinationFile)) {
  const token = readFileSync(coordinationFile, 'utf8')
    .match(/^PRODUCTION_INVENTORY_TOKEN=(.+)$/m)?.[1]
    ?.trim();
  assert.ok(token && token.length >= 64);
  assert.ok(
    !source.includes(token) &&
      !client.includes(token) &&
      !output.includes(token),
    'Credencial técnica fuera de fuentes, bundle y logs',
  );
}
