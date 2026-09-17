import { spawn } from 'node:child_process';
const child = spawn(
  process.execPath,
  [
    'node_modules/next/dist/bin/next',
    'dev',
    '--port',
    process.env.ADMIN_WEB_PORT || '3000',
  ],
  { stdio: 'inherit' },
);
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
