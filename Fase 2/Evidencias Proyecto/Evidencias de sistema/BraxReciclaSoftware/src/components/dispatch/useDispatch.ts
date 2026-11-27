'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { watchErpChanges } from '@/lib/erp-realtime';
import type { DispatchPlan, Driver, DriverResult, PhonePosition } from '@/lib/dispatch-model';

const failureMessage = (error: unknown) => error && typeof error === 'object' && 'message' in error ? String(error.message) : 'No se pudo completar la operación.';
export function useDispatch() {
  const [plan, setPlan] = useState<DispatchPlan>();
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [results, setResults] = useState<DriverResult[]>([]);
  const [phones, setPhones] = useState<PhonePosition[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const [extended, setExtended] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>();
  const alive = useRef(false), running = useRef(false), pending = useRef(false), mutation = useRef(false);
  const generation = useRef(0);

  const refresh = useCallback(async function refreshData() {
    if (!alive.current) return;
    if (running.current) { pending.current = true; return; }
    running.current = true;
    const version = generation.current;
    try {
      const [snapshot, catalog, evidence, gps] = await Promise.all([
        supabase.rpc('flota_plan_snapshot'), supabase.rpc('flota_despacho_catalogo'),
        supabase.from('flota_resultados_conductor').select('*'),
        supabase.from('flota_gps_conductor').select('ruta_id,conductor_id,latitud,longitud,actualizado_en'),
      ]);
      if (!alive.current || version !== generation.current) return;
      if (snapshot.error) throw snapshot.error;
      const data = snapshot.data as DispatchPlan;
      if (!data || !Array.isArray(data.rutas) || !Array.isArray(data.paradas) || !Array.isArray(data.solicitudes)) throw new Error('Supabase devolvió un plan de flota inválido.');
      setPlan({ ...data, camiones: catalog.data?.camiones ?? data.camiones ?? [], ubicaciones: data.ubicaciones ?? [], telemetria: data.telemetria ?? [] });
      setExtended(!catalog.error && catalog.data?.version >= 1);
      setAdvanced(!catalog.error && catalog.data?.version >= 2 && data.capacidades?.planificacion === 2);
      setDrivers(catalog.error ? [] : catalog.data?.conductores ?? []);
      setResults(evidence.data ?? []); setPhones(gps.data ?? []);
      const warnings = [evidence.error && 'No se pudieron consultar las evidencias.', gps.error && 'No se pudo consultar el GPS de Driver.',
        catalog.error && !['PGRST202','42883'].includes(catalog.error.code) && 'No se pudo consultar el catálogo de conductores.'].filter(Boolean);
      setError(warnings.join(' '));
      setLastUpdated(new Date().toISOString());
    } catch (error) {
      if (alive.current && version === generation.current) setError(failureMessage(error));
    } finally {
      running.current = false;
      if (alive.current) {
        if (version === generation.current) setLoading(false);
        if (pending.current) { pending.current = false; void refreshData(); }
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const bumpGeneration = () => { generation.current++; };
    const update = () => { if (mutation.current) pending.current = true; else void refresh(); };
    const stop = watchErpChanges('dispatch-workspace', ['solicitudes_b2b', 'solicitudes_b2c', 'flota_camiones', 'flota_conductores', 'flota_geo_trabajos', 'flota_rutas', 'flota_paradas', 'flota_ubicaciones', 'flota_gps_conductor', 'flota_resultados_conductor', 'telemetria_flota'], update, setConnected);
    const initialRead = setTimeout(update, 0);
    const timer = setInterval(update, 30000);
    return () => { alive.current = false; bumpGeneration(); clearTimeout(initialRead); clearInterval(timer); stop(); };
  }, [refresh]);

  const rpc = async (name: string, args: Record<string, unknown>): Promise<{ ok: boolean; id?: string }> => {
    if (mutation.current || !alive.current) return { ok: false };
    mutation.current = true; setBusy(true); setError('');
    // Discard a read that started before the write; refresh only after commit.
    generation.current++;
    try {
      const result = await supabase.rpc(name, args);
      if (result.error) throw result.error;
      if (alive.current) {
        await refresh();
        return { ok: true, id: typeof result.data === 'string' ? result.data : undefined };
      }
      return { ok: false };
    } catch (error) {
      if (alive.current) { setError(failureMessage(error)); pending.current = false; }
      return { ok: false };
    } finally {
      mutation.current = false;
      if (alive.current) { setBusy(false); if (pending.current) { pending.current = false; void refresh(); } }
    }
  };
  const mutate = (action: string, data: Record<string, unknown>) => rpc(extended ? 'flota_despacho_mutar' : 'flota_plan_mutar', {
    p_accion: action === 'cabecera' && !extended ? 'editar' : action, p_datos: data,
  });
  return { plan, drivers, results, phones, extended, advanced, loading, busy, error, connected, lastUpdated,
    refresh, rpc, mutate, reportError: setError };
}
