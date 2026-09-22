import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { fixtureUser } from './auth-test-fixture.mjs';
loadEnvFile('.env');
const base = 'http://localhost:' + (process.env.GATEWAY_PORT || 8080);
const prefix = 'F2A-' + randomBytes(8).toString('hex').toUpperCase();
const schema = 'catalog_probe_' + randomBytes(8).toString('hex');
const users = [],
  results = [],
  errors = [],
  requests = [];
let browser,
  stage = 'inicio',
  freshSchemaCreated = false;
const composeArgs = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infrastructure/docker-compose.yml',
];
function compose(...args) {
  const r = spawnSync('docker', [...composeArgs, ...args], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, 'Comando Docker de catálogo: ' + args[0]);
  return r.stdout;
}
function inventory(code, input = {}) {
  const script = `const {PrismaService}=require('./dist/prisma.service');const {ConfigService}=require('@nestjs/config');let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',async()=>{const input=JSON.parse(text);const db=new PrismaService(new ConfigService({DATABASE_URL:process.env.DATABASE_URL}));try{${code}}catch{process.exitCode=1;}finally{await db.$disconnect();}});`;
  const r = spawnSync(
    'docker',
    [...composeArgs, 'exec', '-T', 'inventory-service', 'node', '-e', script],
    { encoding: 'utf8', input: JSON.stringify(input) },
  );
  assert.equal(r.status, 0, 'Comprobación con Prisma propio de inventario');
  return r.stdout;
}
function pass(test) {
  results.push({ test, status: 'passed' });
  console.log('PASS ' + test);
}
async function ready() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base + '/api/inventory/health/ready')).ok) return;
    } catch {
      /* restart */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error('Inventario no se recuperó');
}
async function api(
  context,
  path,
  method = 'GET',
  data,
  expected = 200,
  csrf = true,
) {
  const headers = { 'X-Request-ID': 'catalog-verification', Origin: base };
  if (method !== 'GET' && csrf) {
    const response = await context.request.get(base + '/api/auth/csrf');
    assert.equal(response.status(), 200);
    headers['X-CSRF-Token'] = (await response.json()).csrfToken;
  }
  const response = await context.request.fetch(
    base + '/api/inventory/catalog/' + path,
    { method, data, headers },
  );
  assert.equal(response.status(), expected, method + ' ' + path);
  assert.equal(response.headers()['x-request-id'], 'catalog-verification');
  return response.json();
}
async function login(role) {
  const email = 'fase2a.' + randomBytes(10).toString('hex') + '@ambrosia.test';
  const password =
    'Temporal ' + randomBytes(20).toString('base64url') + ' 2026';
  users.push(email);
  fixtureUser('create', email, password, role);
  const context = await browser.newContext(),
    page = await context.newPage();
  page.on('pageerror', () => errors.push(role + ': JS'));
  page.on('request', (r) => requests.push(r.url()));
  page.on('dialog', (d) => d.accept());
  await page.goto(base + '/login');
  await page.getByLabel('Correo', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Iniciar sesión', exact: true })
    .click();
  await page.waitForURL(/\/dashboard/);
  await page.getByRole('heading', { name: 'Inicio', exact: true }).waitFor();
  return { context, page };
}
async function save(page) {
  const response = page.waitForResponse(
    (r) =>
      r.url().includes('/api/inventory/catalog/') &&
      ['POST', 'PATCH'].includes(r.request().method()),
  );
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  assert.ok((await response).ok(), 'Guardar desde formulario');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () => !!document.activeElement?.closest('.catalog-toolbar'),
  );
}
async function findRow(page, name) {
  await page.getByLabel('Buscar', { exact: true }).fill(name);
  const row = page
    .getByRole('row')
    .filter({ has: page.getByText(name, { exact: true }) });
  await row.waitFor();
  return row;
}
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  });
  stage = 'migración limpia';
  assert.match(schema, /^catalog_probe_[a-f0-9]{16}$/);
  freshSchemaCreated = true;
  // New isolated PostgreSQL schema in Inventory's own database, using its own account.
  compose(
    'run',
    '--rm',
    '-e',
    'CATALOG_TEST_SCHEMA=' + schema,
    'inventory-migrate',
    'node',
    '-e',
    `const {spawnSync}=require('node:child_process');const schema=process.env.CATALOG_TEST_SCHEMA;if(!/^catalog_probe_[a-f0-9]{16}$/.test(schema))process.exit(1);const r=spawnSync('pnpm',['--filter','@ambrosia/inventory-service','exec','prisma','migrate','deploy'],{env:{...process.env,DATABASE_URL:process.env.DATABASE_URL+'?schema='+schema},stdio:'pipe'});process.exit(r.status??1);`,
  );
  inventory(
    `if(!/^catalog_probe_[a-f0-9]{16}$/.test(input.schema))throw Error();const rows=await db.$queryRawUnsafe('SELECT count(*)::int AS count FROM "'+input.schema+'"."_prisma_migrations" WHERE finished_at IS NOT NULL');if(rows[0].count!==2)throw Error();`,
    { schema },
  );
  pass('Migración limpia en esquema PostgreSQL aislado y cuenta de Inventory');
  inventory(
    `const {PrismaClient}=require('./dist/generated/prisma/client');const {PrismaPg}=require('@prisma/adapter-pg');const {seedCatalog}=require('./dist/catalog/seed');const isolated=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL},{schema:input.schema})});try{await seedCatalog(isolated);const row=await isolated.category.findUniqueOrThrow({where:{normalizedName:'ingredientes'}});await isolated.category.update({where:{id:row.id},data:{description:'Personalizada',active:false,archivedAt:new Date()}});await seedCatalog(isolated);if(await isolated.category.count()!==6||await isolated.catalogItem.count()!==0)throw Error();const unchanged=await isolated.category.findUniqueOrThrow({where:{id:row.id}});if(unchanged.description!=='Personalizada'||unchanged.active)throw Error();}finally{await isolated.$disconnect();}`,
    { schema },
  );
  pass(
    'Seed idempotente en esquema aislado: seis categorías, cero artículos, personalizaciones conservadas',
  );
  stage = 'API y RBAC';
  const anonymous = await browser.newContext();
  await api(anonymous, 'items', 'GET', undefined, 401);
  await api(anonymous, 'categories', 'POST', { name: prefix }, 401, false);
  await anonymous.close();
  const owner = await login('OWNER'),
    { context, page } = owner;
  let category = await api(
    context,
    'categories',
    'POST',
    { name: prefix + ' Categoría' },
    201,
  );
  assert.equal(category.version, 1);
  assert.ok(!('normalizedName' in category));
  assert.equal(
    (
      await api(
        context,
        'categories',
        'POST',
        { name: ('  ' + prefix + ' Categoría  ').toLowerCase() },
        409,
      )
    ).code,
    'CATEGORY_NAME_ALREADY_EXISTS',
  );
  assert.equal(
    (
      await api(
        context,
        'categories/' + category.id,
        'PATCH',
        { name: prefix + ' Editada', expectedVersion: 9 },
        409,
      )
    ).code,
    'CONCURRENT_MODIFICATION',
  );
  category = await api(context, 'categories/' + category.id, 'PATCH', {
    description: 'Categoría temporal',
    expectedVersion: 1,
  });
  assert.equal(category.version, 2);
  const data = {
    sku: prefix + '-LECHE',
    name: prefix + ' Leche',
    itemType: 'RAW_MATERIAL',
    categoryId: category.id,
    inventoryBaseUnit: 'MILLILITER',
    defaultOperationUnit: 'LITER',
    minimumStockBase: '0.0000000001',
    barcode: prefix + '-BAR',
  };
  let milk = await api(context, 'items', 'POST', data, 201);
  assert.equal(milk.minimumStockBase, '0.0000000001');
  assert.ok(!('normalizedSku' in milk));
  assert.equal(
    (
      await api(
        context,
        'items',
        'POST',
        { ...data, sku: data.sku.toLowerCase() },
        409,
      )
    ).code,
    'ITEM_SKU_ALREADY_EXISTS',
  );
  assert.equal(
    (
      await api(
        context,
        'items',
        'POST',
        { ...data, sku: prefix + '-DUP' },
        409,
      )
    ).code,
    'ITEM_BARCODE_ALREADY_EXISTS',
  );
  await api(context, 'items', 'POST', { ...data, sku: 'bad sku' }, 400);
  assert.equal(
    (
      await api(
        context,
        'items',
        'POST',
        {
          ...data,
          sku: prefix + '-INVALID',
          barcode: null,
          defaultOperationUnit: 'KILOGRAM',
        },
        400,
      )
    ).code,
    'INVALID_UNIT_COMBINATION',
  );
  assert.equal(
    (
      await api(
        context,
        'items',
        'POST',
        {
          ...data,
          sku: prefix + '-CAPACITY',
          barcode: null,
          nominalCapacityValue: '0',
          nominalCapacityUnit: 'GRAM',
        },
        400,
      )
    ).code,
    'INVALID_NOMINAL_CAPACITY',
  );
  await api(
    context,
    'items',
    'POST',
    { ...data, sku: prefix + '-NUMBER', barcode: null, minimumStockBase: 1.1 },
    400,
  );
  await api(context, 'items', 'PATCH', { expectedVersion: 1 }, 404);
  await api(
    context,
    'items/' + milk.id,
    'PATCH',
    { expectedVersion: 1, name: 'No CSRF' },
    403,
    false,
  );
  assert.equal(
    (
      await api(
        context,
        'categories/' + category.id + '/archive',
        'POST',
        { expectedVersion: 2 },
        409,
      )
    ).code,
    'CATEGORY_HAS_ACTIVE_ITEMS',
  );
  const access = (await context.cookies()).find(
    (c) => c.name === 'ambrosia_access',
  ).value;
  let response = await fetch(base + '/api/inventory/catalog/items', {
    headers: { Authorization: 'Bearer ' + access },
  });
  assert.equal(response.status, 200);
  response = await fetch(
    base + '/api/inventory/catalog/categories/' + category.id,
    {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer ' + access,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedVersion: category.version,
        description: 'Bearer sin CSRF',
      }),
    },
  );
  assert.equal(response.status, 200);
  category = await response.json();
  response = await fetch(base + '/api/inventory/catalog/items', {
    headers: {
      Authorization: 'Bearer ' + access,
      Cookie: 'ambrosia_access=other',
    },
  });
  assert.equal(response.status, 401);
  const expiredCode = `const{SignJWT,decodeJwt}=require('jose');const{createPrivateKey}=require('node:crypto');let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',async()=>{const p=decodeJwt(s);p.exp=1;process.stdout.write(await new SignJWT(p).setProtectedHeader({alg:'RS256',kid:process.env.JWT_KEY_ID}).sign(createPrivateKey(Buffer.from(process.env.JWT_PRIVATE_KEY_BASE64,'base64').toString())));});`;
  const signed = spawnSync(
    'docker',
    [
      ...composeArgs,
      'exec',
      '-T',
      'identity-service',
      'node',
      '-e',
      expiredCode,
    ],
    { encoding: 'utf8', input: access },
  );
  assert.equal(signed.status, 0);
  assert.equal(
    (
      await fetch(base + '/api/inventory/catalog/items', {
        headers: { Authorization: 'Bearer ' + signed.stdout },
      })
    ).status,
    401,
  );
  for (const size of ['4', '8']) {
    const row = await api(
      context,
      'items',
      'POST',
      {
        ...data,
        sku: prefix + '-ENVASE-' + size,
        name: prefix + ' Envase ' + size,
        itemType: 'PACKAGING',
        inventoryBaseUnit: 'UNIT',
        defaultOperationUnit: 'UNIT',
        barcode: null,
        nominalCapacityValue: size,
        nominalCapacityUnit: 'FLUID_OUNCE',
      },
      201,
    );
    assert.equal(row.nominalCapacityValue, size);
  }
  const list = await api(
    context,
    'items?search=' +
      prefix.toLowerCase() +
      '&itemType=PACKAGING&active=true&inventoryBaseUnit=UNIT&categoryId=' +
      category.id +
      '&sortBy=sku&sortOrder=desc&pageSize=1',
  );
  assert.equal(list.pagination.totalItems, 2);
  assert.equal(list.pagination.totalPages, 2);
  assert.equal(list.data.length, 1);
  assert.ok(list.data[0].sku.endsWith('8'));
  const second = await api(
    context,
    'items?search=' +
      prefix +
      '&itemType=PACKAGING&sortBy=sku&sortOrder=desc&pageSize=1&page=2',
  );
  assert.ok(second.data[0].sku.endsWith('4'));
  assert.equal(
    (await api(context, 'items?search=' + prefix + '-bar')).data.length,
    1,
  );
  await api(context, 'items?sortBy=description;DROP', 'GET', undefined, 400);
  await api(context, 'items?pageSize=101', 'GET', undefined, 400);
  const races = await Promise.all(
    [1, 2].map((i) =>
      fetch(base + '/api/inventory/catalog/items/' + milk.id, {
        method: 'PATCH',
        headers: {
          Authorization: 'Bearer ' + access,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expectedVersion: 1,
          description: 'Concurrente ' + i,
        }),
      }),
    ),
  );
  assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
  milk = await api(context, 'items/' + milk.id);
  assert.equal(milk.version, 2);
  milk = await api(context, 'items/' + milk.id + '/archive', 'POST', {
    expectedVersion: milk.version,
  });
  await api(context, 'items', 'POST', { ...data, barcode: null }, 409);
  await api(
    context,
    'items/' + milk.id + '/archive',
    'POST',
    { expectedVersion: milk.version },
    409,
  );
  milk = await api(context, 'items/' + milk.id + '/restore', 'POST', {
    expectedVersion: milk.version,
  });
  assert.equal(milk.active, true);
  const empty = await api(
    context,
    'categories',
    'POST',
    { name: prefix + ' Vacía' },
    201,
  );
  let archived = await api(
    context,
    'categories/' + empty.id + '/archive',
    'POST',
    { expectedVersion: 1 },
  );
  assert.equal(archived.active, false);
  assert.equal(
    (
      await api(
        context,
        'items',
        'POST',
        {
          ...data,
          sku: prefix + '-ARCHIVED',
          barcode: null,
          categoryId: empty.id,
        },
        409,
      )
    ).code,
    'CATEGORY_ARCHIVED',
  );
  archived = await api(context, 'categories/' + empty.id + '/restore', 'POST', {
    expectedVersion: archived.version,
  });
  assert.deepEqual(
    await api(context, 'categories/' + empty.id + '/restore', 'POST', {
      expectedVersion: archived.version,
    }),
    archived,
  );
  const archivedItem = await api(
    context,
    'items',
    'POST',
    { ...data, sku: prefix + '-RESTORE', barcode: null, categoryId: empty.id },
    201,
  );
  await api(context, 'items/' + archivedItem.id + '/archive', 'POST', {
    expectedVersion: 1,
  });
  await api(context, 'categories/' + empty.id + '/archive', 'POST', {
    expectedVersion: archived.version,
  });
  assert.equal(
    (
      await api(
        context,
        'items/' + archivedItem.id + '/restore',
        'POST',
        { expectedVersion: 2 },
        409,
      )
    ).code,
    'CATEGORY_ARCHIVED',
  );
  const raceCategory = await api(
    context,
    'categories',
    'POST',
    { name: prefix + ' Carrera' },
    201,
  );
  const archiveRace = await Promise.all([
    fetch(
      base +
        '/api/inventory/catalog/categories/' +
        raceCategory.id +
        '/archive',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + access,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expectedVersion: 1 }),
      },
    ),
    fetch(base + '/api/inventory/catalog/items', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + access,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...data,
        sku: prefix + '-RACE',
        barcode: null,
        categoryId: raceCategory.id,
      }),
    }),
  ]);
  assert.ok(
    archiveRace.some((r) => r.status === 409),
    'La carrera de archivado/creación debe rechazar una operación',
  );
  const raceState = await api(context, 'categories/' + raceCategory.id);
  const raceItems = await api(
    context,
    'items?categoryId=' + raceCategory.id + '&active=true',
  );
  assert.ok(
    raceState.active || raceItems.data.length === 0,
    'Nunca hay artículos activos en categoría archivada',
  );
  const doc = await context.request.get(base + '/api/inventory/docs-json');
  assert.equal(doc.status(), 200);
  const spec = await doc.json();
  assert.equal(
    Object.keys(spec.paths).filter((p) => p.includes('/catalog/')).length,
    8,
  );
  assert.ok(spec.paths['/api/v1/catalog/items'].post.requestBody);
  pass(
    'API PostgreSQL: CRUD, duplicados, precisión, 4/8 oz, filtros, paginación, concurrencia, archivado, CSRF y JWT',
  );
  stage = 'persistencia';
  compose('restart', 'inventory-service');
  await ready();
  assert.equal((await api(context, 'items/' + milk.id)).id, milk.id);
  compose('run', '--rm', 'inventory-migrate');
  assert.equal((await api(context, 'items/' + milk.id)).id, milk.id);
  pass('Catálogo persistente tras reinicio y migrate deploy repetido');
  stage = 'Categorías vacías Playwright';
  const categoryRoute = '**/api/inventory/catalog/categories?*';
  await page.route(categoryRoute, (route) =>
    route.fulfill({
      json: {
        data: [],
        pagination: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 },
      },
    }),
  );
  await page.goto(base + '/inventario/catalogo');
  await page.getByText(/No hay categorías activas/).waitFor();
  assert.equal(
    await page
      .getByRole('button', { name: 'Nuevo artículo', exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole('button', { name: 'Crear categoría', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Crear categoría', exact: true })
    .waitFor();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.unroute(categoryRoute);
  pass(
    'Sin categorías: aviso, alta de categoría disponible y artículo bloqueado',
  );
  stage = 'OWNER Playwright';
  await page.goto(base + '/inventario/catalogo');
  await page.getByRole('heading', { name: 'Catálogo', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Categorías', exact: true }).click();
  await page
    .getByRole('button', { name: 'Nueva categoría', exact: true })
    .click();
  await page.getByLabel('Nombre', { exact: true }).fill(prefix + ' UI');
  await save(page);
  const uiCategory = (
    await api(context, 'categories?search=' + prefix + '%20UI')
  ).data[0];
  await page.getByRole('button', { name: 'Artículos', exact: true }).click();
  for (const size of ['leche', '4', '8']) {
    await page
      .getByRole('button', { name: 'Nuevo artículo', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByLabel('SKU', { exact: true })
      .fill(prefix + '-UI-' + size.toUpperCase());
    await dialog
      .getByLabel('Nombre', { exact: true })
      .fill(prefix + ' UI ' + size);
    await dialog
      .getByLabel('Categoría', { exact: true })
      .selectOption(uiCategory.id);
    if (size !== 'leche') {
      await dialog
        .getByLabel('Tipo', { exact: true })
        .selectOption('PACKAGING');
      await dialog
        .getByLabel('Capacidad del envase (opcional)', { exact: true })
        .fill(size);
      await dialog
        .getByLabel('Unidad de esa capacidad', { exact: true })
        .selectOption('FLUID_OUNCE');
    }
    await save(page);
  }
  await page.getByLabel('Tipo', { exact: true }).selectOption('PACKAGING');
  await page.getByLabel('Buscar', { exact: true }).fill(prefix + ' UI');
  await page.getByText('2 registros encontrados', { exact: true }).waitFor();
  await page.getByLabel('Tipo', { exact: true }).selectOption('');
  let uiRow = await findRow(page, prefix + ' UI leche');
  await uiRow
    .getByRole('button', {
      name: 'Editar ' + prefix + ' UI leche',
      exact: true,
    })
    .click();
  await page
    .getByLabel('Descripción', { exact: true })
    .fill('Edición preservada en conflicto');
  const uiMilk = (await api(context, 'items?search=' + prefix + '-UI-LECHE'))
    .data[0];
  await api(context, 'items/' + uiMilk.id, 'PATCH', {
    expectedVersion: uiMilk.version,
    description: 'Cambio de otra persona',
  });
  const conflictResponse = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().endsWith(uiMilk.id),
  );
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  assert.equal((await conflictResponse).status(), 409);
  assert.equal(
    await page.getByLabel('Descripción', { exact: true }).inputValue(),
    'Edición preservada en conflicto',
  );
  await page
    .getByRole('button', { name: 'Consultar versión actual', exact: true })
    .click();
  await page.getByText('Cambio de otra persona', { exact: true }).waitFor();
  await page
    .getByRole('button', {
      name: 'Conservar mis datos y usar esta versión',
      exact: true,
    })
    .click();
  await save(page);
  assert.equal(
    (await api(context, 'items/' + uiMilk.id)).description,
    'Edición preservada en conflicto',
  );
  uiRow = await findRow(page, prefix + ' UI leche');
  await uiRow
    .getByRole('button', {
      name: 'Archivar ' + prefix + ' UI leche',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', { name: 'Confirmar archivado', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByLabel('Estado', { exact: true }).selectOption('false');
  uiRow = await findRow(page, prefix + ' UI leche');
  await uiRow
    .getByRole('button', {
      name: 'Restaurar ' + prefix + ' UI leche',
      exact: true,
    })
    .click();
  await page
    .getByRole('button', { name: 'Confirmar restauración', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByLabel('Estado', { exact: true }).selectOption('true');
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const restoredRow = await findRow(page, prefix + ' UI leche');
    await restoredRow.getByText(/^Activo/).waitFor();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      'Sin scroll horizontal global',
    );
    const targets = await page
      .locator('button:visible, select:visible, input:visible')
      .evaluateAll((els) =>
        els
          .map((e) => e.getBoundingClientRect())
          .every((r) => r.height >= 44 && r.width >= 44),
      );
    assert.ok(targets, 'Controles táctiles de 44px');
    mkdirSync('artifacts', { recursive: true });
    await page.screenshot({
      path: 'artifacts/catalog-' + viewport.width + '.png',
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: 'artifacts/catalog-desktop.png',
    fullPage: true,
  });
  assert.deepEqual(
    await page.evaluate(() => ({
      local: window.localStorage.length,
      session: window.sessionStorage.length,
    })),
    { local: 0, session: 0 },
  );
  pass(
    'OWNER navegador: categorías, leche, 4/8 oz, búsqueda, filtros, conflicto sin perder datos, archivado y restauración, móvil y horizontal',
  );
  for (const role of ['ADMIN', 'OPERATOR', 'VIEWER']) {
    stage = 'rol ' + role;
    const actor = await login(role);
    await actor.page.goto(base + '/inventario/catalogo');
    await actor.page
      .getByRole('heading', { name: 'Catálogo', exact: true })
      .waitFor();
    await api(actor.context, 'items');
    await api(actor.context, 'categories');
    const expected = role === 'VIEWER' ? 403 : 201;
    const created = await api(
      actor.context,
      'categories',
      'POST',
      { name: prefix + ' ' + role },
      expected,
    );
    if (role === 'VIEWER') {
      assert.equal(
        await actor.page
          .getByRole('button', { name: 'Nuevo artículo', exact: true })
          .count(),
        0,
      );
      assert.equal(
        await actor.page.getByRole('button', { name: /^Editar / }).count(),
        0,
      );
      await api(
        actor.context,
        'items/' + milk.id,
        'PATCH',
        { expectedVersion: milk.version, description: 'prohibido' },
        403,
      );
    } else {
      await actor.page.reload();
      await actor.page
        .getByRole('button', { name: 'Nuevo artículo', exact: true })
        .click();
      await actor.page
        .getByLabel('SKU', { exact: true })
        .fill(prefix + '-' + role);
      await actor.page
        .getByLabel('Nombre', { exact: true })
        .fill(prefix + ' ' + role);
      await actor.page
        .getByRole('dialog')
        .getByLabel('Categoría', { exact: true })
        .selectOption(created.id);
      await save(actor.page);
    }
    await actor.context.close();
    pass(role + ': lectura y escritura según permisos, UI y llamada manual');
  }
  assert.deepEqual(errors, []);
  assert.ok(
    requests.every(
      (url) =>
        new URL(url).origin === base &&
        !/[?&](token|access_token|jwt)=/i.test(url),
    ),
  );
  pass(
    'Sin errores JavaScript, tokens en URL/almacenamiento ni llamadas a puertos internos',
  );
  await context.close();
} catch (error) {
  try {
    const last = browser
      ?.contexts()
      .flatMap((c) => c.pages())
      .at(-1);
    if (last) {
      mkdirSync('artifacts', { recursive: true });
      await last.screenshot({
        path: 'artifacts/catalog-failure.png',
        fullPage: true,
      });
    }
  } catch {
    /* preserve original failure */
  }
  results.push({ test: stage, status: 'failed', message: String(error) });
  console.error('FAIL ' + stage + ': ' + String(error));
  process.exitCode = 1;
} finally {
  await browser?.close();
  try {
    inventory(
      `await db.$transaction(async tx=>{await tx.catalogItem.deleteMany({where:{sku:{startsWith:input.prefix}}});await tx.category.deleteMany({where:{name:{startsWith:input.prefix}}});});if(await db.catalogItem.count({where:{sku:{startsWith:input.prefix}}})||await db.category.count({where:{name:{startsWith:input.prefix}}}))throw Error();`,
      { prefix },
    );
    if (freshSchemaCreated)
      inventory(
        `if(!/^catalog_probe_[a-f0-9]{16}$/.test(input.schema))throw Error();await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS "'+input.schema+'" CASCADE');`,
        { schema },
      );
    for (const email of users) fixtureUser('delete', email);
    pass('Datos, esquema PostgreSQL y usuarios temporales eliminados');
  } catch {
    results.push({ test: 'limpieza', status: 'failed' });
    console.error('Revisar limpieza de fixtures de catálogo.');
    process.exitCode = 1;
  }
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(
    'artifacts/catalog-verification.json',
    JSON.stringify(results, null, 2),
  );
}
