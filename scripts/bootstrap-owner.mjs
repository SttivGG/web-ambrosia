import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
try {
  loadEnvFile('.env');
} catch {
  throw new Error('Crear .env desde .env.example.');
}
const result = spawnSync(
  'docker',
  [
    'compose',
    '--env-file',
    '.env',
    '-f',
    'infrastructure/docker-compose.yml',
    'exec',
    'identity-service',
    'node',
    'dist/bootstrap-owner.js',
  ],
  { stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
