/* eslint-disable @typescript-eslint/no-require-imports -- Standalone browser integration runner. */
// Serves the production export on http://127.0.0.1:3100. Uses synthetic QA data in isolated PostgreSQL.
// All Supabase requests and WebSockets are intercepted; no production data is written.
const { chromium } = require('../tmp/browser-check/node_modules/playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { createDatabase, admin, driver, operator } = require('./helpers/dispatch-db.cjs');
const rawUrl = fs.readFileSync('.env.local','utf8').match(/^NEXT_PUBLIC_SUPABASE_URL\s*=\s*["']?([^\s"']+)/m)?.[1];
const host = new URL(rawUrl).hostname;
(async()=>{
 const db=await createDatabase();
 for(const name of ['20261120_driver_jornada.sql','20261120_erp_geocodificacion.sql','20261120_erp_planificacion.sql'])await db.exec(fs.readFileSync(require('node:path').resolve(__dirname,'../../Database/migrations',name),'utf8'));
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try {
  await db.exec(`INSERT INTO solicitudes_b2c(nombre,rut,material,kilos_estimados) VALUES('QA C','QA-C','Vidrio',15)`);
  const pickups=(await db.query('SELECT * FROM solicitudes_b2c ORDER BY nombre')).rows;
  await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims','{"aal":"aal2"}',false)`,[admin]);
  await db.exec('SET ROLE authenticated');
  await db.query(`SELECT flota_catalogo_guardar('conductor',$1::jsonb)`,[JSON.stringify({user_id:driver,codigo:'DRIVER1',nombre:'Conductor prueba',camion_predeterminado:'TEST-01',activo:true})]);
  for(let i=0;i<pickups.length;i++)await db.query(`SELECT flota_despacho_solicitud('B2C',$1,$2::jsonb)`,[pickups[i].id,JSON.stringify({direccion:`Dirección de prueba ${i+1}`,comuna:'Comuna QA',prioridad:i===2?'alta':'normal',latitud:-33.42-i*.02,longitud:-70.60-i*.02})]);
  const routeId=(await db.query(`SELECT flota_despacho_mutar('crear',$1::jsonb) AS id`,[JSON.stringify({nombre:'QA Ruta principal',fecha:'2026-11-20',camion:'TEST-01',conductor_id:driver,retiros:pickups.slice(0,2).map(item=>({origen:'B2C',id:item.id}))})])).rows[0].id;
  await db.exec('RESET ROLE');
  await db.query(`INSERT INTO flota_gps_conductor(ruta_id,conductor_id,latitud,longitud) VALUES($1,$2,-33.45,-70.63)`,[routeId,driver]);
  await db.exec(`INSERT INTO telemetria_flota(patente_camion,latitud,longitud,fuente_ubicacion) VALUES('TEST-01',-33.44,-70.62,'gps')`);
  await db.exec('SET ROLE authenticated');
  const calls=[],errors=[],realtimeConnections=[];
  let currentId=admin;
  const user=()=>({id:currentId,email:'qa@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},factors:[{id:'22222222-2222-4222-8222-222222222222',factor_type:'totp',status:'verified'}]});
  const session=()=>({access_token:[{alg:'HS256',typ:'JWT'},{sub:currentId,aal:'aal2',role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600,amr:[]}].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.')+'.'+Buffer.from('qa-signature').toString('base64url'),refresh_token:'local-test',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:user()});
  const context=await browser.newContext({viewport:{width:1720,height:1080}});
  let cartoRequests=0;
  context.on('request',request=>{if(new URL(request.url()).hostname.endsWith('basemaps.cartocdn.com'))cartoRequests++;});
  await context.route(`https://${host}/**`,async route=>{
   const path=new URL(route.request().url()).pathname,args=route.request().postDataJSON(); calls.push({path,args});
   try {
    let result;
    if(path==='/auth/v1/user')result=user();
    else if(path==='/rest/v1/rpc/erp_role')result=currentId===operator?'operador':'admin';
    else if(path==='/rest/v1/rpc/flota_plan_snapshot')result=(await db.query('SELECT flota_plan_snapshot() AS data')).rows[0].data;
    else if(path==='/rest/v1/rpc/flota_ruta_proponer')result=(await db.query('SELECT flota_ruta_proponer() AS data')).rows[0].data;
    else if(path==='/rest/v1/rpc/flota_catalogo_guardar'){await db.query('SELECT flota_catalogo_guardar($1,$2::jsonb)',[args.p_tipo,JSON.stringify(args.p_datos)]);result=null;}
    else if(path==='/rest/v1/rpc/flota_despacho_catalogo')result=(await db.query('SELECT flota_despacho_catalogo() AS data')).rows[0].data;
    else if(path==='/rest/v1/rpc/flota_despacho_mutar')result=(await db.query('SELECT flota_despacho_mutar($1,$2::jsonb) AS data',[args.p_accion,JSON.stringify(args.p_datos)])).rows[0].data;
    else if(path==='/rest/v1/rpc/flota_despacho_solicitud'){await db.query('SELECT flota_despacho_solicitud($1,$2,$3::jsonb)',[args.p_origen,args.p_id,JSON.stringify(args.p_datos)]);result=null;}
    else if(['/rest/v1/flota_gps_conductor','/rest/v1/flota_resultados_conductor'].includes(path))result=(await db.query(`SELECT * FROM ${path.split('/').pop()}`)).rows;
    else if(path.startsWith('/rest/v1/'))result=[];
    else throw new Error('Unexpected HTTP '+path);
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
   }catch(error){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:error.code||'QA_ERROR',message:error.message})});}
  });
  await context.routeWebSocket(`wss://${host}/**`,socket=>socket.onMessage(raw=>{
   const wire=JSON.parse(String(raw));const message=Array.isArray(wire)?{join_ref:wire[0],ref:wire[1],topic:wire[2],event:wire[3],payload:wire[4]}:wire;
   const reply=payload=>socket.send(JSON.stringify(Array.isArray(wire)?[message.join_ref,message.ref,message.topic,'phx_reply',payload]:{topic:message.topic,event:'phx_reply',ref:message.ref,payload}));
   if(message.event==='phx_join'){
    const filters=(message.payload.config.postgres_changes??[]).map((filter,index)=>({...filter,id:index+1}));
    realtimeConnections.push({socket,message,filters,array:Array.isArray(wire)});
    reply({status:'ok',response:{postgres_changes:filters}});
   }
   else if(['phx_leave','heartbeat'].includes(message.event))reply({status:'ok',response:{}});
  }));
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:3100/');
  await page.evaluate(({key,session})=>sessionStorage.setItem(key,JSON.stringify(session)),{key:`sb-${host.split('.')[0]}-auth-token`,session:session()});
  await page.goto('http://127.0.0.1:3100/rutas/');
  const routeRow=page.locator(`[data-route-id="${routeId}"]`);
  await routeRow.waitFor();await page.getByRole('button',{name:'Driver · teléfono',exact:false}).waitFor();
  const missingKey=page.getByRole('status').filter({hasText:'Mapa base pendiente de configuración'});
  if(await missingKey.count()){assert.equal(cartoRequests,0,'no CARTO requests without a configured key');}
  const stopTable=page.getByRole('table',{name:'Paradas de la ruta',exact:true});
  await assertCount(stopTable.locator('tbody tr[data-stop-id]'),2);
  const unassigned=page.locator(`[data-pickup-key="B2C:${pickups[2].id}"]`);
  await unassigned.click();
  await page.getByRole('button',{name:'Ver solicitud',exact:true}).waitFor();
  assert.equal(await unassigned.getAttribute('aria-selected'),'true');
  await page.getByRole('button',{name:'Ver solicitud',exact:true}).click();
  const pickupDialog=page.getByRole('dialog',{name:'Datos de retiro',exact:false});
  await pickupDialog.getByLabel('Latitud',{exact:true}).fill('-33.465');
  await pickupDialog.getByLabel('Longitud',{exact:true}).fill('-70.645');
  await pickupDialog.getByRole('checkbox').check();
  await pickupDialog.getByRole('button',{name:'Guardar datos de retiro',exact:true}).click();
  await pickupDialog.waitFor({state:'hidden'});
  const confirmedLocation=(await db.query('SELECT latitud,confirmada_manualmente FROM flota_ubicaciones WHERE solicitud_b2c=$1',[pickups[2].id])).rows[0];
  assert.equal(confirmedLocation.latitud,-33.465);assert.equal(confirmedLocation.confirmada_manualmente,true);
  await unassigned.dragTo(routeRow);
  await assertCount(stopTable.locator('tbody tr[data-stop-id]'),3);
  assert.ok(calls.some(call=>call.args?.p_accion==='asignar'),'native drag/drop called persisted RPC');
  const stops=(await db.query('SELECT * FROM flota_paradas WHERE ruta_id=$1 AND activa ORDER BY orden',[routeId])).rows;
  const stopSplitter=page.getByRole('separator',{name:'Altura de paradas y retiros',exact:true});
  await stopSplitter.focus();for(let n=0;n<7;n++)await page.keyboard.press('ArrowDown');
  await page.locator('table[aria-label="Paradas de la ruta"]').evaluate(table=>{table.parentElement.scrollTop=0;});
  await page.waitForFunction(()=>!document.querySelector('button[aria-label="Arrastrar parada 3"]')?.disabled);
  await page.getByRole('button',{name:'Arrastrar parada 3',exact:true}).dragTo(page.locator(`[data-stop-id="${stops[0].id}"]`));
  await page.waitForFunction(expected=>document.querySelector('table[aria-label="Paradas de la ruta"] tbody tr')?.getAttribute('data-stop-id')===expected,stops[2].id);
  assert.equal((await db.query('SELECT id FROM flota_paradas WHERE ruta_id=$1 AND activa ORDER BY orden',[routeId])).rows[0].id,stops[2].id);
  await unassigned.waitFor({state:'detached'});
  async function phoneChange(callback){
   await db.exec('RESET ROLE');
   await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims','{"aal":"aal1","app_metadata":{"role":"driver"}}',false)`,[driver]);
   await db.exec('SET ROLE authenticated');
   const mobile=(await db.query('SELECT brax_driver_snapshot() AS data')).rows[0].data.rutas.find(r=>r.id===routeId);
   await callback(mobile);
   await db.exec('RESET ROLE');
   await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims','{"aal":"aal2"}',false)`,[admin]);
   await db.exec('SET ROLE authenticated');
   const record=(await db.query('SELECT row_to_json(r) AS data FROM flota_rutas r WHERE id=$1',[routeId])).rows[0].data;
   for(const connection of realtimeConnections){
    const filter=connection.filters.find(f=>f.table==='flota_rutas');if(!filter)continue;
    const payload={ids:[filter.id],data:{schema:'public',table:'flota_rutas',commit_timestamp:new Date().toISOString(),eventType:'UPDATE',type:'UPDATE',new:record,record,old:{},old_record:{},errors:[],columns:[]}};
    connection.socket.send(JSON.stringify(connection.array?[connection.message.join_ref,null,connection.message.topic,'postgres_changes',payload]:{topic:connection.message.topic,event:'postgres_changes',payload}));
   }
  }
  await phoneChange(mobile=>db.query(`SELECT brax_driver_ruta($1,$2,'iniciar')`,[routeId,mobile.actualizado_en]));
  await page.getByRole('button',{name:'Driver · teléfono · En línea',exact:false}).waitFor();
  await page.getByRole('button',{name:'ESP32 · TEST-01 · En línea',exact:false}).waitFor();
  await phoneChange(mobile=>db.query(`SELECT brax_driver_parada($1,$2,$3,'en_camino')`,[routeId,mobile.paradas[0].id,mobile.paradas[0].actualizado_en]));
  await page.getByRole('table',{name:'Paradas de la ruta',exact:true}).getByText('En camino',{exact:true}).waitFor();
  const selectedStop=page.locator(`[data-stop-id="${stops[2].id}"]`);await selectedStop.click();
  assert.equal(await selectedStop.getAttribute('aria-selected'),'true');
  assert.ok(await page.locator('.leaflet-marker-icon').count()>=5);
  const splitter=page.getByRole('separator',{name:'Ancho de planificación y mapa',exact:true});
  const before=await splitter.getAttribute('aria-valuenow');await splitter.focus();await page.keyboard.press('ArrowRight');assert.notEqual(await splitter.getAttribute('aria-valuenow'),before);
  await page.getByRole('button',{name:'Centrar ruta',exact:true}).click();
  await page.locator('table[aria-label="Paradas de la ruta"]').evaluate(table=>{table.parentElement.scrollTop=0;});
  await page.screenshot({path:'tmp/dispatch-desktop-qa.png',fullPage:true});
  await page.getByRole('button',{name:'Crear ruta',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Crear ruta en Supabase',exact:true});
  await dialog.getByLabel('Número de ruta',{exact:true}).fill('QA Borrador nuevo');
  await dialog.getByLabel('Conductor',{exact:true}).selectOption(driver);
  assert.equal(await dialog.getByLabel('Camión',{exact:true}).inputValue(),'TEST-01');
  await dialog.getByLabel('Estado inicial',{exact:true}).selectOption('Borrador');
  await dialog.getByLabel('Fecha',{exact:true}).fill('2026-11-21');
  await dialog.getByRole('button',{name:'Guardar ruta',exact:true}).click();await dialog.waitFor({state:'hidden'});
  const draft=(await db.query("SELECT * FROM flota_rutas WHERE codigo='QA Borrador nuevo'")).rows[0];assert.equal(draft.borrador,true);
  await page.locator(`[data-route-id="${draft.id}"]`).click();
  await page.waitForFunction(()=>![...document.querySelectorAll('.leaflet-marker-icon')].some(node=>node.title.startsWith('QA ')));
  await routeRow.click();
  await page.waitForFunction(()=>document.querySelectorAll('.leaflet-marker-icon').length>=5);
  await page.locator(`[data-route-id="${draft.id}"]`).click();
  await page.getByRole('button',{name:'Eliminar ruta vacía',exact:true}).click();
  await page.getByRole('button',{name:'Eliminar ruta',exact:true}).click();
  await page.getByRole('dialog',{name:'Eliminar ruta vacía',exact:true}).waitFor({state:'hidden'});
  assert.ok((await db.query('SELECT eliminada_en FROM flota_rutas WHERE id=$1',[draft.id])).rows[0].eliminada_en);
  // An authorized operator can plan routes, but cannot manage the driver/truck catalogs.
  currentId=operator;await db.exec('RESET ROLE');await db.query(`SELECT set_config('request.jwt.claim.sub',$1,false)`,[operator]);await db.exec('SET ROLE authenticated');
  await page.evaluate(({key,session})=>sessionStorage.setItem(key,JSON.stringify(session)),{key:`sb-${host.split('.')[0]}-auth-token`,session:session()});await page.reload();
  await page.getByRole('button',{name:'Crear ruta',exact:true}).click();
  const operatorDialog=page.getByRole('dialog',{name:'Crear ruta en Supabase',exact:true});
  await page.waitForFunction(()=>/^R[0-9]+$/.test(document.querySelector('input[name="codigo"]')?.value||''));
  const operatorCode=await operatorDialog.getByLabel('Número de ruta',{exact:true}).inputValue();
  await operatorDialog.getByLabel('Conductor',{exact:true}).selectOption(driver);
  assert.equal(await operatorDialog.getByLabel('Camión',{exact:true}).inputValue(),'TEST-01');
  await operatorDialog.getByLabel('Fecha',{exact:true}).fill('2026-11-21');
  await operatorDialog.getByRole('button',{name:'Guardar ruta',exact:true}).click();await operatorDialog.waitFor({state:'hidden'});
  assert.ok((await db.query('SELECT id FROM flota_rutas WHERE codigo=$1',[operatorCode])).rows.length);
  await page.getByRole('button',{name:'Conductores',exact:true}).click();
  assert.equal(await page.getByRole('dialog',{name:'Conductores',exact:true}).getByRole('button',{name:'Guardar conductor',exact:true}).count(),0);
  await page.getByRole('button',{name:'Cerrar ventana',exact:true}).click();
  if(await missingKey.count())assert.equal(cartoRequests,0,'missing key must never request CARTO tiles, even after route changes');
  assert.deepEqual(errors,[]);
  console.log('PASS: desktop layout, native request assignment and stop reorder, phone-to-ERP Realtime refresh, PostgreSQL persistence, independent phone/ESP32 GPS, splitter keyboard controls, automatic editable codes, driver default truck, safe empty deletion, operator planning and catalog read-only. All backend data isolated QA fixtures.');
 }finally{await browser.close();await db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
async function assertCount(locator,expected){await locator.first().page().waitForFunction(({selector,count})=>document.querySelectorAll(selector).length===count,{selector:'table[aria-label="Paradas de la ruta"] tbody tr[data-stop-id]',count:expected});assert.equal(await locator.count(),expected);}
