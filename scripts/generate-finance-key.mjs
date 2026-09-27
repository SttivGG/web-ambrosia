import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
mkdirSync('secrets', { recursive: true });
if (!existsSync('secrets/finance.local.env'))
  writeFileSync(
    'secrets/finance.local.env',
    'FINANCE_INVENTORY_TOKEN=' + randomBytes(48).toString('hex') + '\n',
    { flag: 'wx', mode: 0o600 },
  );
console.log(
  'Credencial local Finance–Inventory disponible; no se imprime ni se rota.',
);
