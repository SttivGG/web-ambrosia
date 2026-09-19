import { developmentGateway } from './dev-gateway.mjs';
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
  const config = developmentGateway(
    readFileSync('infrastructure/nginx/nginx.conf', 'utf8'),
    process.env,
  );
  writeFileSync('.cache/nginx.dev.conf', config);
  args.push('-f', 'infrastructure/docker-compose.dev.yml');
}
const commands = {
  'infra-up': [
    'up',
    '-d',
    '--build',
    'postgres',
    'nats',
    'identity-migrate',
    'inventory-migrate',
  ],
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
