/* eslint-disable @typescript-eslint/no-require-imports -- Isolated PostgreSQL integration test. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDatabase, admin, driver, operator } = require('./helpers/dispatch-db.cjs');
const migration = fs.readFileSync(path.resolve(__dirname,'../../Database/migrations/20261120_driver_jornada.sql'),'utf8');
const other = '10000000-0000-4000-8000-000000000004';
test('Driver journey: ownership, phases, signature Storage link, retry safety, completion, RLS and ERP synchronization',async()=>{
 const db=await createDatabase();
 try {
  await db.exec(migration);await db.exec(migration);
  await db.exec('ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,INSERT ON storage.objects TO authenticated;');
  await db.query(`INSERT INTO auth.users(id,raw_app_meta_data) VALUES($1,'{"role":"driver"}')`,[other]);
  await db.query(`INSERT INTO erp_profiles VALUES($1,'Otro conductor')`,[other]);
  async function identity(id,aal='aal1'){
   await db.exec('RESET ROLE');await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)`,[id,JSON.stringify({aal,app_metadata:[driver,other].includes(id)?{role:'driver'}:{}})]);await db.exec('SET ROLE authenticated');
  }
  const snap=async()=>(await db.query('SELECT brax_driver_snapshot() AS data')).rows[0].data;
  const erp=async()=>(await db.query('SELECT flota_plan_snapshot() AS data')).rows[0].data;
  const routeChange=(id,version,action)=>db.query('SELECT brax_driver_ruta($1,$2,$3)',[id,version,action]);
  const phase=(r,p,version,action)=>db.query('SELECT brax_driver_parada($1,$2,$3,$4)',[r,p,version,action]);
  const result=(r,p,v,state,reason=null,signature=null,photos=[])=>db.query(`SELECT brax_driver_estado($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,[r,p,v,state,reason,signature?'Cartón':null,signature?25:null,null,photos,signature?JSON.stringify(signature):null]);
  await identity(admin,'aal2');
  const pickups=(await erp()).solicitudes;
  const routeId=(await db.query(`SELECT flota_despacho_mutar('crear',$1::jsonb) AS id`,[JSON.stringify({nombre:'Jornada móvil QA',fecha:'2026-11-20',camion:'TEST-01',conductor_id:driver,retiros:pickups.map(item=>({origen:item.origen,id:item.id}))})])).rows[0].id;
  const draftId=(await db.query(`SELECT flota_despacho_mutar('crear',$1::jsonb) AS id`,[JSON.stringify({nombre:'Borrador QA',fecha:'2026-11-20',camion:'TEST-01',conductor_id:driver,borrador:true})])).rows[0].id;
  let scheduled=(await erp()).rutas.find(r=>r.id===routeId);
  await identity(other);
  assert.equal((await snap()).rutas.length,0);
  assert.equal((await db.query('SELECT * FROM flota_rutas')).rows.length,0,'Realtime SELECT cannot expose another driver route');
  await assert.rejects(routeChange(routeId,scheduled.actualizado_en,'iniciar'),/asignada/);
  await identity(operator,'aal2');await assert.rejects(routeChange(routeId,scheduled.actualizado_en,'iniciar'),/conductores/);
  await identity(driver);
  let current=(await snap()).rutas.find(r=>r.id===routeId);
  assert.equal((await snap()).capacidades.jornada,1);assert.ok(current.actualizado_en);
  assert.equal((await db.query('SELECT id FROM flota_rutas')).rows.length,1,'draft excluded from own-row RLS');
  await assert.rejects(db.query(`UPDATE flota_rutas SET estado='En ruta' WHERE id=$1`,[routeId]),/permission denied/);
  await assert.rejects(routeChange(draftId,current.actualizado_en,'iniciar'),/borrador/);
  await assert.rejects(routeChange(routeId,'2020-01-01','iniciar'),/cambió/);
  await assert.rejects(phase(routeId,current.paradas[0].id,current.paradas[0].actualizado_en,'en_camino'),/activa/);
  const startVersion=current.actualizado_en;
  await routeChange(routeId,startVersion,'iniciar');await routeChange(routeId,startVersion,'iniciar');
  current=(await snap()).rutas.find(r=>r.id===routeId);
  assert.equal(current.estado,'En ruta');assert.ok(current.iniciado_en);
  await assert.rejects(routeChange(routeId,current.actualizado_en,'finalizar'),/pendientes/);
  await assert.rejects(phase(routeId,current.paradas[1].id,current.paradas[1].actualizado_en,'en_camino'),/anteriores/);
  let stop=current.paradas[0];
  await assert.rejects(phase(routeId,stop.id,stop.actualizado_en,'retiro'),/inválida/);
  for(const action of ['en_camino','llegada','retiro']){
   const version=stop.actualizado_en;await phase(routeId,stop.id,version,action);await phase(routeId,stop.id,version,action);
   stop=(await snap()).rutas.find(r=>r.id===routeId).paradas[0];assert.equal(stop.fase_conductor,action);
  }
  assert.ok(stop.en_camino_en&&stop.llegada_en&&stop.retiro_iniciado_en);
  const photo=`${driver}/${routeId}/${stop.id}/foto.jpg`,sigpath=`${driver}/${routeId}/${stop.id}/firma-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json`;
  const signature={nombre:'Persona que entrega',trazos:[[{x:1,y:1},{x:100,y:100}]],confirmada_en:new Date().toISOString(),archivo:sigpath,ruta:routeId,parada:stop.id,solicitud:stop.solicitud,material:'Cartón',kilos:25,tipo_peso:'estimado'};
  await assert.rejects(result(routeId,stop.id,stop.actualizado_en,'realizado',null,signature,[photo]),/firma/);
  await assert.rejects(db.query(`INSERT INTO storage.objects(bucket_id,name) VALUES('brax-driver-evidencias',$1)`,[`${other}/${routeId}/${stop.id}/foreign.json`]),/row-level security/);
  await db.query(`INSERT INTO storage.objects(bucket_id,name) VALUES('brax-driver-evidencias',$1),('brax-driver-evidencias',$2)`,[photo,sigpath]);
  await assert.rejects(result(routeId,stop.id,stop.actualizado_en,'realizado',null,{...signature,solicitud:'foreign-request'},[photo]),/firma/);
  await assert.rejects(result(routeId,stop.id,stop.actualizado_en,'realizado',null,{...signature,kilos:100},[photo]),/cambiaron/);
  await result(routeId,stop.id,stop.actualizado_en,'realizado',null,signature,[photo]);
  await result(routeId,stop.id,stop.actualizado_en,'realizado',null,signature,[photo]);
  current=(await snap()).rutas.find(r=>r.id===routeId);
  assert.equal(current.paradas[0].estado,'realizado');assert.equal(current.paradas[0].firma_archivo,sigpath);assert.equal(current.paradas[0].firma_nombre,'Persona que entrega');assert.equal(current.paradas[0].tipo_peso,'estimado');assert.ok(current.paradas[0].resuelto_en);
  stop=current.paradas[1];
  await assert.rejects(result(routeId,stop.id,stop.actualizado_en,'no realizado',''),/motivo/);
  await result(routeId,stop.id,stop.actualizado_en,'no realizado','Cliente ausente');
  current=(await snap()).rutas.find(r=>r.id===routeId);const closeVersion=current.actualizado_en;
  await routeChange(routeId,closeVersion,'finalizar');await routeChange(routeId,closeVersion,'finalizar');
  const closed=(await snap()).rutas.find(r=>r.id===routeId);
  assert.equal(closed.estado,'Finalizada');assert.ok(closed.finalizado_en);assert.equal(closed.iniciado_en,current.iniciado_en);
  await assert.rejects(routeChange(routeId,closed.actualizado_en,'iniciar'),/programada/);
  await assert.rejects(db.query(`SELECT brax_driver_gps($1,-33.4,-70.6)`,[routeId]),/activa/);
  await assert.rejects(db.query(`INSERT INTO storage.objects(bucket_id,name) VALUES('brax-driver-evidencias',$1)`,[`${driver}/${routeId}/${stop.id}/late.json`]),/row-level security/);
  await identity(admin,'aal2');const supervised=await erp();
  assert.equal(supervised.rutas.find(r=>r.id===routeId).estado,'Finalizada');
  assert.equal(supervised.paradas.filter(p=>p.ruta_id===routeId&&p.estado==='realizado').length,1);
  assert.ok(supervised.solicitudes.every(p=>Number(p.kilos_reales)===0),'driver kilos never replace scale weight');
  const evidence=(await db.query('SELECT * FROM flota_resultados_conductor WHERE firma_archivo=$1',[sigpath])).rows;
  assert.equal(evidence.length,1);assert.equal(evidence[0].conductor_id,driver);assert.equal(evidence[0].firma.nombre,'Persona que entrega');
  const events=(await db.query(`SELECT accion,count(*)::int AS count FROM flota_eventos WHERE accion IN ('driver_ruta_iniciar','driver_ruta_finalizar') GROUP BY accion`)).rows;
  assert.ok(events.every(e=>e.count===1),'retries must not duplicate transitions');
  await db.exec('RESET ROLE');
  assert.equal((await db.query(`SELECT relrowsecurity FROM pg_class WHERE relname='flota_rutas'`)).rows[0].relrowsecurity,true);
 }finally{await db.close();}
});

test('Journey migration also applies without the optional desktop migration',async()=>{
 const db=await createDatabase({desktop:false});
 try {
  await db.exec(migration);await db.exec(migration);
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims','{"aal":"aal1","app_metadata":{"role":"driver"}}',false)`,[driver]);
  await db.exec('SET ROLE authenticated');
  const snapshot=(await db.query('SELECT brax_driver_snapshot() AS data')).rows[0].data;
  assert.equal(snapshot.capacidades.jornada,1);assert.equal(snapshot.rutas.length,0);
 }finally{await db.close();}
});
