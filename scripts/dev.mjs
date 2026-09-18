import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
try {
  loadEnvFile('.env');
} catch {
  throw new Error('Crear .env desde .env.example.');
}
try {
  loadEnvFile('secrets/auth.local.env');
} catch {
  throw new Error('Ejecutar pnpm auth:keys:generate.');
}
process.env.IDENTITY_INTERNAL_URL ??=
  'http://127.0.0.1:' + (process.env.IDENTITY_SERVICE_PORT || '3004');
process.env.AUTH_JWKS_URL ??=
  process.env.IDENTITY_INTERNAL_URL + '/.well-known/jwks.json';
const require = createRequire(import.meta.url);
const child = spawn(
  process.execPath,
  [require.resolve('turbo/bin/turbo'), 'run', 'dev'],
  { stdio: 'inherit' },
);
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
