import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
try {
  loadEnvFile('.env');
} catch {
  throw new Error('Crear .env desde .env.example antes de continuar.');
}
const task = process.argv[2];
const args = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infrastructure/docker-compose.yml',
];
if (['infra-up', 'infra-down', 'gateway-up', 'logs'].includes(task)) {
  mkdirSync('.cache', { recursive: true });
  let config = readFileSync('infrastructure/nginx/nginx.conf', 'utf8');
  for (const [name, key, fallback] of [
    ['inventory-service', 'INVENTORY_SERVICE_PORT', 3001],
    ['production-service', 'PRODUCTION_SERVICE_PORT', 3002],
    ['finance-reporting-service', 'FINANCE_REPORTING_SERVICE_PORT', 3003],
    ['identity-service', 'IDENTITY_SERVICE_PORT', 3004],
    ['admin-web', 'ADMIN_WEB_PORT', 3000],
  ]) {
    const port = Number(process.env[key] ?? fallback);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('Puerto inválido: ' + key);
    config = config.replace(
      name + ':' + fallback,
      'host.docker.internal:' + port,
    );
  }
  writeFileSync('.cache/nginx.dev.conf', config);
  args.push('-f', 'infrastructure/docker-compose.dev.yml');
}
const commands = {
  'infra-up': ['up', '-d', '--build', 'postgres', 'nats', 'identity-migrate'],
  'infra-down': ['stop', 'postgres', 'nats'],
  'gateway-up': ['up', '-d', '--no-deps', 'gateway'],
  logs: ['logs', '-f', 'postgres', 'nats'],
  'stack-up': ['up', '-d', '--build'],
  'stack-down': ['down'],
  config: ['config', '--quiet'],
};
if (!commands[task]) throw new Error('Tarea desconocida');
const result = spawnSync('docker', [...args, ...commands[task]], {
  stdio: 'inherit',
});
if (result.error)
  console.error(
    'Docker no disponible: instalar Docker Engine/Desktop y Compose.',
  );
process.exitCode = result.status ?? 1;
