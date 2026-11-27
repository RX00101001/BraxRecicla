'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { canManageDispatch, getErpAccess, type ErpRole } from '@/lib/erp-access';
import { dispatchStopLabel } from '@/lib/dispatch-model';
import { watchErpChanges } from '@/lib/erp-realtime';
import { supabase } from '@/lib/supabase';

type Route = { id: string; nombre: string; camion: string; fecha: string; estado: string; actualizado_en: string; conductor_id: string | null };
type Stop = { id: string; ruta_id: string; orden: number; estado: string; activa: boolean; motivo: string | null; fase_conductor?: 'en_camino' | 'llegada' | 'retiro' | null; solicitud_b2b: string | null; solicitud_b2c: string | null };
type Request = { id: string; origen: 'B2B' | 'B2C'; estado: string | null; razon_social?: string; nombre?: string; material?: string };
type Plan = { solicitudes: Request[]; rutas: Route[]; paradas: Stop[]; camiones: { identificador: string }[] };
type Result = { parada_id: string; material: string | null; kilos_declarados: number | null; observaciones: string | null; fotos: string[]; firma_archivo?: string | null; firma_confirmada_en?: string | null; registrado_en?: string; firma: { nombre: string; trazos: { x: number; y: number }[][] } | null };
type Position = { ruta_id: string; latitud: number; longitud: number; actualizado_en: string };
const control = 'rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white';
const action = 'rounded-lg bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-50';

