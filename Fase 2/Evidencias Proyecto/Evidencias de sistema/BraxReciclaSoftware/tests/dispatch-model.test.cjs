/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS tests. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const exportsModel={};
vm.runInNewContext(ts.transpileModule(readFileSync(resolve(__dirname,'../src/lib/dispatch-model.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:exportsModel});
const model=exportsModel;
const plan={rutas:[],paradas:[],solicitudes:[],camiones:[],ubicaciones:[],telemetria:[]};
test('Available pickups exclude active assignments and terminal requests, preserve B2B/B2C identity',()=>{
  const data={...plan,solicitudes:[{id:'same',origen:'B2B',estado:'Pendiente'},{id:'same',origen:'B2C',estado:'Pendiente'},{id:'done',origen:'B2C',estado:'Certificado Emitido'}],
    paradas:[{solicitud_b2b:'same',activa:true}]};
  const available=model.availablePickups(data);
  assert.equal(available.length,1);assert.equal(available[0].origen,'B2C');
});
test('Unknown weight, address and missing coordinates are never synthesized',()=>{
  assert.equal(model.pickupWeight({origen:'B2B'}),null);
  assert.equal(model.pickupWeight({origen:'B2B',volumen_toneladas:1.2}),1200);
  assert.equal(model.pickupCoordinates({id:'a',origen:'B2B'},[]),null);
  assert.equal(model.coordinates(null,-70),null);assert.equal(model.coordinates('',-70),null);
  assert.equal(model.coordinates(91,-70),null);
});
test('Distance requires all stop coordinates; partial known weight is not reported as total',()=>{
  const data={...plan,solicitudes:[{id:'a',origen:'B2C',kilos_estimados:10,latitud:-33.4,longitud:-70.6},{id:'b',origen:'B2C'}],
    paradas:[{id:'s1',ruta_id:'r',orden:1,activa:true,solicitud_b2c:'a'},{id:'s2',ruta_id:'r',orden:2,activa:true,solicitud_b2c:'b'}]};
  assert.equal(model.routeSummary(data,{id:'r'}).distance,null);assert.equal(model.routeSummary(data,{id:'r'}).weight,null);
  data.solicitudes[1]={...data.solicitudes[1],kilos_estimados:5,latitud:-33.5,longitud:-70.7};
  assert.equal(model.routeSummary(data,{id:'r'}).weight,15);assert.ok(model.routeSummary(data,{id:'r'}).distance>0);
});
test('Phone and ESP32 remain separate, stale/reassigned phone and non-GPS telemetry are rejected',()=>{
  const now=Date.parse('2026-11-20T12:00:00Z'), route={id:'r',camion:'TRUCK',conductor_id:'driver-new',estado:'En ruta'};
  const phones=[{ruta_id:'r',conductor_id:'driver-old',latitud:-33,longitud:-70,actualizado_en:'2026-11-20T12:00:00Z'}];
  const data={...plan,telemetria:[{patente_camion:'TRUCK',fuente_ubicacion:'desconocida',latitud:-33,longitud:-70,timestamp:'2026-11-20T12:00:00Z'}]};
  assert.equal(model.livePositions(data,route,phones,now).length,0);
  phones[0].conductor_id='driver-new';phones[0].actualizado_en='2026-11-20T11:50:00Z';
  data.telemetria[0].fuente_ubicacion='gps';
  const result=model.livePositions(data,route,phones,now);
  assert.equal(result.length,2);assert.equal(result[0].source,'phone');assert.equal(result[0].online,false);assert.equal(result[1].source,'esp32');assert.equal(result[1].online,true);
});
test('Reorder validates IDs and preserves every stop exactly once',()=>{
  const stops=[{id:'a'},{id:'b'},{id:'c'}];
  assert.equal(JSON.stringify(model.reorderStops(stops,'c','a')),JSON.stringify(['c','a','b']));
  assert.equal(model.reorderStops(stops,'unknown','a'),null);assert.equal(model.reorderStops(stops,'a','a'),null);
});

test('Pickup date filters use the operating timezone instead of the UTC calendar day',()=>{
  assert.equal(model.pickupDay({fecha_retiro:'2026-11-20T01:00:00Z'}),'2026-11-19');
  assert.equal(model.pickupDay({fecha_retiro:'2026-11-20'}),'2026-11-20');
  assert.equal(model.pickupDay({}),null);
});

test('Invalid 0,0 coordinates and locations awaiting review are not mapped as confirmed pickups',()=>{
 assert.equal(model.coordinates(0,0),null);
 assert.equal(model.pickupCoordinates({id:'a',origen:'B2C'},[{solicitud_b2c:'a',latitud:-33,longitud:-70,estado:'revision'}]),null);
 assert.equal(model.geoStatus({id:'a',origen:'B2C',direccion:''},{...plan,geocodificacion:[]}),'Sin dirección');
 assert.equal(model.geoStatus({id:'a',origen:'B2C',direccion:'Calle 1'},{...plan,geocodificacion:[{origen:'B2C',solicitud:'a',estado:'ambigua'}]}),'Ubicación ambigua');
});
