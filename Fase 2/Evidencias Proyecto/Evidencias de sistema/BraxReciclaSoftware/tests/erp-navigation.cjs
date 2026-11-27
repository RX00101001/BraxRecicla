/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS test runner. */
// Local browser check: install playwright under tmp/browser-check; serve out/ on port 3100.
// Every Supabase HTTP/WebSocket response is intercepted; this test never writes to Supabase.
const { chromium } = require('../tmp/browser-check/node_modules/playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const env = fs.readFileSync('.env.local', 'utf8');
const rawUrl = env.match(/^NEXT_PUBLIC_SUPABASE_URL\s*=\s*["']?([^\s"']+)/m)?.[1];
const host = new URL(rawUrl).hostname;
const user = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@example.test',
  aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {},
  factors: [{ id: '22222222-2222-4222-8222-222222222222', factor_type: 'totp', status: 'verified' }] };
const token = [ { alg: 'HS256', typ: 'JWT' }, { sub: user.id, aal: 'aal2', role: 'authenticated',
  aud: 'authenticated', exp: Math.floor(Date.now()/1000) + 3600, amr: [] } ]
  .map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.' + Buffer.from('test-signature').toString('base64url');
const session = { access_token: token, refresh_token: 'local-test', expires_at: Math.floor(Date.now()/1000)+3600,
  expires_in: 3600, token_type: 'bearer', user };
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const context = await browser.newContext();
    const calls = [];
    await context.route(`https://${host}/**`, async route => {
      const path = new URL(route.request().url()).pathname;
      calls.push(path);
      let data;
      if (path === '/auth/v1/user') data = user;
      else if (path === '/rest/v1/rpc/erp_role') data = 'administrador';
      else if (path === '/rest/v1/rpc/flota_plan_snapshot') data = { solicitudes: [], rutas: [], paradas: [], camiones: [{ identificador: 'TEST-01' }] };
      else if (path.startsWith('/rest/v1/')) data = [];
      else throw new Error(`Unexpected API request: ${path}`);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await context.routeWebSocket(`wss://${host}/**`, socket => {
      socket.onMessage(raw => {
        const wire = JSON.parse(String(raw));
        const message = Array.isArray(wire)
          ? { join_ref: wire[0], ref: wire[1], topic: wire[2], event: wire[3], payload: wire[4] }
          : wire;
        const reply = payload => socket.send(JSON.stringify(Array.isArray(wire)
          ? [message.join_ref, message.ref, message.topic, 'phx_reply', payload]
          : { topic: message.topic, event: 'phx_reply', ref: message.ref, payload }));
        if (message.event === 'phx_join') {
          reply({ status: 'ok', response: { postgres_changes: (message.payload.config.postgres_changes ?? [])
            .map((filter, index) => ({ ...filter, id: index + 1 })) } });
        } else if (message.event === 'phx_leave' || message.event === 'heartbeat') {
          reply({ status: 'ok', response: {} });
        }
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto('http://127.0.0.1:3100/');
    await page.evaluate(({ key, session }) => sessionStorage.setItem(key, JSON.stringify(session)),
      { key: `sb-${host.split('.')[0]}-auth-token`, session });
    await page.reload();
    await page.getByText('Principal / Monitoreo', { exact: true }).waitFor({ timeout: 10000 }).catch(async error => { console.log(await page.locator('body').innerText(), errors, calls); throw error; });
    for (let cycle = 0; cycle < 3; cycle++) {
      await page.getByText('Romana (Báscula)', { exact: true }).click();
      await page.getByText('Terminal de Báscula Romana', { exact: false }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/pesaje/');
      await page.getByText('WebSocket En Vivo', { exact: true }).waitFor();
      await page.getByText('Logística & Rutas', { exact: true }).click();
      await page.getByRole('heading', { name: 'Logística & Rutas', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Crear ruta', exact: true }).waitFor();
      await page.getByRole('option', { name: 'TEST-01', exact: true }).waitFor({ state: 'attached' });
      assert.equal(new URL(page.url()).pathname, '/rutas/');
      await page.getByText('Principal / Monitoreo', { exact: true }).click();
      await page.waitForURL('http://127.0.0.1:3100/');
      await page.getByText('Principal / Monitoreo', { exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/');
    }
    assert.deepEqual(errors, []);
    assert.ok(calls.includes('/rest/v1/rpc/flota_plan_snapshot'));
    assert.ok(!calls.some(path => path.includes('perfiles_usuarios')));
    console.log('PASS: 3 navigation cycles Principal → Romana → Logística → Principal; Realtime connected; no runtime errors. Supabase responses simulated for this local test.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

