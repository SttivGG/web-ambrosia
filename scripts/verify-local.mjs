import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
loadEnvFile('.env');
const processes = [];
const results = [];
function start(name, port) {
  const child = spawn(process.execPath, [`services/${name}/dist/main.js`], {
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/unavailable',
      NATS_URL: 'nats://127.0.0.1:1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processes.push(child);
  let logs = '';
  child.stdout.on('data', (data) => {
    logs += data.toString();
  });
  child.stderr.on('data', (data) => {
    logs += data.toString();
  });
  return { child, logs: () => logs };
}
async function request(port, path, status, headers = {}) {
  let last;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });
      last = response.status;
      if (last === status) return response;
    } catch {
      last = 'network';
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${port}${path} expected ${status}, got ${last}`);
}
function pass(test) {
  results.push({ test, status: 'passed' });
  console.log('PASS ' + test);
}
try {
  const inventory = start('inventory-service', 13001),
    production = start('production-service', 13002),
    finance = start('finance-reporting-service', 13003);
  for (const port of [13001, 13002, 13003]) {
    const live = await request(port, '/api/v1/health/live', 200, {
      'X-Request-ID': 'test-id',
    });
    assert.equal(live.headers.get('x-request-id'), 'test-id');
    const ready = await request(port, '/api/v1/health/ready', 503);
    assert.deepEqual((await ready.json()).dependencies, {
      database: false,
      nats: false,
    });
    await request(port, '/docs/', 200);
    const docs = await (await request(port, '/docs-json', 200)).json();
    assert.ok(docs.paths['/api/v1/health/ready']);
    const bad = await request(port, '/missing', 404, {
      'X-Request-ID': 'unsafe value',
    });
    assert.notEqual(bad.headers.get('x-request-id'), 'unsafe value');
    assert.equal((await bad.json()).message, 'Solicitud rechazada');
    const allowed = await request(port, '/api/v1/health/live', 200, {
      Origin: 'http://localhost:8080',
    });
    assert.equal(
      allowed.headers.get('access-control-allow-origin'),
      'http://localhost:8080',
    );
    const denied = await request(port, '/api/v1/health/live', 200, {
      Origin: 'https://untrusted.invalid',
    });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  }
  pass(
    'Tres procesos: liveness 200, readiness 503 con dependencias inaccesibles, Swagger 200, correlación, CORS y errores seguros',
  );
  finance.child.kill();
  await request(13002, '/api/v1/health/live', 200);
  production.child.kill();
  await request(13001, '/api/v1/health/live', 200);
  pass(
    'Aislamiento local de procesos (liveness; sin Docker ni dependencias sanas)',
  );
  assert.match(inventory.logs(), /"requestId":"test-id"/);
  pass('Logging JSON incluye correlación');
  const invalid = spawn(
    process.execPath,
    ['services/inventory-service/dist/main.js'],
    {
      env: { NODE_ENV: 'test', PORT: '13004' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  processes.push(invalid);
  let output = '';
  invalid.stdout.on('data', (data) => {
    output += data.toString();
  });
  invalid.stderr.on('data', (data) => {
    output += data.toString();
  });
  const exit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      invalid.kill();
      reject(new Error('Arranque inválido no terminó'));
    }, 10000);
    invalid.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.notEqual(exit, 0);
  assert.match(output, /Configuración inválida/);
  pass('Configuración incompleta rechazada al arrancar');
} catch (error) {
  results.push({
    test: 'local HTTP',
    status: 'failed',
    message: String(error),
  });
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const child of processes) if (child.exitCode === null) child.kill();
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(
    'artifacts/local-verification.json',
    JSON.stringify(results, null, 2),
  );
}
