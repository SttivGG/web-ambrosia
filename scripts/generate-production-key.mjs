import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
mkdirSync('secrets', { recursive: true });
if (!existsSync('secrets/production.local.env'))
  writeFileSync(
    'secrets/production.local.env',
    'PRODUCTION_INVENTORY_TOKEN=' + randomBytes(48).toString('hex') + '\n',
    { flag: 'wx', mode: 0o600 },
  );
console.log(
  'Credencial local de coordinación disponible; no se imprime ni se rota.',
);
