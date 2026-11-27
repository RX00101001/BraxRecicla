'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { Crosshair, GripVertical, MapPin, Navigation, Package, Pencil, Plus, RefreshCw, Search, Truck, Users, X } from 'lucide-react';
import { canManageDispatch, type ErpRole } from '@/lib/erp-access';
import { supabase } from '@/lib/supabase';
import { availablePickups, coordinates, dispatchStopLabel, editableRoute, geoStatus, routeCode, livePositions, orderedStops, pickupCode, pickupCoordinates, pickupDay, pickupKey, pickupName, pickupWeight, reorderStops, routeState, routeSummary, stopKey,
  type DispatchRoute, type MapPoint, type Pickup } from '@/lib/dispatch-model';
import { useDispatch } from './useDispatch';
import ResizableSplit from './ResizableSplit';
import FleetCatalog from './FleetCatalog';
import styles from './dispatch.module.css';

const DispatchMap = dynamic(() => import('./DispatchMap'), { ssr: false, loading: () => <div className={styles.empty}>Cargando mapa…</div> });
const number = (n: number) => n.toLocaleString('es-CL', { maximumFractionDigits: 1 });
const date = (value?: string | null) => value ? /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.split('-').reverse().join('/') : new Date(value).toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }) : 'Sin fecha';
const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago' }).format(new Date());
const REQUEST_MIME = 'application/x-brax-pickups', STOP_MIME = 'application/x-brax-stop';

