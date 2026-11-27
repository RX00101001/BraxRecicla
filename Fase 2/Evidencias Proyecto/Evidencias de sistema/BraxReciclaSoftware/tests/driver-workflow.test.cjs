/* eslint-disable @typescript-eslint/no-require-imports -- Pure mobile model tested without native mocks. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const model={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../../braxrecicla-driver/src/workflow.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:model});
test('Driver next stop follows persisted order and ignores resolved/released stops',()=>{
 const route={paradas:[{id:'c',orden:3,estado:'asignado'},{id:'released',orden:1,estado:'liberado'},{id:'b',orden:2,estado:'en curso'}]};
 assert.equal(model.nextStop(route).id,'b');assert.equal(model.resolved(route.paradas[1]),true);
});
test('Driver summary uses only recorded completed outcomes; canonical final state stays compatible',()=>{
 const route={estado:'Finalizada',paradas:[{estado:'realizado',kilos:12.5,material_declarado:'Cartón'},{estado:'no realizado',kilos:null},{estado:'realizado',kilos:2,material_declarado:'Cartón'}]};
 const summary=model.journeySummary(route);
 assert.equal(summary.total,3);assert.equal(summary.completed,2);assert.equal(summary.failed,1);assert.equal(summary.pending,0);assert.equal(summary.kilos,14.5);assert.equal(summary.materials.length,1);
 assert.equal(model.routeLabel(route),'Completada');assert.equal(route.estado,'Finalizada');
 assert.equal(model.stopLabel({estado:'en curso',fase_conductor:'llegada'}),'He llegado');
});
test('Delivery signature Storage serialization preserves finger strokes, sender and Unicode as an ArrayBuffer',()=>{
 const signature={nombre:'María Muñoz ♻️',solicitud:'request',trazos:[[{x:1,y:2},{x:3,y:4}]]};
 const bytes=model.signatureBytes(signature);
 assert.deepEqual(JSON.parse(Buffer.from(bytes).toString('utf8')),signature);
 assert.ok([...new Uint8Array(bytes)].every(byte=>byte<128),'portable ASCII JSON avoids an unsupported native text encoder');
});
