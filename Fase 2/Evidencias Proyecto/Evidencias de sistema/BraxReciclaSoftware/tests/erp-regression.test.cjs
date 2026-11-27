/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS test runner. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');

function load(file, supabase) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(resolve(__dirname, '../src/lib', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { exports, require: () => ({ supabase }),
    globalThis: { crypto: { randomUUID } }, console });
  return exports;
}

test('Realtime: cleanup/remount before unsubscribe completes never reuses a subscribed channel', async () => {
  const channels = new Map();
  const removals = [];
  const api = {
    channel(topic) {
      if (channels.has(topic)) return channels.get(topic);
      const channel = { listeners: [], subscribed: false,
        on(event, filter, callback) {
          assert.equal(this.subscribed, false, 'listeners must precede subscribe');
          this.listeners.push(callback); return this;
        },
        subscribe(callback) { this.subscribed = true; this.status = callback; return this; },
      };
      channels.set(topic, channel); return channel;
    },
    removeChannel(channel) { return new Promise(resolve => removals.push({ channel, resolve })); },
  };
  const { watchErpChanges } = load('erp-realtime.ts', api);
  let refreshes = 0;
  const states = [];
  const start = () => watchErpChanges('pesaje-realtime', ['solicitudes_b2b', 'solicitudes_b2c'],
    () => ++refreshes, state => states.push(state));
  const stopFirst = start();
  const first = [...channels.values()][0];
  stopFirst(); stopFirst();
  const stopSecond = start();
  assert.equal(channels.size, 2);
  assert.equal(removals.length, 1, 'cleanup is idempotent');
  first.status('SUBSCRIBED'); first.listeners[0]();
  assert.equal(refreshes, 0, 'late callbacks after cleanup are ignored');
  const second = [...channels.values()][1];
  second.status('SUBSCRIBED'); second.listeners[0](); second.status('CHANNEL_ERROR');
  assert.equal(refreshes, 2, 'subscribing and database changes still refresh data');
  assert.deepEqual(states, [false, false, true, false]);
  stopSecond();
  for (const removal of removals) removal.resolve('ok');
});

function accessApi({ role = 'admin', level = 'aal2', session = true, error = null } = {}) {
  return { auth: {
    getSession: async () => ({ data: { session: session ? { user: { id: 'user-1' }, access_token: 'token' } : null }, error: null }),
    mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: level }, error: null }) },
  }, rpc: async () => ({ data: role, error }) };
}
for (const role of ['admin', 'administrador', ' ADMINISTRADOR ', 'dueno', 'operador', 'chofer']) {
  test(`Access: persisted role ${role} and MFA are accepted`, async () => {
    const access = load('erp-access.ts', accessApi({ role }));
    const result = await access.getErpAccess();
    assert.ok(result);
    assert.equal(access.canManageDispatch(result.role), ['admin', 'dueno', 'operador'].includes(result.role));
  });
}
for (const scenario of [{ session: false }, { level: 'aal1' }]) {
  test(`Access rejects missing session/MFA ${JSON.stringify(scenario)}`, async () => {
    const access = load('erp-access.ts', accessApi(scenario));
    assert.equal(await access.getErpAccess(), null);
  });
}
test('Access fails closed for unknown role and RPC failures', async () => {
  await assert.rejects(load('erp-access.ts', accessApi({ role: null })).getErpAccess());
  await assert.rejects(load('erp-access.ts', accessApi({ error: { code: '42501' } })).getErpAccess());
});
test('Legacy role lookup is used only when the RPC is missing', async () => {
  const api = accessApi({ error: { code: 'PGRST202' } });
  api.from = table => {
    assert.equal(table, 'perfiles_usuarios');
    return { select: () => ({ eq: (column, id) => {
      assert.equal(column, 'id'); assert.equal(id, 'user-1');
      return { maybeSingle: async () => ({ data: { rol: 'administrador' }, error: null }) };
    } }) };
  };
  assert.equal((await load('erp-access.ts', api).getErpAccess()).role, 'admin');
});
