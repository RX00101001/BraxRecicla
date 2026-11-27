/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsMap = {};
vm.runInNewContext(ts.transpileModule(readFileSync(resolve(__dirname,'../src/lib/carto-basemap.ts'),'utf8'),{
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsMap });

test('CARTO missing/blank key does not produce an unauthenticated tile URL',()=>{
  for (const value of [undefined, '', '   ']) assert.equal(exportsMap.cartoDarkMatterUrl(value),null);
});
test('Dark Matter uses CARTO rastertiles with a single encoded key query parameter',()=>{
  const url = exportsMap.cartoDarkMatterUrl('  local-test/key?&=value  ');
  assert.ok(url.startsWith('https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key='));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('key'),'local-test/key?&=value');
  assert.equal([...parsed.searchParams].length,1);
});
test('Required OpenStreetMap contributors and CARTO attribution is retained',()=>{
  assert.match(exportsMap.CARTO_ATTRIBUTION,/OpenStreetMap<\/a> contributors/);
  assert.match(exportsMap.CARTO_ATTRIBUTION,/carto.com\/attribution\//);
});
