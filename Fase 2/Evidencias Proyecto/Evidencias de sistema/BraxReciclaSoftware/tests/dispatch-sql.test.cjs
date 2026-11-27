/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS tests. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase, admin, driver, operator } = require('./helpers/dispatch-db.cjs');

test('Desktop SQL: migrations, actual persistence, atomic assignment, ordering, Driver isolation and permissions', async () => {
  const db = await createDatabase();
  try {
    const setIdentity = async (id,aal='aal2',driverRole=false) => {
      await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)`,[id,JSON.stringify({aal,app_metadata:driverRole?{role:'driver'}:{}})]);
      await db.exec('SET ROLE authenticated');
    };
    await setIdentity(admin);
    const catalog=(await db.query(`SELECT flota_despacho_catalogo() AS data`)).rows[0].data;
    assert.equal(catalog.conductores.length,1);assert.equal(catalog.conductores[0].nombre,'Conductor prueba');
    const snapshot = async () => (await db.query(`SELECT flota_plan_snapshot() AS data`)).rows[0].data;
    const pickups=(await snapshot()).solicitudes;
    const mutate=async(action,data)=>(await db.query(`SELECT flota_despacho_mutar($1,$2::jsonb) AS id`,[action,JSON.stringify(data)])).rows[0].id;
    const routeId=await mutate('crear',{nombre:'QA Borrador',camion:'TEST-01',fecha:'2026-11-20',borrador:true,conductor_id:driver,retiros:[{origen:'B2C',id:pickups[0].id}]});
    let route=(await snapshot()).rutas.find(r=>r.id===routeId);
    assert.equal(route.borrador,true);assert.equal(route.conductor_id,driver);
    await assert.rejects(mutate('asignar',{ruta:routeId,version:'2020-01-01',retiros:[{origen:'B2C',id:pickups[1].id}]}),/cambió/);
    await mutate('asignar',{ruta:routeId,version:route.actualizado_en,retiros:[{origen:'B2C',id:pickups[1].id}]});
    route=(await snapshot()).rutas.find(r=>r.id===routeId);
    const stops=(await snapshot()).paradas.filter(s=>s.ruta_id===routeId&&s.activa).sort((a,b)=>a.orden-b.orden);
    await mutate('ordenar',{ruta:routeId,version:route.actualizado_en,orden:stops.map(s=>s.id).reverse()});
    const after=(await snapshot()).paradas.filter(s=>s.ruta_id===routeId&&s.activa).sort((a,b)=>a.orden-b.orden);
    assert.equal(after[0].id,stops[1].id);
    await db.query(`SELECT flota_despacho_solicitud('B2C',$1,$2::jsonb)`,[pickups[0].id,JSON.stringify({direccion:'Dirección QA',comuna:'Comuna QA',prioridad:'alta',latitud:-33.45,longitud:-70.66})]);
    assert.equal((await snapshot()).ubicaciones.length,1);
    await db.exec('RESET ROLE');await setIdentity(driver,'aal1',true);
    assert.equal((await db.query(`SELECT brax_driver_snapshot() AS data`)).rows[0].data.rutas.length,0,'draft invisible to Driver');
    await assert.rejects(db.query(`SELECT flota_despacho_catalogo()`),/permiso/);
    await db.exec('RESET ROLE');await setIdentity(operator);
    await db.query(`SELECT flota_despacho_catalogo()`);
    await assert.rejects(mutate('crear',{nombre:'Denied',camion:'TEST-01',fecha:'2026-11-20'}),/permiso/);
    await db.exec('RESET ROLE');await setIdentity(admin,'aal1');
    await assert.rejects(db.query(`SELECT flota_despacho_catalogo()`),/permiso/);
    await db.exec('RESET ROLE');await setIdentity(admin);
    route=(await snapshot()).rutas.find(r=>r.id===routeId);
    await mutate('publicar',{ruta:routeId,version:route.actualizado_en});
    await db.exec('RESET ROLE');await setIdentity(driver,'aal1',true);
    const mobile=(await db.query(`SELECT brax_driver_snapshot() AS data`)).rows[0].data;
    assert.equal(mobile.rutas.length,1);assert.equal(mobile.rutas[0].paradas.length,2);assert.equal(mobile.rutas[0].paradas[0].id,stops[1].id);
    await db.exec('RESET ROLE');await setIdentity(admin);
    const second=await mutate('crear',{nombre:'QA Otra',camion:'TEST-01',fecha:'2026-11-20'});
    let secondRoute=(await snapshot()).rutas.find(r=>r.id===second);
    await assert.rejects(mutate('asignar',{ruta:second,version:secondRoute.actualizado_en,retiros:[{origen:'B2C',id:pickups[0].id}]}),/asignado/);
    const beforeCount=(await snapshot()).rutas.length;
    await assert.rejects(mutate('crear',{nombre:'Must rollback',camion:'TEST-01',fecha:'2026-11-20',conductor_id:'ffffffff-ffff-4fff-8fff-ffffffffffff'}),/driver/);
    assert.equal((await snapshot()).rutas.length,beforeCount,'driver assignment failure rolls back route creation');
    route=(await snapshot()).rutas.find(r=>r.id===routeId);
    await mutate('quitar',{ruta:routeId,version:route.actualizado_en,parada:stops[0].id});
    const draft=await mutate('crear',{nombre:'QA Descartar',camion:'TEST-01',fecha:'2026-11-20',borrador:true,retiros:[{origen:'B2C',id:pickups[0].id}]});
    const draftRoute=(await snapshot()).rutas.find(r=>r.id===draft);
    await mutate('eliminar_borrador',{ruta:draft,version:draftRoute.actualizado_en});
    const discarded=(await snapshot()).rutas.find(r=>r.id===draft);
    assert.equal(discarded.estado,'Cancelada');assert.equal(discarded.borrador,false);
    assert.equal((await snapshot()).paradas.filter(s=>s.ruta_id===draft&&s.activa).length,0);
    assert.equal((await snapshot()).solicitudes.length,2,'no source requests deleted');
    await db.exec('RESET ROLE');
    const rls=(await db.query(`SELECT count(*)::int AS count FROM pg_class WHERE relname IN ('flota_rutas','flota_paradas','solicitudes_b2b','solicitudes_b2c') AND relrowsecurity`)).rows[0].count;
    assert.equal(rls,4);
  } finally { await db.close(); }
});
