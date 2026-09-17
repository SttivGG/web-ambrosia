import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const port = 13000;
const server = spawn(
  process.execPath,
  [
    'apps/admin-web/node_modules/next/dist/bin/next',
    'start',
    'apps/admin-web',
    '--port',
    String(port),
  ],
  { stdio: 'ignore' },
);
let browser;
const results = [];
try {
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      ready = (await fetch(`http://localhost:${port}/health/live`)).ok;
      if (ready) break;
    } catch {
      /* Startup pending. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'El panel debe iniciar');
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://localhost:${port}`);
  await page.getByRole('button', { name: 'Actualizar estado' }).waitFor();
  assert.equal(
    await page.getByText('No disponible', { exact: true }).count(),
    3,
  );
  results.push(
    'Tres servicios no disponibles cuando el gateway no está presente',
  );
  // El gateway saludable se simula solo para probar los estados de la interfaz.
  let healthy = true;
  await page.route('**/api/*/health/ready', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const id = new URL(route.request().url()).pathname.split('/')[2];
    const service = {
      inventory: 'inventory-service',
      production: 'production-service',
      finance: 'finance-reporting-service',
    }[id];
    await route.fulfill({
      status: healthy ? 200 : 503,
      contentType: 'application/json',
      body: JSON.stringify({
        service,
        status: healthy ? 'ok' : 'unavailable',
        dependencies: { database: healthy, nats: healthy },
        timestamp: new Date().toISOString(),
      }),
    });
  });
  await page.getByRole('button', { name: 'Actualizar estado' }).click();
  assert.ok(
    await page.getByRole('button', { name: 'Verificando…' }).isDisabled(),
  );
  await page.getByRole('button', { name: 'Actualizar estado' }).waitFor();
  assert.equal(await page.getByText('Disponible', { exact: true }).count(), 3);
  assert.match(await page.getByRole('status').innerText(), /Colombia/);
  results.push(
    'Actualización: verificando → disponible, botón bloqueado y fecha Colombia (respuestas simuladas)',
  );
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({
    path: 'artifacts/admin-desktop.png',
    fullPage: true,
  });
  for (const viewport of [
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    const box = await page
      .getByRole('button', { name: 'Actualizar estado' })
      .boundingBox();
    assert.ok(box && box.height >= 44);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: 'artifacts/admin-mobile.png', fullPage: true });
  results.push(
    '375px y orientación horizontal sin desbordamiento; botón >=44px; movimiento reducido',
  );
  healthy = false;
  await page.getByRole('button', { name: 'Actualizar estado' }).click();
  await page.getByRole('button', { name: 'Actualizar estado' }).waitFor();
  assert.equal(
    await page.getByText('No disponible', { exact: true }).count(),
    3,
  );
  assert.deepEqual(errors, []);
  results.push(
    'Transición disponible → no disponible y sin errores JavaScript',
  );
  console.log(results.map((r) => 'PASS ' + r).join('\n'));
} catch (error) {
  process.exitCode = 1;
  results.push('FAIL ' + String(error));
  console.error(error);
} finally {
  await browser?.close();
  server.kill();
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(
    'artifacts/ui-verification.json',
    JSON.stringify(results, null, 2),
  );
}
