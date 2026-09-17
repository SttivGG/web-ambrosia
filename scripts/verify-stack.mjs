import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
loadEnvFile('.env');
const args = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infrastructure/docker-compose.yml',
];
const reports = [];
const base = 'http://127.0.0.1:' + (process.env.GATEWAY_PORT || 8080);
function compose(...command) {
  const result = spawnSync('docker', [...args, ...command], {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0)
    throw new Error('Falló docker compose ' + command[0]);
  return result.stdout.trim();
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function http(path, status) {
  let last;
  for (let attempt = 0; attempt < 45; attempt++) {
    try {
      const response = await fetch(base + path, {
        signal: AbortSignal.timeout(6000),
        headers: { 'X-Request-ID': 'ambrosia-verification' },
      });
      last = response.status;
      if (last === status) {
        assert.equal(
          response.headers.get('x-request-id'),
          'ambrosia-verification',
        );
        return response;
      }
    } catch {
      last = 'network';
    }
    await delay(1000);
  }
  throw new Error(path + ': esperado ' + status + ', recibido ' + last);
}
function pass(test) {
  reports.push({ test, status: 'passed', timestamp: new Date().toISOString() });
  console.log('PASS ' + test);
}
function sql(user, password, database, query) {
  const result = spawnSync(
    'docker',
    [
      ...args,
      'exec',
      '-T',
      '-e',
      'PGPASSWORD=' + password,
      'postgres',
      'psql',
      '-h',
      '127.0.0.1',
      '-U',
      user,
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-Atc',
      query,
    ],
    { encoding: 'utf8' },
  );
  return result;
}
const routes = ['inventory', 'production', 'finance', 'auth'];
try {
  compose('up', '-d', '--build');
  for (const route of routes) {
    await http('/api/' + route + '/health/live', 200);
    const response = await http('/api/' + route + '/health/ready', 200);
    assert.deepEqual((await response.json()).dependencies, {
      database: true,
      nats: true,
    });
    await http('/api/' + route + '/docs/', 200);
    const docs = await (await http('/api/' + route + '/docs-json', 200)).json();
    assert.ok(docs.paths['/api/v1/health/ready']);
  }
  await http('/', 200);
  const expectedServices = [
    'admin-web',
    'finance-reporting-service',
    'gateway',
    'identity-service',
    'inventory-service',
    'nats',
    'postgres',
    'production-service',
  ];
  let running = [];
  for (let attempt = 0; attempt < 90; attempt++) {
    running = compose('ps', '--format', 'json')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    if (
      running.length === expectedServices.length &&
      running.every(
        (container) =>
          container.State === 'running' && container.Health === 'healthy',
      )
    )
      break;
    await delay(1000);
  }
  assert.deepEqual(
    running.map((container) => container.Service).sort(),
    expectedServices,
  );
  assert.ok(
    running.every(
      (container) =>
        container.State === 'running' && container.Health === 'healthy',
    ),
    'Los ocho contenedores deben estar running y healthy',
  );
  const published = running.flatMap((container) =>
    (container.Publishers ?? [])
      .filter((publisher) => publisher.PublishedPort > 0)
      .map((publisher) => [container.Service, publisher.PublishedPort]),
  );
  assert.ok(published.length >= 1, 'El gateway debe publicar su puerto');
  assert.ok(
    published.every(
      ([service, port]) =>
        service === 'gateway' &&
        port === Number(process.env.GATEWAY_PORT || 8080),
    ),
    'Solo el gateway puede publicar el puerto configurado',
  );
  pass('Ocho contenedores saludables y solo el gateway publica puerto');
  pass('Gateway, panel, Swagger, liveness y readiness de los cuatro servicios');
  const identityVerification = spawnSync(
    process.execPath,
    ['scripts/verify-identity.mjs'],
    { encoding: 'utf8' },
  );
  if (identityVerification.status !== 0) {
    throw new Error(
      'Falló la verificación de identidad: ' + identityVerification.stderr,
    );
  }
  pass('Flujos de identidad, sesiones, CSRF, JWT, bootstrap y auditoría');
  compose('stop', 'finance-reporting-service');
  await http('/api/finance/health/live', 503);
  await http('/api/production/health/ready', 200);
  pass('Finanzas detenida no detiene producción');
  compose('start', 'finance-reporting-service');
  await http('/api/finance/health/ready', 200);
  compose('stop', 'production-service');
  await http('/api/production/health/live', 503);
  await http('/api/inventory/health/ready', 200);
  await http('/api/auth/health/ready', 200);
  pass('Producción detenida no detiene inventario ni identidad');
  compose('start', 'production-service');
  await http('/api/production/health/ready', 200);
  compose('stop', 'identity-service');
  await http('/api/auth/health/live', 503);
  await http('/api/production/health/ready', 200);
  pass('Identidad detenida no detiene producción');
  compose('start', 'identity-service');
  await http('/api/auth/health/ready', 200);
  for (const dependency of ['nats', 'postgres']) {
    compose('stop', dependency);
    for (const route of routes) {
      await http('/api/' + route + '/health/ready', 503);
      await http('/api/' + route + '/health/live', 200);
    }
    pass(dependency + ' caída: readiness 503, liveness 200');
    compose('start', dependency);
    for (const route of routes)
      await http('/api/' + route + '/health/ready', 200);
    pass('Recuperación ' + dependency);
  }
  const accounts = [
    ['inventory_user', process.env.INVENTORY_DB_PASSWORD, 'ambrosia_inventory'],
    [
      'production_user',
      process.env.PRODUCTION_DB_PASSWORD,
      'ambrosia_production',
    ],
    [
      'finance_user',
      process.env.FINANCE_DB_PASSWORD,
      'ambrosia_finance_reports',
    ],
    [
      process.env.IDENTITY_DATABASE_USER || 'identity_user',
      process.env.IDENTITY_DATABASE_PASSWORD,
      process.env.IDENTITY_DATABASE_NAME || 'ambrosia_identity',
    ],
  ];
  for (const [user, password, db] of accounts) {
    const own = sql(user, password, db, 'SELECT current_database();');
    assert.equal(own.status, 0);
    assert.equal(own.stdout.trim(), db);
    for (const other of accounts.map((a) => a[2]).filter((d) => d !== db)) {
      const denied = sql(user, password, other, 'SELECT 1;');
      assert.notEqual(denied.status, 0);
      assert.match(denied.stderr, /permission denied for database/);
    }
    const privileges = sql(
      user,
      password,
      db,
      'SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication FROM pg_roles WHERE rolname=current_user;',
    );
    assert.equal(privileges.stdout.trim(), 'f');
  }
  pass('Cuatro identidades propias y doce conexiones cruzadas rechazadas');
  // Marcadores técnicos temporales; se eliminan en finally. No se crean entidades de negocio.
  const admin = process.env.POSTGRES_ADMIN_USER,
    password = process.env.POSTGRES_ADMIN_PASSWORD;
  assert.equal(
    sql(
      admin,
      password,
      'postgres',
      'CREATE TABLE IF NOT EXISTS public._ambrosia_persistence_probe (id integer primary key); INSERT INTO public._ambrosia_persistence_probe VALUES (1) ON CONFLICT DO NOTHING;',
    ).status,
    0,
  );
  const serviceScript = `const {connect,StringCodec}=require('nats');(async()=>{const nc=await connect({servers:process.env.NATS_URL,user:process.env.NATS_USER,pass:process.env.NATS_PASSWORD});const jm=await nc.jetstreamManager();await jm.streams.add({name:'AMBROSIA_INFRA_PROBE',subjects:['infra.probe.persistence'],storage:'file'});await nc.jetstream().publish('infra.probe.persistence',StringCodec().encode('persistent'));await nc.drain();})().catch(()=>process.exit(1));`;
  compose('exec', '-T', 'inventory-service', 'node', '-e', serviceScript);
  compose('restart', 'postgres', 'nats');
  for (const route of routes)
    await http('/api/' + route + '/health/ready', 200);
  assert.equal(
    sql(
      admin,
      password,
      'postgres',
      'SELECT id FROM public._ambrosia_persistence_probe;',
    ).stdout.trim(),
    '1',
  );
  compose(
    'exec',
    '-T',
    'inventory-service',
    'node',
    '-e',
    `const {connect,StringCodec}=require('nats');(async()=>{const nc=await connect({servers:process.env.NATS_URL,user:process.env.NATS_USER,pass:process.env.NATS_PASSWORD});const jm=await nc.jetstreamManager();const message=await jm.streams.getMessage('AMBROSIA_INFRA_PROBE',{seq:1});if(StringCodec().decode(message.data)!=='persistent')throw Error('Persistence');await nc.drain();})().catch(()=>process.exit(1));`,
  );
  pass('Persistencia PostgreSQL y JetStream tras reinicio');
} catch (error) {
  reports.push({ test: 'stack', status: 'failed', message: String(error) });
  console.error(String(error));
  process.exitCode = 1;
} finally {
  try {
    compose(
      'start',
      'postgres',
      'nats',
      'inventory-service',
      'production-service',
      'finance-reporting-service',
      'identity-service',
    );
    sql(
      process.env.POSTGRES_ADMIN_USER,
      process.env.POSTGRES_ADMIN_PASSWORD,
      'postgres',
      'DROP TABLE IF EXISTS public._ambrosia_persistence_probe;',
    );
    compose(
      'exec',
      '-T',
      'inventory-service',
      'node',
      '-e',
      `const {connect}=require('nats');(async()=>{const nc=await connect({servers:process.env.NATS_URL,user:process.env.NATS_USER,pass:process.env.NATS_PASSWORD});const jm=await nc.jetstreamManager();try{await jm.streams.delete('AMBROSIA_INFRA_PROBE');}finally{await nc.drain();}})().catch(()=>process.exit(1));`,
    );
  } catch {
    console.error('Revisar restauración/limpieza del stack.');
  }
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(
    'artifacts/stack-verification.json',
    JSON.stringify(reports, null, 2),
  );
}
