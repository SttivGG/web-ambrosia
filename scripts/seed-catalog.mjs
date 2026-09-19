import { spawnSync } from 'node:child_process';
const result = spawnSync(
  'docker',
  [
    'compose',
    '--env-file',
    '.env',
    '-f',
    'infrastructure/docker-compose.yml',
    'exec',
    '-T',
    'inventory-service',
    'node',
    'dist/catalog/seed.js',
  ],
  { stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
