import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const children = [
  spawn(
    process.execPath,
    [require.resolve('typescript/bin/tsc'), '--watch', '--preserveWatchOutput'],
    { stdio: 'inherit' },
  ),
  spawn(process.execPath, ['--watch', 'dist/main.js'], { stdio: 'inherit' }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children)
  child.on('exit', (code) => {
    stop();
    process.exitCode = code ?? 0;
  });
