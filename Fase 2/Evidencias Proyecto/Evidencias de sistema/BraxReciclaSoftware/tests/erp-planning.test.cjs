/* eslint-disable @typescript-eslint/no-require-imports -- PostgreSQL integration test. */
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {createDatabase,admin,driver,operator}=require('./helpers/dispatch-db.cjs');
const sql=name=>fs.readFileSync(path.resolve(__dirname,'../../Database/migrations',name),'utf8');
async function upgraded(){const db=await createDatabase();for(const f of ['20261120_driver_jornada.sql','20261120_erp_geocodificacion.sql','20261120_erp_planificacion.sql'])await db.exec(sql(f));return db;}
async function identity(db,id,role='authenticated',aal='aal2'){await db.exec('RESET ROLE');await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)`,[id,JSON.stringify({role,aal,app_metadata:id===driver?{role:'driver'}:{}})]);await db.exec('SET ROLE '+role);}
test('ERP planning: safe persistent sequence, operator planning scope, default truck, uniqueness and empty deletion',async()=>{
 const db=await upgraded();try{
  await db.exec(sql('20261120_erp_geocodificacion.sql'));await db.exec(sql('20261120_erp_planificacion.sql'));
  await identity(db,admin);
  const rpc=async(action,data)=>(await db.query('SELECT flota_despacho_mutar($1,$2::jsonb) AS id',[action,JSON.stringify(data)])).rows[0].id;
  const snapshot=async()=>(await db.query('SELECT flota_plan_snapshot() AS data')).rows[0].data;
  await db.query(`SELECT flota_catalogo_guardar('conductor',$1::jsonb)`,[JSON.stringify({user_id:driver,codigo:'DRIVER1',nombre:'Conductor QA',camion_predeterminado:'TEST-01',activo:true})]);
  const catalog=(await db.query('SELECT flota_despacho_catalogo() AS data')).rows[0].data;
  assert.equal(catalog.version,2);assert.equal(catalog.conductores[0].camion_predeterminado,'TEST-01');assert.equal(catalog.camiones[0].conductor_predeterminado,driver);
  const custom=await rpc('crear',{codigo:'R000528',fecha:'2026-11-20',camion:'TEST-01',conductor_id:driver});
  const first=(await db.query('SELECT flota_ruta_proponer() AS code')).rows[0].code,second=(await db.query('SELECT flota_ruta_proponer() AS code')).rows[0].code;
  assert.equal(first,'R000529');assert.equal(second,'R000530');
  await identity(db,operator);
  await assert.rejects(db.query(`SELECT flota_catalogo_guardar('camion','{"identificador":"DENIED"}')`),/permiso/);
  const created=await rpc('crear',{codigo:first,fecha:'2026-11-20',hora_salida:'09:30',camion:'TEST-01',conductor_id:driver});
  let row=(await snapshot()).rutas.find(r=>r.id===created);assert.equal(row.codigo,first);assert.equal(row.nombre,first);assert.equal(row.hora_salida,'09:30:00');assert.equal(row.conductor_id,driver);assert.equal(row.puede_eliminar,true);
  await assert.rejects(rpc('crear',{codigo:first.toLowerCase(),fecha:'2026-11-20',camion:'TEST-01'}),/número de ruta ya existe/);
  await assert.rejects(rpc('estado_ruta',{ruta:created,version:row.actualizado_en,estado:'En ruta'}),/operador/);
  await rpc('eliminar_vacia',{ruta:created,version:row.actualizado_en});assert.ok(!(await snapshot()).rutas.some(r=>r.id===created));
  await assert.rejects(rpc('crear',{codigo:first,fecha:'2026-11-20',camion:'TEST-01'}),/número de ruta ya existe/);
  assert.equal((await db.query('SELECT flota_ruta_proponer() AS code')).rows[0].code,'R000531');
  row=(await snapshot()).rutas.find(r=>r.id===custom);const request=(await snapshot()).solicitudes[0];
  await rpc('asignar',{ruta:custom,version:row.actualizado_en,retiros:[{origen:request.origen,id:request.id}]});row=(await snapshot()).rutas.find(r=>r.id===custom);
  await assert.rejects(rpc('eliminar_vacia',{ruta:custom,version:row.actualizado_en}),/vacía/);
  const stop=(await snapshot()).paradas.find(p=>p.ruta_id===custom);await rpc('quitar',{ruta:custom,version:row.actualizado_en,parada:stop.id});row=(await snapshot()).rutas.find(r=>r.id===custom);
  await assert.rejects(rpc('eliminar_vacia',{ruta:custom,version:row.actualizado_en}),/histórica/);
  await identity(db,driver);assert.equal((await db.query('SELECT brax_driver_snapshot() AS data')).rows[0].data.rutas.length,1);
  await identity(db,operator,'authenticated','aal1');await assert.rejects(db.query('SELECT flota_ruta_proponer()'),/permiso/);
  await db.exec('RESET ROLE');assert.equal((await db.query('SELECT eliminada_en IS NOT NULL AS archived FROM flota_rutas WHERE id=$1',[created])).rows[0].archived,true);
 }finally{await db.close();}
});
test('Geocoding queue: new web requests enqueue, manual points are protected, backend-only leases, cache and stale result prevention',async()=>{
 const db=await upgraded();try{
  await db.query(`INSERT INTO solicitudes_b2c(nombre,rut,material,direccion,comuna) VALUES('QA Geo','QA-GEO','Cartón','Tres Montes 692 · Contacto: privado@example.test','Quilicura')`);
  let job=(await db.query('SELECT * FROM flota_geo_trabajos')).rows[0];assert.ok(job);assert.equal(job.estado,'pendiente');assert.ok(!job.direccion.includes('@'));
  await identity(db,operator);await assert.rejects(db.query('SELECT flota_geo_reclamar(gen_random_uuid(),100)'),/permission denied/);
  await assert.rejects(db.query('SELECT flota_geo_pendientes()'),/permiso/);
  await identity(db,admin);await db.query('SELECT flota_geo_pendientes(50)');
  await identity(db,'','service_role');const token='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const claimed=(await db.query('SELECT flota_geo_reclamar($1,100) AS data',[token])).rows[0].data;assert.ok(claimed.id);
  await identity(db,operator);await db.query(`SELECT flota_despacho_solicitud('B2C',$1,$2::jsonb)`,[claimed.solicitud,JSON.stringify({direccion:'Tres Montes 692',comuna:'Quilicura',latitud:-33.36,longitud:-70.73,confirmar_ubicacion:true})]);
  await identity(db,'','service_role');await db.query('SELECT flota_geo_resultado($1,$2,$3::jsonb)',[token,claimed.id,JSON.stringify({estado:'confirmada',latitud:-33.4,longitud:-70.6})]);
  await db.exec('RESET ROLE');const location=(await db.query('SELECT * FROM flota_ubicaciones WHERE solicitud_b2c=$1',[claimed.solicitud])).rows[0];assert.equal(location.latitud,-33.36);assert.equal(location.confirmada_manualmente,true);assert.equal(location.fuente,'manual');
  await identity(db,admin);const queued=(await db.query('SELECT flota_geo_pendientes(50) AS data')).rows[0].data;assert.equal(queued.encoladas,0);
  await identity(db,operator);await assert.rejects(db.query(`SELECT flota_despacho_solicitud('B2C',$1,$2::jsonb)`,[claimed.solicitud,JSON.stringify({direccion:'QA',latitud:0,longitud:0,confirmar_ubicacion:true})]),/0,0/);
 }finally{await db.close();}
});

test('Geocoder cache deduplicates addresses, enforces the shared quota and bounds transient retries',async()=>{
 const db=await upgraded();try{
  await db.query(`INSERT INTO solicitudes_b2c(nombre,rut,material,direccion,comuna) VALUES('Geo cache','CACHE1','Papel','Tres Montes 692','Quilicura')`);
  await identity(db,'','service_role');const token='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const claim=async(quota=100)=>(await db.query('SELECT flota_geo_reclamar($1,$2) AS data',[token,quota])).rows[0].data;
  const finish=(id,outcome)=>db.query('SELECT flota_geo_resultado($1,$2,$3::jsonb)',[token,id,JSON.stringify(outcome)]);
  const first=await claim();await finish(first.id,{estado:'confirmada',latitud:-33.36,longitud:-70.73});
  const occupied=(await db.query('SELECT flota_geo_reclamar(gen_random_uuid(),100) AS data')).rows[0].data;assert.equal(occupied.ocupado,true);
  await db.exec('RESET ROLE');await db.query(`INSERT INTO solicitudes_b2c(nombre,rut,material,direccion,comuna) VALUES('Geo cache 2','CACHE2','Papel','tres   montes 692','Quilicura')`);await db.exec('SET ROLE service_role');
  const cached=await claim(1);assert.equal(cached.cache.estado,'confirmada');await finish(cached.id,cached.cache);
  await db.exec('RESET ROLE');assert.equal((await db.query('SELECT consultas FROM flota_geo_control')).rows[0].consultas,1);
  await db.query(`INSERT INTO solicitudes_b2c(nombre,rut,material,direccion,comuna) VALUES('Geo retry','RETRY','Papel','Otra calle 123','Quilicura')`);await db.exec('SET ROLE service_role');
  assert.equal((await claim(1)).cuota,true);
  let id;
  for(let n=0;n<3;n++){
   await db.exec('RESET ROLE');await db.exec(`UPDATE flota_geo_control SET proxima_consulta=now()-interval '1 second';UPDATE flota_geo_trabajos SET proximo_en=now()-interval '1 second' WHERE estado='pendiente'`);await db.exec('SET ROLE service_role');
   const retry=await claim();id=retry.id;await finish(id,{estado:'error',error:'Proveedor HTTP 503',reintentable:true});
  }
  await db.exec('RESET ROLE');const failed=(await db.query('SELECT estado,intentos FROM flota_geo_trabajos WHERE id=$1',[id])).rows[0];assert.equal(failed.estado,'error');assert.equal(failed.intentos,3);
 }finally{await db.close();}
});
