'use client';
import { useState, type FormEvent } from 'react';
import type { Driver, FleetTruck } from '@/lib/dispatch-model';
import styles from './dispatch.module.css';
export default function FleetCatalog({kind,drivers,trucks,admin,busy,onSave}: {
 kind:'conductor'|'camion';drivers:Driver[];trucks:FleetTruck[];admin:boolean;busy:boolean;
 onSave:(kind:string,data:Record<string,unknown>)=>Promise<boolean>;
}){
 const [selected,setSelected]=useState('');
 const driver=drivers.find(d=>d.id===selected),truck=trucks.find(t=>t.identificador===selected);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!admin||busy)return;
  const values=Object.fromEntries(new FormData(event.currentTarget));
  values.activo=values.activo==='si'?'true':'false';
  if(await onSave(kind,values))setSelected('');
 }
 return <div className={styles.catalog}>
  <p className={styles.muted}>{admin?'Selecciona un registro para editar sus datos. Las cuentas y contraseñas se mantienen en Supabase Auth.':'Consulta del catálogo. Solo un administrador puede modificar conductores y camiones.'}</p>
  <div className={styles.catalogTable}><table className={styles.table}><thead><tr>{(kind==='conductor'?['Identificador','Nombre','Correo','Teléfono','Camión predeterminado','Estado']:['Código','Patente','Tipo','Capacidad','Conductor predeterminado','GPS','Estado']).map(label=><th key={label}>{label}</th>)}</tr></thead>
   <tbody>{kind==='conductor'?drivers.map(item=><tr key={item.id} onClick={()=>setSelected(item.id)} aria-selected={selected===item.id}><td>{item.codigo||item.id}</td><td>{item.nombre}</td><td>{item.email||'Sin correo'}</td><td>{item.telefono||'Sin teléfono'}</td><td>{item.camion_predeterminado||'Sin asignar'}</td><td>{item.activo===false?'Inactivo':'Activo'}</td></tr>):trucks.map(item=><tr key={item.identificador} onClick={()=>setSelected(item.identificador)} aria-selected={selected===item.identificador}><td>{item.identificador}</td><td>{item.patente||'Sin patente'}</td><td>{item.tipo_vehiculo||'Sin tipo'}</td><td>{item.capacidad_kg?`${item.capacidad_kg} kg`:'Sin definir'}</td><td>{drivers.find(d=>d.id===item.conductor_predeterminado)?.nombre||'Sin asignar'}</td><td>{item.fuente_gps||'Sin fuente'}</td><td>{item.activo===false?'Inactivo':'Activo'}</td></tr>)}</tbody></table></div>
  {admin&&<><button className={styles.button} onClick={()=>setSelected('')}>{kind==='conductor'?'Seleccionar otro usuario conductor':'Nuevo camión'}</button>
   {kind==='conductor'&&!driver?<label className={styles.form}>Usuario conductor de Supabase Auth<select aria-label="Usuario conductor existente" value="" onChange={event=>setSelected(event.target.value)}><option value="">Selecciona una cuenta existente</option>{drivers.map(item=><option key={item.id} value={item.id}>{item.nombre} · {item.email||item.id}</option>)}</select></label>
    :<form key={selected||'new'} className={styles.form} onSubmit={event=>void submit(event)}>
     {kind==='conductor'&&driver?<><input type="hidden" name="user_id" value={driver.id}/><label>Usuario Auth<input readOnly value={driver.id}/></label>
      <div className={styles.formGrid}><label>Identificador<input name="codigo" required defaultValue={driver.codigo}/></label><label>Nombre<input name="nombre" required defaultValue={driver.nombre}/></label></div>
      <label>Correo de Supabase Auth<input readOnly value={driver.email||'Sin correo registrado'}/></label><label>Teléfono<input name="telefono" type="tel" defaultValue={driver.telefono||''}/></label>
      <label>Camión predeterminado<select name="camion_predeterminado" defaultValue={driver.camion_predeterminado||''}><option value="">Sin asignar</option>{trucks.filter(t=>t.activo!==false||t.identificador===driver.camion_predeterminado).map(item=><option key={item.identificador}>{item.identificador}</option>)}</select></label></>
      :<><label>Código del camión<input name="identificador" required readOnly={!!truck} defaultValue={truck?.identificador}/></label><div className={styles.formGrid}><label>Patente<input name="patente" defaultValue={truck?.patente||''}/></label><label>Tipo de vehículo<input name="tipo_vehiculo" defaultValue={truck?.tipo_vehiculo||''}/></label></div>
       <label>Capacidad máxima (kg)<input name="capacidad_kg" type="number" min="0.001" step="any" defaultValue={truck?.capacidad_kg||''}/></label><label>Conductor predeterminado<select name="conductor_predeterminado" defaultValue={truck?.conductor_predeterminado||''}><option value="">Sin asignar</option>{drivers.filter(d=>d.activo!==false).map(item=><option key={item.id} value={item.id}>{item.nombre}</option>)}</select></label>
       <div className={styles.formGrid}><label>Fuente GPS<select name="fuente_gps" defaultValue={truck?.fuente_gps||''}><option value="">Sin fuente</option><option value="phone">Teléfono</option><option value="esp32">ESP32</option></select></label><label>Identificador de telemetría ESP32<input name="gps_identificador" defaultValue={truck?.gps_identificador||''} placeholder="Identificador emitido por el dispositivo"/></label></div></>}
     <label>Estado<select name="activo" defaultValue={(kind==='conductor'?driver?.activo:truck?.activo)===false?'no':'si'}><option value="si">Activo</option><option value="no">Inactivo</option></select></label>
     <button className={styles.primary} disabled={busy}>Guardar {kind==='conductor'?'conductor':'camión'}</button>
    </form>}</>}
 </div>;
}