function Panel({ title, count, icon, tools, children, hint }: { title: string; count?: number; icon: ReactNode; tools?: ReactNode; children: ReactNode; hint?: string }) {
  return <section className={styles.panel} aria-label={title}>
    <div className={styles.panelHeading}><h2>{icon}{title}{count != null && <span className={styles.count}>{count}</span>}</h2>{tools}</div>
    {hint && <p className={styles.hint}>{hint}</p>}
    <div className={styles.tableScroll}>{children}</div>
  </section>;
}
function Empty({ columns, children }: { columns: number; children: ReactNode }) {
  return <tr><td colSpan={columns} className={styles.empty}>{children}</td></tr>;
}
function Badge({ value }: { value: string }) {
  const tone = ['En ruta','en curso','En camino','He llegado','Retiro en proceso'].includes(value) ? styles.blue : ['Finalizada','realizado'].includes(value) ? styles.green : ['Cancelada','no realizado'].includes(value) ? styles.red : styles.amber;
  return <span className={`${styles.badge} ${tone}`}>{value}</span>;
}
function Modal({ title, children, close, busy, wide = false }: { title: string; children: ReactNode; close: () => void; busy: boolean; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={`${styles.dialog} ${wide?styles.catalogDialog:''}`} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <div className={styles.dialogHeader}><h2>{title}</h2><button type="button" className={styles.iconButton} aria-label="Cerrar ventana" disabled={busy} onClick={close}><X size={20}/></button></div>
    {children}
  </dialog>;
}

export default function DispatchWorkspace({ role }: { role: ErpRole }) {
  const data = useDispatch();
  const { plan, drivers, results, phones, extended, advanced, busy, loading, connected, error, lastUpdated, refresh, mutate, rpc, reportError } = data;
  const canManage = canManageDispatch(role) && (role !== 'operador' || advanced);
  const isAdmin = role === 'admin' || role === 'dueno';
  const [routeId, setRouteId] = useState(''), [focus, setFocus] = useState('');
  const [center, setCenter] = useState(0), [now, setNow] = useState(0);
  const [fitAll,setFitAll] = useState(false), [pickupState,setPickupState] = useState('');
  const [catalogKind,setCatalogKind] = useState<'conductor'|'camion'|null>(null);
  const [proposedCode,setProposedCode] = useState(''), [proposalLoading,setProposalLoading] = useState(false);
  const [routeTruck,setRouteTruck] = useState(''), [routeDriver,setRouteDriver] = useState('');
  const proposalRequest=useRef(0);
  const [pickerCoords,setPickerCoords] = useState({lat:'',lng:''}), [confirmLocation,setConfirmLocation] = useState(false);
  const [pickerVersion,setPickerVersion] = useState(0);
  const [geoBusy,setGeoBusy] = useState(false),[geoReport,setGeoReport]=useState('');
  const [filterDate, setFilterDate] = useState(''), [filterState, setFilterState] = useState('');
  const [filterDriver, setFilterDriver] = useState(''), [filterTruck, setFilterTruck] = useState('');
  const [commune, setCommune] = useState(''), [search, setSearch] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]), [dropRoute, setDropRoute] = useState('');
  const [routeModal, setRouteModal] = useState<'create' | 'edit' | null>(null);
  const [editingRoute, setEditingRoute] = useState<DispatchRoute | null>(null);
  const [pickupModal, setPickupModal] = useState<Pickup | null>(null);
  const [assignRoute, setAssignRoute] = useState<DispatchRoute | null>(null), [evidenceId, setEvidenceId] = useState('');
  const [photoLinks, setPhotoLinks] = useState<Record<string,string>>({});
  const [photoBusy, setPhotoBusy] = useState(false), [deleteRoute, setDeleteRoute] = useState<DispatchRoute | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now()); tick();
    const timer = setInterval(tick, 15000); return () => clearInterval(timer);
  }, []);
  const driverLabel = (route: DispatchRoute) => drivers.find(driver => driver.id === route.conductor_id)?.nombre || route.conductor || (route.conductor_id ? `UUID ${route.conductor_id.slice(0,8)}` : 'Sin asignar');
  const routeList = useMemo(() => (plan?.rutas ?? []).filter(route => (!filterDate || route.fecha === filterDate)
    && (!filterState || routeState(route) === filterState) && (!filterDriver || route.conductor_id === filterDriver)
    && (!filterTruck || route.camion === filterTruck)), [plan, filterDate, filterState, filterDriver, filterTruck]);
  const route = routeList.find(item => item.id === routeId) ?? routeList[0];
  const stops = useMemo(() => plan && route ? orderedStops(plan,route.id) : [], [plan,route]);
  const requests = useMemo(() => new Map((plan?.solicitudes ?? []).map(item => [pickupKey(item),item])), [plan]);
  const available = useMemo(() => plan ? availablePickups(plan) : [], [plan]);
  const filteredAvailable = available.filter(item => (!pickupState || item.estado === pickupState) && (!commune || item.comuna === commune) && (!filterDate || pickupDay(item) === filterDate)
    && [pickupCode(item),pickupName(item),item.direccion,item.comuna,item.material].filter(Boolean).join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  const communes = [...new Set((plan?.solicitudes ?? []).map(item => item.comuna).filter((value): value is string => !!value))].sort();
  const summary = plan && route ? routeSummary(plan,route) : undefined;
  const live = useMemo(() => plan ? livePositions(plan,route,phones,now) : [], [plan,route,phones,now]);
  const mapPoints = useMemo(() => {
    if (!plan) return [];
    const assigned = stops.flatMap((stop,index) => {
      const item = requests.get(stopKey(stop)); const point = item && pickupCoordinates(item,plan.ubicaciones);
      return item && point ? [{ key: pickupKey(item), label: pickupName(item), detail: item.direccion || 'Sin dirección', latitud: point[0], longitud: point[1], order: index + 1, kind: 'assigned' as const, pickup:item }] : [];
    });
    const unassigned = filteredAvailable.flatMap(item => {
      const point = pickupCoordinates(item,plan.ubicaciones);
      return point ? [{ key: pickupKey(item), label: pickupName(item), detail: item.direccion || 'Sin dirección', latitud: point[0], longitud: point[1], kind: 'unassigned' as const, pickup:item }] : [];
    });
    return [...assigned,...unassigned] as MapPoint[];
  }, [plan,stops,requests,filteredAvailable]);
  const selectPoint = useCallback((key: string) => { setFocus(key); setCenter(value => value+1); }, []);
  const selectRoute = (item: DispatchRoute) => { setRouteId(item.id); setFitAll(false); setFocus(''); setCenter(value => value + 1); };
  const canEdit = canManage && (role!=='operador' || route?.estado==='Programada') && editableRoute(route) && !busy && !loading;
  const canReorder = canEdit && !stops.some(stop => ['realizado','no realizado'].includes(stop.estado));
  const editRoute = () => { if (route) { setEditingRoute({ ...route }); setRouteTruck(route.camion); setRouteDriver(route.conductor_id||''); setRouteModal('edit'); } };
  const currentData = (item: DispatchRoute) => ({ ruta: item.id, version: item.actualizado_en });

  async function openCreate() {
    setProposedCode(''); setRouteTruck(''); setRouteDriver(''); setRouteModal('create');
    if (!advanced) return;
    const version=++proposalRequest.current;setProposalLoading(true);
    try { const result=await supabase.rpc('flota_ruta_proponer');if(result.error)throw result.error;if(version===proposalRequest.current)setProposedCode(result.data); }
    catch { if(version===proposalRequest.current)reportError('No se pudo obtener el próximo número de ruta. Reintenta antes de guardar.'); }
    finally { if(version===proposalRequest.current)setProposalLoading(false); }
  }
  const editPickup=useCallback((item: Pickup) => {
    const point=plan && pickupCoordinates(item,plan.ubicaciones);
    setPickerCoords({lat:point?String(point[0]):'',lng:point?String(point[1]):''});setConfirmLocation(false);setPickerVersion(value=>value+1);setPickupModal(item);
  },[plan]);
  const pickPosition=useCallback((lat:number,lng:number)=>{setPickerCoords({lat:lat.toFixed(6),lng:lng.toFixed(6)});setConfirmLocation(false);setPickerVersion(value=>value+1);},[]);
  async function geocodePending() {
    if(!isAdmin||geoBusy)return;setGeoBusy(true);setGeoReport('');
    try {
      const result=await supabase.functions.invoke('geocode-pickups',{body:{encolar:true,limite:5}});
      if(result.error){reportError('No se pudo ejecutar la geocodificación. Comprueba que la función y su clave estén configuradas.');return;}
      const value=result.data;
      setGeoReport(`Encoladas: ${value.encoladas||0} · Procesadas: ${value.procesadas||0} · Resueltas: ${value.resueltas||0} · Revisión: ${value.revision||0} · Errores: ${value.errores||0} · Omitidas por cambios simultáneos: ${value.omitidas||0}. Los trabajos restantes se procesan por el backend programado.`);
      await refresh();
    } catch { reportError('No se pudo conectar con la función de geocodificación. Reintenta más tarde.'); } finally {setGeoBusy(false);}
  }
  const viewPickup=useCallback((key:string)=>{const item=requests.get(key);if(item)editPickup(item);},[requests,editPickup]);
  async function assign(item: DispatchRoute, keys: string[]) {
    if (!canManage || (role==='operador' && item.estado!=='Programada') || !editableRoute(item) || busy || loading) return;
    const valid = new Set(available.map(pickupKey));
    if (!keys.length || keys.some(key => !valid.has(key))) { reportError('Selecciona solicitudes que sigan disponibles.'); return; }
    const result = await mutate('asignar', { ...currentData(item), retiros: keys.map(key => { const pickup = requests.get(key)!; return { origen: pickup.origen, id: pickup.id }; }) });
    if (result.ok) { setSelectedKeys([]); selectRoute(item); }
  }
  function startPickupDrag(event: DragEvent, item: Pickup) {
    if (!canManage || busy) { event.preventDefault(); return; }
    const key = pickupKey(item), keys = selectedKeys.includes(key) ? selectedKeys.filter(value => available.some(pickup => pickupKey(pickup) === value)) : [key];
    event.dataTransfer.setData(REQUEST_MIME, JSON.stringify(keys)); event.dataTransfer.effectAllowed = 'move';
  }
  function pickupDrop(event: DragEvent, item: DispatchRoute) {
    event.preventDefault(); setDropRoute('');
    try { const keys: unknown = JSON.parse(event.dataTransfer.getData(REQUEST_MIME)); if (Array.isArray(keys) && keys.every(key => typeof key === 'string')) void assign(item,keys); } catch { reportError('No se pudo leer la solicitud arrastrada.'); }
  }
  async function reorder(dragged: string, target: string) {
    if (!canReorder || !route) return;
    const order = reorderStops(stops,dragged,target);
    if (order) await mutate('ordenar', { ...currentData(route), orden: order });
  }
  async function submitRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canManage || busy || loading) return;
    const fields = new FormData(event.currentTarget);
    const values: Record<string,unknown> = { nombre: String(fields.get('codigo')).trim(), codigo: String(fields.get('codigo')).trim(), hora_salida: fields.get('hora_salida'), fecha: fields.get('fecha'), camion: fields.get('camion'), conductor: routeModal === 'edit' ? editingRoute?.conductor : null };
    if (extended) values.conductor_id = fields.get('conductor_id') || null;
    if (routeModal === 'create') {
      if(advanced && (proposalLoading || !String(fields.get('codigo')).trim())){reportError('Espera a que se proponga el número de ruta.');return;}
      values.borrador = extended && fields.get('estado') === 'Borrador';
      values.retiros = selectedKeys.filter(key => available.some(item => pickupKey(item) === key)).map(key => { const item = requests.get(key)!; return { origen: item.origen, id: item.id }; });
    } else if (editingRoute) Object.assign(values,currentData(editingRoute)); else return;
    const result = await mutate(routeModal === 'create' ? 'crear' : 'cabecera',values);
    if (result.ok) { setRouteModal(null); setSelectedKeys([]); if (result.id) setRouteId(result.id); setFocus(''); }
  }
  async function submitPickup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!pickupModal || !extended || !canManage) return;
    const fields = new FormData(event.currentTarget);
    const lat = fields.get('latitud'), lng = fields.get('longitud');
    if (confirmLocation && !coordinates(lat,lng)) { reportError('Indica latitud y longitud válidas, o deja ambas vacías.'); return; }
    const result = await rpc('flota_despacho_solicitud', { p_origen: pickupModal.origen, p_id: pickupModal.id,
      p_datos: { direccion: fields.get('direccion'), comuna: fields.get('comuna'), region: fields.get('region'), confirmar_ubicacion: confirmLocation, prioridad: fields.get('prioridad'), latitud: lat ? Number(lat) : null, longitud: lng ? Number(lng) : null } });
    if (result.ok) { setFocus(pickupKey(pickupModal)); setPickupModal(null); setCenter(value => value+1); }
  }
  async function photo(path: string) {
    setPhotoBusy(true);
    try { const result = await supabase.storage.from('brax-driver-evidencias').createSignedUrl(path,120);
      if (result.error) throw result.error; setPhotoLinks(current => ({...current,[path]:result.data.signedUrl}));
    } catch { reportError('No se pudo abrir la foto. Comprueba tus permisos.'); } finally { setPhotoBusy(false); }
  }
  const evidence = results.find(item => item.parada_id === evidenceId);
  const tableRowFocus = (key: string) => ({ tabIndex: 0, 'aria-selected': focus === key,
    onClick: () => selectPoint(key), onKeyDown: (event: React.KeyboardEvent) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectPoint(key); } } });

  const routesPanel = <Panel title="Rutas" count={routeList.length} icon={<Truck size={17}/>} hint="Suelta solicitudes sobre una ruta para asignarlas. Desplaza la tabla para ver todas sus columnas.">
    <table className={styles.table} aria-label="Rutas existentes"><thead><tr><th>Ruta / código</th><th>Fecha</th><th>Conductor</th><th>Camión</th><th>Estado</th><th>Paradas</th><th>Distancia¹</th><th>Carga estimada</th></tr></thead>
      <tbody>{routeList.map(item => {
        const info = plan ? routeSummary(plan,item) : undefined;
        return <tr key={item.id} data-route-id={item.id} tabIndex={0} aria-selected={route?.id === item.id}
          className={`${route?.id === item.id ? styles.selected : ''} ${dropRoute === item.id ? styles.dropTarget : ''}`}
          onClick={() => selectRoute(item)} onKeyDown={event => { if (event.key === 'Enter') selectRoute(item); }}
          onDragOver={event => { if (canManage && !busy && editableRoute(item) && event.dataTransfer.types.includes(REQUEST_MIME)) { event.preventDefault(); event.dataTransfer.dropEffect='move'; setDropRoute(item.id); } }}
          onDragLeave={() => setDropRoute('')} onDrop={event => pickupDrop(event,item)}>
          <td><strong className={styles.routeName}>{routeCode(item)}</strong></td><td>{date(item.fecha)}{item.hora_salida && <small>Salida {item.hora_salida.slice(0,5)}</small>}</td><td>{driverLabel(item)}</td><td>{item.camion}</td>
          <td><Badge value={routeState(item)}/></td><td>{info?.stops.length ?? 0}</td><td title="Distancia en línea recta entre paradas; no distancia vial">{info?.distance != null ? `${number(info.distance)} km` : 'Sin datos'}</td>
          <td>{info?.weight != null ? `${number(info.weight)} kg` : 'Sin datos'}</td>
        </tr>;
      })}{!routeList.length && <Empty columns={8}>{loading ? 'Consultando rutas…' : 'Sin rutas para estos filtros. Crea una ruta o limpia los filtros.'}</Empty>}</tbody></table>
  </Panel>;
  const stopsPanel = <Panel title="Sitios / Paradas" count={stops.length} icon={<MapPin size={17}/>} hint={route ? `${route.nombre} · arrastra el asa para cambiar el orden de visita` : 'Selecciona una ruta'}>
    <table className={styles.table} aria-label="Paradas de la ruta"><thead><tr><th>Orden</th><th>Dirección / comuna</th><th>Cliente</th><th>Estado</th><th>Acciones</th></tr></thead>
      <tbody>{stops.map((stop,index) => { const item = requests.get(stopKey(stop)); const key = stopKey(stop);
        return <tr key={stop.id} {...tableRowFocus(key)} data-stop-id={stop.id} className={focus === key ? styles.selected : ''}
          onDragOver={event => { if (canReorder && event.dataTransfer.types.includes(STOP_MIME)) { event.preventDefault(); event.dataTransfer.dropEffect='move'; } }}
          onDrop={event => { if (!event.dataTransfer.types.includes(STOP_MIME)) return; event.preventDefault(); void reorder(event.dataTransfer.getData(STOP_MIME),stop.id); }}>
          <td><span className={styles.orderCell}><button className={styles.dragHandle} draggable={canReorder} disabled={!canReorder} aria-label={`Arrastrar parada ${index+1}`}
            onDragStart={event => { event.dataTransfer.setData(STOP_MIME,stop.id); event.dataTransfer.effectAllowed='move'; }}><GripVertical size={17}/></button>{index+1}</span></td>
          <td>{item?.direccion || 'Dirección pendiente'}<small>{item?.comuna || 'Comuna pendiente'}</small></td><td>{item ? pickupName(item) : 'Solicitud no disponible'}</td><td><Badge value={dispatchStopLabel(stop)}/></td>
          <td><div className={styles.rowActions}><button className={styles.iconButton} disabled={!canReorder || index===0} aria-label={`Subir parada ${index+1}`} onClick={event => { event.stopPropagation(); void reorder(stop.id,stops[index-1].id); }}>↑</button>
            <button className={styles.iconButton} disabled={!canReorder || index===stops.length-1} aria-label={`Bajar parada ${index+1}`} onClick={event => { event.stopPropagation(); void reorder(stop.id,stops[index+1].id); }}>↓</button>
            {item && <button className={styles.iconButton} disabled={!canManage || !extended || busy} aria-label={`Editar ubicación ${pickupCode(item)}`} onClick={event => { event.stopPropagation(); editPickup(item); }}><Pencil size={15}/></button>}</div></td>
        </tr>;
      })}{!stops.length && <Empty columns={5}>Esta ruta no tiene paradas. Asigna solicitudes desde el panel derecho.</Empty>}</tbody></table>
  </Panel>;
  const assignedPanel = <Panel title="Retiros asignados" count={stops.length} icon={<Package size={17}/>} tools={<Link href="/rutas/driver/" className={styles.textLink}>Evidencias y detalle</Link>}>
    <table className={styles.table} aria-label="Retiros asignados"><thead><tr><th>Solicitud</th><th>Cliente / material</th><th>Estimado</th><th>Resultado</th><th>Acciones</th></tr></thead>
      <tbody>{stops.map(stop => { const item = requests.get(stopKey(stop)), result = results.find(value=>value.parada_id===stop.id);
        return <tr key={stop.id} {...tableRowFocus(stopKey(stop))} className={focus === stopKey(stop) ? styles.selected : ''}>
          <td className={styles.code}>{item ? pickupCode(item) : stopKey(stop)}</td><td>{item ? pickupName(item) : 'Solicitud no disponible'}<small>{item?.material || 'Material pendiente'}</small></td>
          <td>{item && pickupWeight(item) != null ? `${number(pickupWeight(item)!)} kg` : 'Sin datos'}</td><td>{result?.kilos_declarados != null ? `${number(result.kilos_declarados)} kg declarados` : dispatchStopLabel(stop)}</td>
          <td><div className={styles.rowActions}>{result && <button className={styles.smallButton} onClick={event=>{event.stopPropagation();setEvidenceId(stop.id);setPhotoLinks({});}}>Ver evidencia</button>}
            <button className={styles.smallButton} disabled={!canEdit || stop.estado==='realizado'} onClick={event => { event.stopPropagation(); if(route) void mutate('quitar',{...currentData(route),parada:stop.id}); }}>Quitar retiro</button></div></td>
        </tr>;
      })}{!stops.length && <Empty columns={5}>Los retiros asignados aparecerán aquí.</Empty>}</tbody></table>
  </Panel>;
  const unassignedPanel = <Panel title="Solicitudes sin asignar" count={filteredAvailable.length} icon={<Package size={17}/>} hint="Arrastra una fila a Rutas, o selecciona solicitudes y pulsa Asignar. Solo se muestran retiros disponibles."
    tools={<button className={styles.smallButton} disabled={!canEdit || !selectedKeys.length} onClick={()=>route && void assign(route,selectedKeys)}>Asignar ({selectedKeys.length})</button>}>
    <table className={styles.table} aria-label="Solicitudes sin asignar"><thead><tr><th>Elegir</th><th>Solicitud</th><th>Cliente</th><th>Dirección</th><th>Comuna</th><th>Material</th><th>Fecha</th><th>Prioridad</th><th>Estado</th><th>Ubicación</th><th>Coordenadas</th><th>Datos</th></tr></thead>
      <tbody>{filteredAvailable.map(item=>{ const key=pickupKey(item), point=plan && pickupCoordinates(item,plan.ubicaciones);
        return <tr key={key} {...tableRowFocus(key)} data-pickup-key={key} draggable={canManage && !busy && !loading} onDragStart={event=>startPickupDrag(event,item)} onDragEnd={()=>setDropRoute('')}
          className={`${focus===key ? styles.selected : ''} ${canManage ? styles.draggable : ''}`}>
          <td><input aria-label={`Seleccionar ${pickupCode(item)}`} type="checkbox" checked={selectedKeys.includes(key)} disabled={!canManage || busy} onClick={event=>event.stopPropagation()}
            onChange={event=>setSelectedKeys(current=>event.target.checked ? [...current,key] : current.filter(value=>value!==key))}/></td>
          <td className={styles.code}>{pickupCode(item)}</td><td>{pickupName(item)}</td><td>{item.direccion || 'Sin dirección'}</td><td>{item.comuna || 'Sin comuna'}</td><td>{item.material || 'Sin material'}</td>
          <td>{date(item.fecha_retiro || item.fecha_solicitud)}</td><td>{item.prioridad || 'Sin definir'}</td><td>{item.estado}</td><td>{plan ? geoStatus(item,plan) : 'Pendiente'}</td><td>{point ? `${point[0].toFixed(5)}, ${point[1].toFixed(5)}` : 'Sin coordenadas'}</td>
          <td><button className={styles.iconButton} disabled={!canManage || !extended || busy} aria-label={`Editar datos ${pickupCode(item)}`} onClick={event=>{event.stopPropagation();editPickup(item);}}><Pencil size={16}/></button></td>
        </tr>;
      })}{!filteredAvailable.length && <Empty columns={12}>{loading ? 'Consultando solicitudes…' : 'No hay solicitudes sin asignar que coincidan con los filtros.'}</Empty>}</tbody></table>
  </Panel>;
  const mapPanel = <section className={styles.panel} aria-label="Seguimiento GPS">
    <div className={styles.panelHeading}><h2><Navigation size={17}/>Mapa y seguimiento<span className={styles.count}>{mapPoints.length} puntos</span></h2>
      <button className={styles.smallButton} onClick={()=>{setFitAll(false);setFocus('');setCenter(value=>value+1);}}><Crosshair size={16}/>Centrar ruta</button></div>
    <div className={styles.liveBar}>{live.length ? live.map(position=><button key={position.key} className={styles.gpsSource} onClick={()=>setFocus(position.key)}>
      <span className={position.online ? styles.online : styles.offline}/>{position.label} · {position.online ? 'En línea' : 'Sin señal reciente'}<small>{new Date(position.timestamp).toLocaleTimeString('es-CL')}</small>
    </button>) : <span>Sin posiciones GPS recibidas para esta ruta. No se simulan ubicaciones.</span>}</div>
    <div className={styles.mapFlex}><DispatchMap points={mapPoints} line={summary?.points ?? []} live={live} focus={focus} centerKey={`${route?.id ?? 'all'}:${center}`} onSelect={selectPoint} fitAll={fitAll} onView={viewPickup} onAssign={key=>route && void assign(route,[key])} canAssign={canEdit}/></div>
    <div className={styles.mapFooter}>{stops.length - (summary?.points.filter(Boolean).length ?? 0)} paradas sin coordenadas · {filteredAvailable.length-mapPoints.filter(point=>point.kind==='unassigned').length} solicitudes sin ubicación</div>
  </section>;

  return <div className={styles.workspace}>
    <header className={styles.header}><div className={styles.brandIcon}><Navigation size={24}/></div><div><p className={styles.eyebrow}>OPERACIÓN DE FLOTA</p><h1>Logística &amp; Rutas</h1></div>
      <div className={styles.headerActions}><span className={styles.connection}><i className={connected ? styles.online : styles.offline}/>{connected ? 'En vivo' : 'Sondeo cada 30 s'}</span>
        <button className={styles.button} disabled={!advanced || busy} onClick={()=>setCatalogKind('conductor')}>Conductores</button><button className={styles.button} disabled={!advanced || busy} onClick={()=>setCatalogKind('camion')}>Camiones</button>
        <button className={styles.button} disabled={busy} onClick={()=>void refresh()}><RefreshCw size={17} className={loading ? styles.spinning : ''}/>Actualizar</button>
        {canManage && <button className={styles.primary} disabled={busy || loading || proposalLoading} onClick={()=>void openCreate()}><Plus size={19}/>Crear ruta</button>}</div>
    </header>
    <div className={styles.filters}><label><span>Fecha</span><input aria-label="Filtrar por fecha" type="date" value={filterDate} onChange={event=>setFilterDate(event.target.value)}/></label>
      <label><span>Estado de ruta</span><select aria-label="Filtrar por estado" value={filterState} onChange={event=>setFilterState(event.target.value)}><option value="">Todos los estados</option>{['Borrador','Programada','En ruta','Finalizada','Cancelada'].map(value=><option key={value}>{value}</option>)}</select></label>
      <label><span>Conductor</span><select aria-label="Filtrar por conductor" value={filterDriver} onChange={event=>setFilterDriver(event.target.value)}><option value="">Todos los conductores</option>{[...new Set((plan?.rutas ?? []).map(item=>item.conductor_id).filter((id): id is string=>!!id))].map(id=><option key={id} value={id}>{driverLabel(plan!.rutas.find(item=>item.conductor_id===id)!)}</option>)}</select></label>
      <label><span>Camión</span><select aria-label="Filtrar por camión" value={filterTruck} onChange={event=>setFilterTruck(event.target.value)}><option value="">Todos los camiones</option>{plan?.camiones.map(item=><option key={item.identificador}>{item.identificador}</option>)}</select></label>
      <label><span>Comuna sin asignar</span><select aria-label="Filtrar por comuna" value={commune} onChange={event=>setCommune(event.target.value)}><option value="">Todas las comunas</option>{communes.map(value=><option key={value}>{value}</option>)}</select></label>
      <label><span>Estado de solicitud</span><select aria-label="Estado de solicitudes" value={pickupState} onChange={event=>setPickupState(event.target.value)}><option value="">Todos</option>{[...new Set(available.map(item=>item.estado).filter((value):value is string=>!!value))].map(value=><option key={value}>{value}</option>)}</select></label>
      <label className={styles.search}><span><Search size={14}/>Buscar solicitud</span><input placeholder="Cliente, solicitud o dirección" value={search} onChange={event=>setSearch(event.target.value)}/></label>
      <button className={styles.textButton} onClick={()=>{setFilterDate('');setFilterState('');setFilterDriver('');setFilterTruck('');setCommune('');setSearch('');setPickupState('');}}>Limpiar</button></div>
    {!extended && !loading && <div className={styles.notice}>Planificación conectada. Para habilitar borradores, catálogo de conductores y edición de direcciones, aplica la migración de despacho de escritorio. <Link href="/rutas/driver/">Abrir despacho compatible</Link></div>}
    <div className={styles.geoToolbar}><button className={styles.button} onClick={()=>{setFitAll(true);setFocus('');setCenter(value=>value+1);}}>Mostrar todas las solicitudes</button>
      {isAdmin && <button className={styles.button} disabled={!advanced || geoBusy || busy} onClick={()=>void geocodePending()}>{geoBusy?'Procesando lote…':'Geocodificar solicitudes pendientes'}</button>}
      {geoReport && <p role="status">{geoReport}</p>}</div>
    {error && <div className={styles.error} role="alert">{error}<button className={styles.textButton} onClick={()=>void refresh()}>Reintentar consulta</button></div>}
    <div className={styles.routeToolbar}><div><span className={styles.routeAccent}/><strong>{route?.nombre || 'Selecciona o crea una ruta'}</strong>{route && <Badge value={routeState(route)}/>}<span>{stops.length} paradas{summary?.weight != null ? ` · ${number(summary.weight)} kg estimados` : ''}</span>{route?.iniciado_en && <span>Inicio {new Date(route.iniciado_en).toLocaleString('es-CL')}</span>}{route?.finalizado_en && <span>Fin {new Date(route.finalizado_en).toLocaleString('es-CL')}</span>}</div>
      <div>{canManage && <>
        <button className={styles.button} disabled={!canEdit || route?.estado!=='Programada'} onClick={editRoute}><Truck size={16}/>Asignar camión</button>
        <button className={styles.button} disabled={!canEdit || route?.estado!=='Programada'} onClick={()=>extended ? editRoute() : route && setAssignRoute({ ...route })}><Users size={16}/>Asignar conductor</button>
        {route?.borrador && <button className={styles.primary} disabled={!canEdit} onClick={()=>void mutate('publicar',currentData(route))}>Programar ruta</button>}
        <button className={styles.button} disabled={!advanced || !canEdit || !route?.puede_eliminar} onClick={()=>route && setDeleteRoute({...route})}>Eliminar ruta vacía</button>
        <span className={styles.muted}>Inicio y cierre desde BraxRecicla Driver</span>
      </>}{!canManage && <span className={styles.muted}>{role==='operador'?'Planificación de operadores pendiente de habilitar en Supabase':'Modo de consulta'}</span>}</div></div>
    <div className={styles.board}><ResizableSplit label="Ancho de planificación y mapa" initial={51}
      first={<ResizableSplit label="Altura de rutas" vertical initial={40} first={routesPanel}
        second={<ResizableSplit label="Altura de paradas y retiros" vertical initial={50} first={stopsPanel} second={assignedPanel}/>}/>}
      second={<ResizableSplit label="Altura de mapa y solicitudes" vertical initial={61} first={mapPanel} second={unassignedPanel}/>}/></div>
    {plan?.geocodificacion?.some(job=>['ambigua','no_encontrada','error','sin_direccion'].includes(job.estado)) && <details className={styles.geoResults}><summary>Solicitudes que necesitan revisión manual</summary><ul className={styles.geoList}>{plan.geocodificacion.filter(job=>['ambigua','no_encontrada','error','sin_direccion'].includes(job.estado)).map(job=>{const item=requests.get(`${job.origen}:${job.solicitud}`);return <li key={job.id}><button className={styles.textButton} onClick={()=>item&&editPickup(item)}>{item?pickupCode(item):job.solicitud} · {item&&geoStatus(item,plan)}{job.error?` · ${job.error}`:''}</button></li>;})}</ul></details>}
    <footer className={styles.footer}><span>¹ Distancia recta entre paradas conocidas. Sin optimización vial.</span><span>{lastUpdated ? `Actualizado ${new Date(lastUpdated).toLocaleTimeString('es-CL')}` : 'Esperando datos'} · <Link href="/rutas/local/">Borradores locales anteriores</Link></span></footer>

    {catalogKind && <Modal title={catalogKind==='conductor'?'Conductores':'Camiones'} close={()=>setCatalogKind(null)} busy={busy} wide>
      <FleetCatalog kind={catalogKind} drivers={drivers} trucks={plan?.camiones||[]} admin={isAdmin} busy={busy} onSave={async(kind,values)=>(await rpc('flota_catalogo_guardar',{p_tipo:kind,p_datos:values})).ok}/>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </Modal>}
    {routeModal && <Modal title={routeModal==='create' ? 'Crear ruta en Supabase' : 'Editar ruta y asignaciones'} close={()=>setRouteModal(null)} busy={busy}>
      <form className={styles.form} onSubmit={event=>void submitRoute(event)}>
        <label>Número de ruta<input name="codigo" aria-label="Número de ruta" required maxLength={120} disabled={proposalLoading} value={routeModal==='create'?proposedCode:undefined} onChange={event=>setProposedCode(event.target.value)} defaultValue={routeModal==='edit'?editingRoute?.codigo||editingRoute?.nombre:undefined} placeholder={proposalLoading?'Obteniendo consecutivo…':'Código de ruta'} autoFocus/></label>
        <div className={styles.formGrid}><label>Fecha<input name="fecha" type="date" required defaultValue={routeModal==='edit' ? editingRoute?.fecha : today()}/></label>
          <label>Camión<select aria-label="Camión" name="camion" required value={routeTruck} onChange={event=>setRouteTruck(event.target.value)}><option value="">Selecciona un camión</option>{plan?.camiones.filter(item=>item.activo!==false||item.identificador===routeTruck).map(item=><option key={item.identificador} disabled={item.activo===false}>{item.identificador}</option>)}</select></label></div>
        <label>Hora de salida programada<input type="time" name="hora_salida" defaultValue={routeModal==='edit'?editingRoute?.hora_salida?.slice(0,5)||'':''}/></label>
        {extended && <label>Conductor<select aria-label="Conductor" name="conductor_id" value={routeDriver} onChange={event=>{setRouteDriver(event.target.value);const driver=drivers.find(item=>item.id===event.target.value);setRouteTruck(driver?.camion_predeterminado||'');}}><option value="">Asignar después</option>
          {routeModal==='edit' && editingRoute?.conductor_id && !drivers.some(driver=>driver.id===editingRoute.conductor_id) && <option value={editingRoute.conductor_id}>{driverLabel(editingRoute)} · cuenta no disponible en catálogo</option>}
          {drivers.map(driver=><option key={driver.id} value={driver.id} disabled={driver.activo===false||driver.habilitado===false}>{driver.nombre}{driver.activo===false?' · Inactivo':''}</option>)}</select></label>}
        {routeModal==='create' && <label>Estado inicial<select aria-label="Estado inicial" name="estado" defaultValue="Programada"><option>Programada</option>{extended && <option>Borrador</option>}</select></label>}
        {plan?.rutas.some(item=>item.id!==editingRoute?.id&&item.camion===routeTruck&&item.estado==='En ruta')&&<p className={styles.capacityWarning}>Este camión tiene otra ruta activa. Confirma la fecha de salida; no se permite un conflicto activo en la misma fecha.</p>}
        <p className={styles.muted}>{routeModal==='create' ? `${selectedKeys.filter(key=>available.some(item=>pickupKey(item)===key)).length} solicitudes seleccionadas se agregarán a la ruta.` : 'El camión y el conductor se guardan en la ruta real de Supabase.'}</p>
        {!plan?.camiones.length && <p role="alert">No hay camiones registrados. Registra la flota antes de crear una ruta.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.formActions}><button type="button" className={styles.button} disabled={busy} onClick={()=>setRouteModal(null)}>Cancelar</button><button className={styles.primary} disabled={busy || proposalLoading || !plan?.camiones.length}>{busy ? 'Guardando…' : 'Guardar ruta'}</button></div>
      </form></Modal>}
    {assignRoute && <Modal title="Asignar conductor" close={()=>setAssignRoute(null)} busy={busy}><form className={styles.form} onSubmit={async event=>{
      event.preventDefault(); const id=String(new FormData(event.currentTarget).get('conductor')).trim();
      const result=await rpc('brax_driver_asignar',{p_ruta:assignRoute.id,p_version:assignRoute.actualizado_en,p_conductor:id});if(result.ok)setAssignRoute(null);
    }}><label>UUID del conductor en Supabase Auth<input name="conductor" required pattern="[0-9a-fA-F-]{36}" defaultValue={assignRoute.conductor_id ?? ''}/></label><p className={styles.muted}>La cuenta debe estar autorizada como conductor. El catálogo por nombre requiere la migración nueva.</p>{error && <p role="alert">{error}</p>}<button className={styles.primary} disabled={busy}>Guardar conductor</button></form></Modal>}
    {pickupModal && <Modal title={`Datos de retiro · ${pickupCode(pickupModal)}`} close={()=>setPickupModal(null)} busy={busy}><form className={styles.form} onSubmit={event=>void submitPickup(event)}>
      <label>Dirección<input name="direccion" defaultValue={pickupModal.direccion ?? ''}/></label><div className={styles.formGrid}><label>Comuna<input name="comuna" defaultValue={pickupModal.comuna ?? ''}/></label><label>Región<input name="region" defaultValue={pickupModal.region ?? ''}/></label><label>Prioridad<select name="prioridad" defaultValue={pickupModal.prioridad ?? ''}><option value="">Sin definir</option>{['baja','normal','alta','urgente'].map(value=><option key={value}>{value}</option>)}</select></label></div>
      <div className={styles.formGrid}><label>Latitud<input name="latitud" type="number" min={-90} max={90} step="any" value={pickerCoords.lat} onChange={event=>{setPickerCoords(current=>({...current,lat:event.target.value}));setConfirmLocation(false);}}/></label>
        <label>Longitud<input name="longitud" type="number" min={-180} max={180} step="any" value={pickerCoords.lng} onChange={event=>{setPickerCoords(current=>({...current,lng:event.target.value}));setConfirmLocation(false);}}/></label></div>
      <p className={styles.muted}>{plan ? geoStatus(pickupModal,plan) : ''}</p>
      <div className={styles.picker}><DispatchMap points={coordinates(pickerCoords.lat,pickerCoords.lng)?[{key:'pick',label:'Ubicación por confirmar',detail:'Arrastra o selecciona el punto exacto',latitud:Number(pickerCoords.lat),longitud:Number(pickerCoords.lng),kind:'unassigned'}]:[]} line={[]} live={[]} focus="pick" centerKey={`${pickupKey(pickupModal)}:${pickerVersion}`} onSelect={()=>{}} onPick={pickPosition}/></div>
      {plan?.geocodificacion?.find(job=>job.origen===pickupModal.origen&&job.solicitud===pickupModal.id)?.resultado?.candidatos?.map((candidate,index)=><button type="button" key={index} className={styles.smallButton} onClick={()=>pickPosition(candidate.latitud,candidate.longitud)}>Revisar candidato · {candidate.direccion}</button>)}
      <label className={styles.checkLabel}><input type="checkbox" checked={confirmLocation} disabled={!coordinates(pickerCoords.lat,pickerCoords.lng)} onChange={event=>setConfirmLocation(event.target.checked)}/>Confirmo que el marcador corresponde a la ubicación exacta del retiro</label>
      <p className={styles.muted}>Cambiar la dirección no inventa coordenadas. Solo se guardará una nueva ubicación confirmada si marcas esta casilla.</p>{error && <p className={styles.error} role="alert">{error}</p>}<button className={styles.primary} disabled={busy}>Guardar datos de retiro</button>
    </form></Modal>}
    {deleteRoute && <Modal title="Eliminar ruta vacía" close={()=>setDeleteRoute(null)} busy={busy}><div className={styles.form}><p>¿Estás seguro de que deseas eliminar la ruta {routeCode(deleteRoute)}? Esta acción no se puede deshacer. El registro de auditoría y su código se conservan.</p>{error && <p role="alert">{error}</p>}<button className={styles.primary} disabled={busy} onClick={async()=>{if((await mutate('eliminar_vacia',currentData(deleteRoute))).ok)setDeleteRoute(null);}}>Eliminar ruta</button></div></Modal>}
    {evidenceId && <Modal title="Evidencia de retiro" close={()=>setEvidenceId('')} busy={photoBusy}><div className={styles.form}>
      {evidence ? <><p>{evidence.material || 'Material sin declarar'} · {evidence.kilos_declarados != null ? `${number(evidence.kilos_declarados)} kg declarados` : 'Sin peso declarado'}</p><p>{evidence.observaciones}</p>
        {evidence.firma && <div><p>{evidence.firma_archivo ? 'Firma de quien entrega' : 'Firma registrada anteriormente'} · {evidence.firma.nombre}</p><svg aria-label="Firma registrada de la entrega" role="img" viewBox="0 0 1000 1000" preserveAspectRatio="none" className={styles.signature}>{evidence.firma.trazos.map((path,index)=><polyline key={index} points={path.map(p=>`${p.x},${p.y}`).join(' ')} stroke="#0f172a" strokeWidth="8" fill="none"/>)}</svg></div>}
        {evidence.firma_archivo && <div><p className={styles.muted}>Confirmada en dispositivo · {evidence.firma_confirmada_en ? new Date(evidence.firma_confirmada_en).toLocaleString('es-CL') : 'Sin fecha'}</p>
          <p className={styles.muted}>Registrada en Supabase · {evidence.registrado_en ? new Date(evidence.registrado_en).toLocaleString('es-CL') : 'Sin fecha'}</p>
          <button className={styles.button} disabled={photoBusy} onClick={()=>void photo(evidence.firma_archivo!)}>Habilitar archivo de firma</button>
          {photoLinks[evidence.firma_archivo] && <a className={styles.textLink} href={photoLinks[evidence.firma_archivo]} target="_blank" rel="noreferrer">Abrir firma (trazos JSON)</a>}</div>}
        <p className={styles.muted}>Tipo de peso · {evidence.tipo_peso || 'Declarado (registro anterior)'}; no reemplaza la báscula.</p>
        {evidence.fotos.map((path,index)=><div key={path}><button className={styles.button} disabled={photoBusy} onClick={()=>void photo(path)}>Habilitar foto {index+1}</button>{photoLinks[path] && <a className={styles.textLink} href={photoLinks[path]} target="_blank" rel="noreferrer">Abrir foto {index+1}</a>}</div>)}</> : <p>No hay evidencia disponible para este retiro.</p>}
    </div></Modal>}
  </div>;
}
