/* eslint-disable @typescript-eslint/no-require-imports -- Pure backend geocoder tests. */
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const ts=require('typescript');const vm=require('node:vm');
const api={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.resolve(__dirname,'../../supabase/functions/geocode-pickups/geocoder.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports:api,URL,URLSearchParams,AbortSignal,fetch});
const job={id:'job',origen:'B2C',solicitud:'s',direccion:'Tres Montes 692',comuna:'Quilicura'};
const result={geometry:{lat:-33.36,lng:-70.73},confidence:10,formatted:'Tres Montes 692, Quilicura, Chile',components:{country_code:'cl',road:'Tres Montes',house_number:'692',municipality:'Quilicura',_type:'building'}};
test('Backend geocoder strips contact details and never assumes a missing commune or RM',()=>{
 const query=api.queryFor({...job,direccion:'Tres Montes 692 · Contacto: persona@example.test',comuna:null});
 assert.equal(query,'Tres Montes 692, Chile');assert.ok(!query.includes('@'));assert.ok(!query.includes('Metropolitana'));
});
test('Only a matching house number, street, explicit commune, country and precise feature can auto-confirm',()=>{
 assert.equal(api.classify(job,[result]).estado,'confirmada');
 for(const candidate of [{...result,components:{...result.components,house_number:'693'}},{...result,components:{...result.components,_type:'city'}},{...result,components:{...result.components,municipality:'Santiago'}},{...result,geometry:{lat:-70.73,lng:-33.36}},{...result,geometry:{lat:0,lng:0}}])assert.notEqual(api.classify(job,[candidate]).estado,'confirmada');
 assert.equal(api.classify({...job,comuna:null},[result]).estado,'ambigua');
 assert.equal(api.classify({...job,direccion:'Tres Montes 692, Quilicura',comuna:null},[result]).estado,'confirmada');
 assert.equal(api.classify(job,[result,{...result,geometry:{lat:-33.37,lng:-70.74}}]).estado,'ambigua');
 assert.equal(api.classify(job,[]).estado,'no_encontrada');
});
test('Provider requests stay on the backend, use Chile/privacy context and report controlled retry errors',async()=>{
 let called;
 const found=await api.geocode(job,'test-key',async url=>{called=url;return {ok:true,json:async()=>({status:{code:200},results:[result]})};});
 assert.equal(found.estado,'confirmada');assert.equal(called.searchParams.get('countrycode'),'cl');assert.equal(called.searchParams.get('no_record'),'1');
 const limited=await api.geocode(job,'test-key',async()=>({ok:false,status:429}));assert.equal(limited.reintentable,true);
 const badKey=await api.geocode(job,'test-key',async()=>({ok:false,status:403}));assert.equal(badKey.reintentable,false);
 const network=await api.geocode(job,'test-key',async()=>{throw Error('secret-url-must-not-leak');});assert.ok(!network.error.includes('secret-url'));
});
