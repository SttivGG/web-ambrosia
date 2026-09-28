import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
mkdirSync('secrets', { recursive: true });
if (!existsSync('secrets/reporting.local.env'))
  writeFileSync(
    'secrets/reporting.local.env',
    'REPORTING_PRODUCTION_TOKEN=' + randomBytes(48).toString('hex') + '\n',
    { flag: 'wx', mode: 0o600 },
  );
console.log(
  'Credencial local Reporting–Production disponible; no se imprime ni se rota.',
);