export default function DispatchPanel({ embedded = false }: { embedded?: boolean }) {
  const [plan, setPlan] = useState<Plan>();
  const [results, setResults] = useState<Result[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [role, setRole] = useState<ErpRole | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const pendingMutation = useRef(false);
  const request = useRef(0);
  const [links, setLinks] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const version = ++request.current;
    setLoading(true);
    setError('');
    try {
      const access = await getErpAccess();
      if (version !== request.current) return;
      if (!access) { window.location.replace('/'); return; }
      if (access.role === 'chofer') { window.location.replace('/rutas/'); return; }
      setRole(access.role);
      const [routes, evidence, gps] = await Promise.all([
        supabase.rpc('flota_plan_snapshot'),
        supabase.from('flota_resultados_conductor').select('*'),
        supabase.from('flota_gps_conductor').select('ruta_id,latitud,longitud,actualizado_en'),
      ]);
      if (version !== request.current) return;
      if (routes.error) throw routes.error;
      setPlan(routes.data as Plan);
      if (evidence.error || gps.error) setError('No se pudieron consultar las evidencias o la ubicación de Driver.');
      setResults((evidence.data ?? []) as Result[]);
      setPositions((gps.data ?? []) as Position[]);
    } catch (err) {
      if (version !== request.current) return;
      setError(typeof err === 'object' && err && 'message' in err ? String(err.message) : 'No se pudo consultar la flota.');
      setPlan(undefined);
      setResults([]);
      setPositions([]);
      setLinks({});
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => { ++request.current; };
  }, [refresh]);

  useEffect(() => {
    if (!role) return;
    const update = () => { if (!pendingMutation.current) void refresh(); };
    const stop = watchErpChanges('despacho', ['solicitudes_b2b', 'solicitudes_b2c', 'flota_camiones', 'flota_rutas', 'flota_paradas', 'flota_resultados_conductor', 'flota_gps_conductor'], update, () => {});
    const timer = setInterval(update, 30000);
    return () => { clearInterval(timer); stop(); };
  }, [role, refresh]);

  const canManage = canManageDispatch(role);
  const booked = new Set(plan?.paradas.filter(stop => stop.activa).flatMap(stop => [
    stop.solicitud_b2b ? 'B2B:' + stop.solicitud_b2b : 'B2C:' + stop.solicitud_b2c,
  ]));
  const available = (plan?.solicitudes ?? []).filter(item =>
    ['pendiente', 'aprobado', 'aprobada', 'en ruta'].includes(item.estado?.toLowerCase() ?? '')
    && !booked.has(item.origen + ':' + item.id));
  const requestByKey = new Map(available.map(item => [item.origen + ':' + item.id, item]));
  const describeRequest = (item: Request) => [item.origen, item.razon_social || item.nombre || item.id, item.material].filter(Boolean).join(' · ');


  async function mutate(rpc: string, args: Record<string, unknown>) {
    if (!canManage || pendingMutation.current) return false;
    pendingMutation.current = true;
    setBusy(true);
    setError('');
    try {
      const { error: failure } = await supabase.rpc(rpc, args);
      if (failure) throw failure;
      await refresh();
      return true;
    } catch (err) {
      setError(typeof err === 'object' && err && 'message' in err ? String(err.message) : 'No se pudo actualizar la flota.');
      return false;
    } finally {
      pendingMutation.current = false;
      setBusy(false);
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (!selected.length || selected.some(key => !requestByKey.has(key))) {
      setError('Selecciona solicitudes disponibles antes de crear la ruta.');
      return;
    }
    if (await mutate('flota_plan_mutar', { p_accion: 'crear', p_datos: {
      nombre: fields.get('nombre'), camion: fields.get('camion'), fecha: fields.get('fecha'),
      retiros: selected.map(key => ({ origen: key.slice(0, 3), id: key.slice(4) })),
    } })) {
      setSelected([]);
      form.reset();
    }
  }

  async function photo(path: string) {
    const { data, error: failure } = await supabase.storage.from('brax-driver-evidencias').createSignedUrl(path, 120);
    if (failure) setError(failure.message);
    else setLinks(current => ({ ...current, [path]: data.signedUrl }));
  }

  return <section className="mx-auto w-full max-w-5xl space-y-6 p-6">
    {!embedded && <Link href="/rutas/" className="text-emerald-400 underline">Volver a planificación</Link>}
    <header className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-3xl font-bold">Despacho BraxRecicla Driver</h1>
      <button className={action} disabled={busy || loading} onClick={() => void refresh()}>Actualizar</button>
    </header>
    {loading && <p role="status">Consultando Supabase…</p>}
    {error && <p role="alert" className="rounded bg-red-950 p-3 text-red-100">{error}</p>}
    {plan && <>
      {canManage && <form onSubmit={event => void create(event)} className="grid gap-3 rounded-xl border border-slate-600 p-4 sm:grid-cols-2">
        <h2 className="text-xl font-semibold sm:col-span-2">Crear ruta en Supabase</h2>
        <label className="grid gap-1">Nombre<input className={control} name="nombre" required /></label>
        <label className="grid gap-1">Camión<select className={control} name="camion" required>
          <option value="">Selecciona un camión</option>
          {plan.camiones.map(camion => <option key={camion.identificador}>{camion.identificador}</option>)}
        </select></label>
        <label className="grid gap-1">Fecha<input className={control} name="fecha" type="date" required /></label>
        <label className="grid gap-1">Solicitudes disponibles
          <select className={control} value="" disabled={busy} onChange={event => {
            const key = event.target.value;
            if (key) setSelected(current => current.includes(key) ? current : [...current, key]);
          }}>
            <option value="">{available.length ? 'Añadir retiro a la ruta' : 'Sin retiros disponibles'}</option>
            {available.filter(item => !selected.includes(item.origen + ':' + item.id)).map(item => (
              <option key={item.origen + ':' + item.id} value={item.origen + ':' + item.id}>{describeRequest(item)}</option>
            ))}
          </select>
        </label>
        {!!selected.length && <ol className="grid gap-2 sm:col-span-2" aria-label="Orden de visita">
          {selected.map((key, index) => {
            const item = requestByKey.get(key);
            return <li className="flex items-center justify-between gap-2" key={key}>
              <span>{index + 1}. {item ? describeRequest(item) : key + ' · Ya no disponible'}</span>
              <button type="button" disabled={busy} className="text-emerald-400 underline"
                onClick={() => setSelected(current => current.filter(value => value !== key))}>Quitar</button>
            </li>;
          })}
        </ol>}
        <button className={action} disabled={busy || loading || !selected.length || !plan.camiones.length}>Crear ruta</button>
      </form>}
      {!canManage && <p className="text-slate-400">Despacho en modo de consulta.</p>}
      {!plan.camiones.length && <p className="text-slate-400">Aún no hay camiones registrados en Supabase.</p>}
      {plan.rutas.length === 0 && <p>Aún no hay rutas persistidas.</p>}
      {plan.rutas.map(route => {
        const gps = positions.find(position => position.ruta_id === route.id);
        const stops = plan.paradas.filter(stop => stop.ruta_id === route.id && stop.activa);
        const canFinish = stops.length > 0 && stops.every(stop => ['realizado', 'no realizado'].includes(stop.estado));
        const transition = (estado: string) => void mutate('flota_plan_mutar', {
          p_accion: 'estado_ruta', p_datos: { ruta: route.id, version: route.actualizado_en, estado },
        });
        return <section key={route.id} className="space-y-4 rounded-xl border border-slate-600 p-4">
          <h2 className="text-xl font-semibold">{route.nombre}</h2>
          <p>{route.fecha} · {route.camion} · {route.estado}</p>
          {route.estado === 'En ruta' && gps && <p>
            Última ubicación · {new Date(gps.actualizado_en).toLocaleString('es-CL')} ·{' '}
            <a className="text-emerald-400 underline" target="_blank" rel="noreferrer"
              href={'https://www.google.com/maps/search/?api=1&query=' + gps.latitud + ',' + gps.longitud}>Abrir mapa</a>
          </p>}
          {canManage && route.estado === 'Programada' && <form className="flex flex-wrap items-end gap-3"
            onSubmit={event => {
              event.preventDefault();
              void mutate('brax_driver_asignar', { p_ruta: route.id, p_version: route.actualizado_en,
                p_conductor: String(new FormData(event.currentTarget).get('conductor')).trim() });
            }}>
            <label className="grid gap-1">UUID de Supabase Auth del conductor
              <input key={route.conductor_id} className={control} name="conductor" defaultValue={route.conductor_id ?? ''} required pattern="[0-9a-fA-F-]{36}" /></label>
            <button className={action} disabled={busy || loading}>Asignar conductor</button>
            <button type="button" className={action} disabled={busy || loading || !route.conductor_id} onClick={() => transition('En ruta')}>Iniciar ruta</button>
          </form>}
          {canManage && route.estado === 'En ruta' && canFinish && <button className={action} disabled={busy || loading} onClick={() => transition('Finalizada')}>Finalizar ruta</button>}
          <ol className="space-y-3">
            {stops.map(stop => {
              const result = results.find(item => item.parada_id === stop.id);
              return <li key={stop.id} className="space-y-2 border-t border-slate-600 pt-3">
                <p>Parada {stop.orden} · {dispatchStopLabel(stop)} · {stop.solicitud_b2b ?? stop.solicitud_b2c}</p>
                {canManage && ['Programada', 'En ruta'].includes(route.estado) && stop.estado !== 'realizado' && <details>
                  <summary>Coordenadas de la parada</summary>
                  <form className="my-2 flex flex-wrap items-end gap-2" onSubmit={event => {
                    event.preventDefault();
                    const fields = new FormData(event.currentTarget);
                    void mutate('flota_plan_mutar', { p_accion: 'ubicacion', p_datos: {
                      ruta: route.id, version: route.actualizado_en, parada: stop.id,
                      latitud: fields.get('latitud'), longitud: fields.get('longitud'),
                    } });
                  }}>
                    <label className="grid gap-1">Latitud<input className={control} name="latitud" type="number" min="-90" max="90" step="any" required /></label>
                    <label className="grid gap-1">Longitud<input className={control} name="longitud" type="number" min="-180" max="180" step="any" required /></label>
                    <button className={action} disabled={busy || loading}>Guardar coordenadas</button>
                  </form>
                </details>}
                {stop.motivo && <p>Motivo · {stop.motivo}</p>}
                {result?.kilos_declarados != null && <p>{result.material} · {result.kilos_declarados} kg declarados</p>}
                {result?.observaciones && <p>{result.observaciones}</p>}
                {result?.firma && <details>
                  <summary>{result.firma_archivo ? 'Firma de quien entrega' : 'Firma registrada anteriormente'} · {result.firma.nombre}</summary>
                  <svg aria-label="Firma registrada de la entrega" role="img" viewBox="0 0 1000 1000" preserveAspectRatio="none"
                    className="mt-2 h-24 w-52 rounded bg-white">
                    {result.firma.trazos.map((path,i) => <polyline key={i}
                      points={path.map(p => p.x + ',' + p.y).join(' ')} stroke="#0f172a" strokeWidth="8" fill="none" />)}
                  </svg>
                </details>}
                {result?.firma_archivo && <div><p>Firma confirmada · {result.firma_confirmada_en ? new Date(result.firma_confirmada_en).toLocaleString('es-CL') : 'Sin fecha'}</p>
                  <button type="button" className={action} onClick={()=>void photo(result.firma_archivo!)}>Habilitar archivo de firma</button>
                  {links[result.firma_archivo] && <a href={links[result.firma_archivo]} target="_blank" rel="noreferrer" className="text-emerald-400 underline">Abrir firma (trazos JSON)</a>}</div>}
                {result?.fotos.map((path,index) => <div key={path} className="flex flex-wrap gap-2">
                  <button type="button" className={action} onClick={() => void photo(path)}>Habilitar foto {index + 1}</button>
                  {links[path] && <a href={links[path]} target="_blank" rel="noreferrer" className="self-center text-emerald-400 underline">Abrir foto {index + 1}</a>}
                </div>)}
              </li>;
            })}
          </ol>
        </section>;
      })}
    </>}
  </section>;
}
