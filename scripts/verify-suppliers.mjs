import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { fixtureUser } from './auth-test-fixture.mjs';
loadEnvFile('.env');
const base = 'http://localhost:' + (process.env.GATEWAY_PORT || 8080);
const prefix = 'F2B-' + randomBytes(8).toString('hex').toUpperCase();
const args = [
  'compose',
  '--env-file',
  '.env',
  '-f',
  'infrastructure/docker-compose.yml',
];
const users = [],
  results = [],
  errors = [],
  requests = [];
let browser,
  stage = 'inicio';
function pass(test) {
  results.push({ test, status: 'passed' });
  console.log('PASS ' + test);
}
function compose(...command) {
  const r = spawnSync('docker', [...args, ...command], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'Docker ' + command[0]);
  return r.stdout;
}
function inventory(code, input = {}) {
  const script = `const assert=require('node:assert/strict');const {PrismaService}=require('./dist/prisma.service');const {ConfigService}=require('@nestjs/config');let text='';process.stdin.on('data',c=>text+=c);process.stdin.on('end',async()=>{const input=JSON.parse(text);const db=new PrismaService(new ConfigService({DATABASE_URL:process.env.DATABASE_URL}));try{${code}}catch(error){console.error(error.name, error.code ?? 'verification');process.exitCode=1;}finally{await db.$disconnect();}});`;
  const r = spawnSync(
    'docker',
    [...args, 'exec', '-T', 'inventory-service', 'node', '-e', script],
    { encoding: 'utf8', input: JSON.stringify(input) },
  );
  assert.equal(r.status, 0, 'PostgreSQL Inventory: ' + r.stderr);
  return r.stdout;
}
async function api(
  context,
  path,
  method = 'GET',
  data,
  expected = 200,
  csrf = true,
) {
  const headers = { Origin: base, 'X-Request-ID': 'suppliers-verification' };
  if (method !== 'GET' && csrf) {
    const token = await context.request.get(base + '/api/auth/csrf');
    assert.equal(token.status(), 200);
    headers['X-CSRF-Token'] = (await token.json()).csrfToken;
  }
  const response = await context.request.fetch(
    base + '/api/inventory/' + path,
    { method, data, headers },
  );
  assert.equal(response.status(), expected, method + ' ' + path);
  assert.equal(response.headers()['x-request-id'], 'suppliers-verification');
  return response.json();
}
async function login(role) {
  const email = 'fase2b.' + randomBytes(10).toString('hex') + '@ambrosia.test',
    password = 'Temporal ' + randomBytes(20).toString('base64url') + ' 2026';
  users.push(email);
  fixtureUser('create', email, password, role);
  const context = await browser.newContext(),
    page = await context.newPage();
  page.on('pageerror', () => errors.push(role + ': JS'));
  page.on('request', (r) => requests.push(r.url()));
  page.on('dialog', (d) => d.accept());
  await page.goto(base + '/login?returnTo=%2Finventario%2Fproveedores');
  await page.getByLabel('Correo', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Iniciar sesión', exact: true })
    .click();
  await page.waitForURL(/\/inventario\/proveedores/);
  return { context, page };
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
  throw Error('Inventory no se recuperó');
}
async function searchSuppliers(page, value) {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/inventory/suppliers' &&
      new URL(r.url()).searchParams.get('search') === value &&
      r.request().method() === 'GET',
  );
  await page.getByLabel('Buscar proveedores', { exact: true }).fill(value);
  await response;
  await page.waitForFunction(
    () => !document.querySelector('.suppliers [role="status"]'),
  );
}
async function save(page) {
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
}
try {
  await ready();
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  });
  const { context, page } = await login('OWNER');
  stage = 'API y relaciones';
  const anonymous = await browser.newContext();
  await api(anonymous, 'suppliers', 'GET', undefined, 401);
  await anonymous.close();
  const category = await api(
    context,
    'catalog/categories',
    'POST',
    { name: prefix },
    201,
  );
  const items = [];
  for (let i = 0; i < 14; i++)
    items.push(
      await api(
        context,
        'catalog/items',
        'POST',
        {
          sku: prefix + '-' + String(i).padStart(2, '0'),
          name: prefix + ' Artículo ' + String(i).padStart(2, '0'),
          categoryId: category.id,
          itemType: 'SUPPLY',
          inventoryBaseUnit: 'UNIT',
          defaultOperationUnit: 'UNIT',
        },
        201,
      ),
    );
  let supplier = await api(
    context,
    'suppliers',
    'POST',
    {
      code: prefix,
      name: prefix + ' Proveedor',
      identificationType: 'NIT',
      identificationNumber: '00' + randomBytes(8).toString('hex') + '-5',
      notes: 'Notas iniciales',
      itemIds: [items[0].id],
    },
    201,
  );
  assert.equal(supplier.items.length, 1);
  await api(
    context,
    'suppliers',
    'POST',
    { code: prefix, name: 'Duplicado' },
    409,
  );
  await api(
    context,
    'suppliers',
    'POST',
    {
      code: prefix + '-ID',
      name: 'Duplicado',
      identificationType: 'NIT',
      identificationNumber: supplier.identificationNumber.replace('-', '.'),
    },
    409,
  );
  for (const data of [
    { unknown: 1 },
    { code: 'INMUTABLE' },
    { itemIds: [items[0].id, items[0].id] },
    { itemIds: [randomUUID()] },
  ])
    await api(
      context,
      'suppliers/' + supplier.id,
      'PATCH',
      { expectedVersion: supplier.version, ...data },
      400,
    );
  await api(
    context,
    'suppliers/' + supplier.id,
    'PATCH',
    { expectedVersion: supplier.version, name: 'CSRF' },
    403,
    false,
  );
  supplier = await api(context, 'suppliers/' + supplier.id, 'PATCH', {
    expectedVersion: supplier.version,
    phone: '300 000 0000',
  });
  assert.equal(supplier.items[0].id, items[0].id);
  assert.equal(supplier.notes, 'Notas iniciales');
  await api(
    context,
    'suppliers/' + supplier.id,
    'PATCH',
    { expectedVersion: 1, name: 'Obsoleto' },
    409,
  );
  const archivedItem = await api(
    context,
    'catalog/items/' + items[0].id + '/archive',
    'POST',
    { expectedVersion: items[0].version },
  );
  supplier = await api(context, 'suppliers/' + supplier.id, 'PATCH', {
    expectedVersion: supplier.version,
    itemIds: [items[0].id, items[1].id],
  });
  assert.equal(
    supplier.items.find((item) => item.id === items[0].id).active,
    false,
  );
  await api(
    context,
    'suppliers',
    'POST',
    { code: prefix + '-ARCH', name: 'Archivado', itemIds: [items[0].id] },
    409,
  );
  const before = await api(context, 'suppliers/' + supplier.id);
  await api(
    context,
    'suppliers/' + supplier.id,
    'PATCH',
    {
      expectedVersion: supplier.version,
      name: 'No guardar',
      itemIds: [randomUUID()],
    },
    400,
  );
  assert.deepEqual(await api(context, 'suppliers/' + supplier.id), before);
  supplier = await api(
    context,
    'suppliers/' + supplier.id + '/archive',
    'POST',
    { expectedVersion: supplier.version },
  );
  await api(
    context,
    'suppliers',
    'POST',
    { code: prefix, name: 'Reservado' },
    409,
  );
  await api(
    context,
    'suppliers',
    'POST',
    {
      code: prefix + '-RES',
      name: 'Reservado',
      identificationType: supplier.identificationType,
      identificationNumber: supplier.identificationNumber,
    },
    409,
  );
  supplier = await api(
    context,
    'suppliers/' + supplier.id + '/restore',
    'POST',
    { expectedVersion: supplier.version },
  );
  assert.equal(supplier.items.length, 2);
  assert.equal(
    (await api(context, 'catalog/items/' + items[0].id)).version,
    archivedItem.version,
  );
  await api(context, 'suppliers/' + supplier.id, 'DELETE', undefined, 404);
  for (let i = 0; i < 3; i++)
    await api(
      context,
      'suppliers',
      'POST',
      { code: prefix + '-P' + i, name: prefix + ' Igual' },
      201,
    );
  const first = await api(
      context,
      'suppliers?search=' + prefix + '&pageSize=2&sortBy=name',
    ),
    second = await api(
      context,
      'suppliers?search=' + prefix + '&pageSize=2&sortBy=name&page=2',
    );
  assert.equal(first.pagination.totalItems, 4);
  assert.equal(
    new Set([...first.data, ...second.data].map((row) => row.id)).size,
    4,
  );
  assert.equal(
    (
      await api(
        context,
        'suppliers?itemId=' + items[0].id + '&search=' + prefix,
      )
    ).pagination.totalItems,
    1,
  );
  pass(
    'API: validación, unicidad archivada, PATCH parcial, relaciones, filtros y paginación',
  );
  stage = 'concurrencia PostgreSQL y rollback';
  inventory(
    `const {SuppliersService}=require('./dist/suppliers/suppliers.service');const service=new SuppliersService(db);let row=await service.get(input.id);const pair=await Promise.allSettled([service.update(row.id,{expectedVersion:row.version,notes:'Concurrente A'}),service.update(row.id,{expectedVersion:row.version,notes:'Concurrente B',itemIds:[input.item]})]);assert.equal(pair.filter(r=>r.status==='fulfilled').length,1);assert.equal(pair.filter(r=>r.status==='rejected').length,1);row=await service.get(input.id);const state=await Promise.allSettled([service.state(row.id,row.version,false),service.update(row.id,{expectedVersion:row.version,itemIds:[]})]);assert.equal(state.filter(r=>r.status==='fulfilled').length,1);row=await service.get(input.id);if(!row.active)await service.state(row.id,row.version,true);`,
    { id: supplier.id, item: items[1].id },
  );
  // A real database trigger fails after Supplier UPDATE, verifying transaction rollback.
  const trigger = 'supplier_probe_' + randomBytes(8).toString('hex');
  inventory(
    `const {SuppliersService}=require('./dist/suppliers/suppliers.service');const service=new SuppliersService(db);const before=await service.get(input.id);assert.match(input.trigger,/^supplier_probe_[a-f0-9]{16}$/);assert.match(input.id,/^[a-f0-9-]{36}$/);try{await db.$executeRawUnsafe('CREATE FUNCTION "'+input.trigger+'"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."supplierId" = '+ "'" +input.id+ "'" +'::uuid THEN RAISE EXCEPTION '+ "'" +'fixture rollback'+ "'" +'; END IF; RETURN NEW; END $$');await db.$executeRawUnsafe('CREATE TRIGGER "'+input.trigger+'" BEFORE INSERT ON "SupplierItem" FOR EACH ROW EXECUTE FUNCTION "'+input.trigger+'"()');await assert.rejects(service.update(input.id,{expectedVersion:before.version,name:'No persistir',itemIds:[input.item]}));assert.deepEqual(await service.get(input.id),before);}finally{await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS "'+input.trigger+'" ON "SupplierItem"');await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS "'+input.trigger+'"()');}`,
    { id: supplier.id, item: items[3].id, trigger },
  );
  inventory(
    `const {SuppliersService}=require('./dist/suppliers/suppliers.service');const {CatalogService}=require('./dist/catalog/catalog.service');const suppliers=new SuppliersService(db),catalog=new CatalogService(db);const item=await catalog.getItem(input.item);const race=await Promise.allSettled([suppliers.create({code:input.code,name:input.code,itemIds:[item.id]}),catalog.itemState(item.id,item.version,false,{subject:'verification',correlationId:'suppliers-verification'})]);assert.ok(race.some(r=>r.status==='fulfilled'));if(race[0].status==='rejected')assert.ok(['ITEM_ARCHIVED','CONCURRENT_MODIFICATION'].includes(race[0].reason.getResponse().code));const current=await catalog.getItem(item.id);if(current.active)await catalog.itemState(current.id,current.version,false,{subject:'verification',correlationId:'suppliers-verification'});await assert.rejects(suppliers.create({code:input.code+'-AFTER',name:input.code,itemIds:[item.id]}));`,
    { item: items[4].id, code: prefix + '-RACE' },
  );
  pass(
    'PostgreSQL real: edición/asociación/archivado concurrentes y rollback tras fallo SQL',
  );
  stage = 'formularios y selección paginada';
  await page.reload();
  await page
    .getByRole('button', { name: 'Nuevo proveedor', exact: true })
    .click();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  assert.ok(await page.locator('[aria-invalid=true]').count());
  await page
    .getByLabel('Código interno', { exact: false })
    .fill(prefix + '-UI');
  await page
    .getByLabel('Razón social o nombre completo', { exact: false })
    .fill(prefix + ' Interfaz');
  await page
    .getByLabel('Buscar artículo por nombre, SKU o código de barras')
    .fill(prefix);
  await page
    .getByLabel(items[1].sku + ' — ' + items[1].name, { exact: true })
    .check();
  await page.getByRole('button', { name: 'Artículos siguientes' }).click();
  await page
    .getByLabel(items[13].sku + ' — ' + items[13].name, { exact: true })
    .check();
  await page.getByRole('button', { name: 'Artículos anteriores' }).click();
  assert.ok(
    await page
      .getByLabel(items[1].sku + ' — ' + items[1].name, { exact: true })
      .isChecked(),
  );
  await save(page);
  await searchSuppliers(page, prefix + '-UI');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Notas', { exact: true }).fill('Mis notas sin perder');
  const ui = (await api(context, 'suppliers?search=' + prefix + '-UI')).data[0];
  await api(context, 'suppliers/' + ui.id, 'PATCH', {
    expectedVersion: ui.version,
    address: 'Dirección concurrente',
    itemIds: [items[2].id],
  });
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByRole('button', { name: 'Obtener versión actual' }).click();
  await page
    .getByText('Actual: Dirección concurrente', { exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel('Notas', { exact: true }).inputValue(),
    'Mis notas sin perder',
  );
  assert.ok(
    await page
      .getByRole('button', { name: 'Guardar', exact: true })
      .isDisabled(),
  );
  await page
    .getByRole('button', { name: 'Conservar mis valores y usar esta versión' })
    .click();
  await save(page);
  const saved = await api(context, 'suppliers/' + ui.id);
  assert.equal(saved.notes, 'Mis notas sin perder');
  assert.equal(saved.items.length, 2);
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Notas', { exact: true }).fill('Descartar');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page
    .getByRole('heading', { name: '¿Descartar los cambios?', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Seguir editando', exact: true })
    .click();
  assert.equal(
    await page.getByLabel('Notas', { exact: true }).inputValue(),
    'Descartar',
  );
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page
    .getByRole('button', { name: 'Descartar cambios', exact: true })
    .click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(
    (await api(context, 'suppliers/' + ui.id)).notes,
    'Mis notas sin perder',
  );
  await page.getByRole('button', { name: 'Archivar', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByLabel('Estado', { exact: true }).selectOption('false');
  await page.getByRole('button', { name: 'Restaurar', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByLabel('Estado', { exact: true }).selectOption('true');
  pass(
    'Playwright: validación, creación, selección paginada, conflicto completo, cancelación y estados',
  );
  stage = 'roles y detalle';
  for (const role of ['ADMIN', 'OPERATOR', 'VIEWER']) {
    const actor = await login(role);
    await searchSuppliers(actor.page, prefix + '-UI');
    await actor.page
      .getByRole('button', { name: 'Ver detalle', exact: true })
      .click();
    await actor.page
      .getByRole('heading', { name: 'Detalle del proveedor' })
      .waitFor();
    await actor.page
      .getByText('Mis notas sin perder', { exact: true })
      .waitFor();
    await actor.page
      .getByRole('button', { name: 'Cerrar', exact: true })
      .click();
    await api(
      actor.context,
      'suppliers',
      'POST',
      { code: prefix + '-' + role, name: prefix + ' ' + role },
      role === 'VIEWER' ? 403 : 201,
    );
    if (role === 'VIEWER') {
      assert.equal(
        await actor.page
          .getByRole('button', { name: 'Nuevo proveedor', exact: true })
          .count(),
        0,
      );
      assert.equal(
        await actor.page
          .getByRole('button', { name: 'Editar', exact: true })
          .count(),
        0,
      );
    }
    assert.deepEqual(
      await actor.page.evaluate(() => [
        Object.keys(window.localStorage),
        Object.keys(window.sessionStorage),
      ]),
      [[], []],
    );
    await actor.context.close();
  }
  pass('Cuatro roles y detalle completo para VIEWER; permisos HTTP y UI');
  stage = 'responsive y persistencia';
  await searchSuppliers(page, prefix);
  await page
    .getByRole('button', { name: 'Ver detalle', exact: true })
    .first()
    .waitFor();
  mkdirSync('artifacts', { recursive: true });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.screenshot({
      path: 'artifacts/suppliers-' + viewport.width + '.png',
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
  }
  const persisted = await api(context, 'suppliers/' + ui.id);
  compose('restart', 'inventory-service');
  await ready();
  assert.deepEqual(await api(context, 'suppliers/' + ui.id), persisted);
  assert.deepEqual(errors, []);
  assert.ok(
    requests.every(
      (url) =>
        new URL(url).origin === base &&
        !/[?&](token|access_token|jwt)=/i.test(url),
    ),
  );
  assert.deepEqual(
    await page.evaluate(() => [
      Object.keys(window.localStorage),
      Object.keys(window.sessionStorage),
    ]),
    [[], []],
  );
  pass(
    'Persistencia tras reinicio, capturas responsive, sin errores JS ni exposición en navegador',
  );
  await context.close();
} catch (error) {
  results.push({ test: stage, status: 'failed', message: String(error) });
  console.error('FAIL ' + stage + ': ' + String(error));
  process.exitCode = 1;
  try {
    await browser
      ?.contexts()
      .flatMap((c) => c.pages())
      .at(-1)
      ?.screenshot({ path: 'artifacts/suppliers-failure.png', fullPage: true });
  } catch {
    /* preserve failure */
  }
} finally {
  await browser?.close();
  try {
    inventory(
      `await db.$transaction(async tx=>{await tx.supplierItem.deleteMany({where:{supplier:{code:{startsWith:input.prefix}}}});await tx.supplier.deleteMany({where:{code:{startsWith:input.prefix}}});await tx.catalogItem.deleteMany({where:{sku:{startsWith:input.prefix}}});await tx.category.deleteMany({where:{name:input.prefix}});});assert.equal(await db.supplier.count({where:{code:{startsWith:input.prefix}}}),0);assert.equal(await db.catalogItem.count({where:{sku:{startsWith:input.prefix}}}),0);`,
      { prefix },
    );
    for (const email of users) fixtureUser('delete', email);
    pass('Fixtures propios y usuarios temporales eliminados');
  } catch {
    results.push({ test: 'limpieza', status: 'failed', prefix });
    process.exitCode = 1;
    console.error('Revisar limpieza de fixtures ' + prefix);
  }
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(
    'artifacts/suppliers-verification.json',
    JSON.stringify(results, null, 2),
  );
}
