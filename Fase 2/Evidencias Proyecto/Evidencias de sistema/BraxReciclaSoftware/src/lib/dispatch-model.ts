export type DispatchRoute = {
  id: string; nombre: string; codigo?: string; hora_salida?: string | null; puede_eliminar?: boolean; fecha: string; camion: string; conductor?: string | null;
  conductor_id: string | null; estado: string; actualizado_en: string; borrador?: boolean; iniciado_en?: string | null; finalizado_en?: string | null;
};
export type DispatchStop = {
  id: string; ruta_id: string; orden: number; estado: string; activa: boolean;
  solicitud_b2b: string | null; solicitud_b2c: string | null; motivo?: string | null; fase_conductor?: 'en_camino' | 'llegada' | 'retiro' | null;
  en_camino_en?: string | null; llegada_en?: string | null; retiro_iniciado_en?: string | null; resuelto_en?: string | null;
};
export type Pickup = {
  id: string; origen: 'B2B' | 'B2C'; estado: string | null; numero_solicitud?: string;
  razon_social?: string | null; nombre?: string | null; direccion?: string | null;
  comuna?: string | null; region?: string | null; material?: string | null; fecha_solicitud?: string | null;
  fecha_retiro?: string | null; prioridad?: string | null; volumen_toneladas?: number | null;
  kilos_estimados?: number | null; latitud?: number | null; longitud?: number | null;
};
export type SiteLocation = { solicitud_b2b: string | null; solicitud_b2c: string | null; latitud: number; longitud: number; estado?: 'confirmada'|'revision'; fuente?: string; confirmada_manualmente?: boolean };
export type Telemetry = { patente_camion: string; latitud: number | null; longitud: number | null; timestamp: string; fuente_ubicacion?: string | null };
export type PhonePosition = { ruta_id: string; conductor_id?: string; latitud: number; longitud: number; actualizado_en: string };
export type LivePosition = { key: string; source: 'phone' | 'esp32'; label: string; latitud: number; longitud: number; timestamp: string; online: boolean };
export type Driver = { id: string; nombre: string; codigo?: string; email?: string | null; telefono?: string | null; camion_predeterminado?: string | null; activo?: boolean; habilitado?: boolean };
export type FleetTruck = { identificador: string; patente?: string | null; tipo_vehiculo?: string | null; capacidad_kg?: number | null; conductor_predeterminado?: string | null; activo?: boolean; fuente_gps?: 'phone'|'esp32'|null; gps_identificador?: string|null };
export type GeoJob = { id: string; origen: 'B2B'|'B2C'; solicitud: string; estado: string; intentos: number; error?: string | null; resultado?: { candidatos?: { latitud:number; longitud:number; direccion:string; confianza:number }[] } | null };
export type DispatchPlan = {
  rutas: DispatchRoute[]; paradas: DispatchStop[]; solicitudes: Pickup[];
  camiones: FleetTruck[]; capacidades?: { planificacion: number }; geocodificacion?: GeoJob[]; ubicaciones: SiteLocation[]; telemetria: Telemetry[];
};
export type DriverResult = {
  parada_id: string; material: string | null; kilos_declarados: number | null;
  observaciones: string | null; fotos: string[]; firma_archivo?: string | null; firma_confirmada_en?: string | null; registrado_en?: string; tipo_peso?: 'estimado' | 'medido' | null;
  firma: { nombre: string; trazos: { x: number; y: number }[][] } | null;
};
export type MapPoint = { key: string; label: string; detail: string; latitud: number; longitud: number; order?: number; kind: 'assigned' | 'unassigned'; pickup?: Pickup };
export const pickupKey = (item: Pickup) => `${item.origen}:${item.id}`;
export const stopKey = (stop: DispatchStop) => stop.solicitud_b2b ? `B2B:${stop.solicitud_b2b}` : `B2C:${stop.solicitud_b2c}`;
export const pickupName = (item: Pickup) => item.razon_social || item.nombre || 'Cliente sin nombre';
export const pickupCode = (item: Pickup) => item.numero_solicitud || `${item.origen}-${item.id.slice(0, 8).toUpperCase()}`;
export const routeState = (route: DispatchRoute) => route.borrador ? 'Borrador' : route.estado;
export const editableRoute = (route?: DispatchRoute) => !!route && ['Programada', 'En ruta'].includes(route.estado);
export function pickupWeight(item: Pickup): number | null {
  const value = item.origen === 'B2B'
    ? item.volumen_toneladas == null ? null : Number(item.volumen_toneladas) * 1000
    : item.kilos_estimados == null ? null : Number(item.kilos_estimados);
  return value != null && Number.isFinite(value) && value >= 0 ? value : null;
}
export function coordinates(lat: unknown, lng: unknown): [number, number] | null {
  if (lat == null || lng == null || lat === '' || lng === '') return null;
  const a = Number(lat), b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0) ? [a, b] : null;
}
export function pickupCoordinates(item: Pickup, locations: SiteLocation[]): [number, number] | null {
  const saved = locations.find(location => item.origen === 'B2B' ? location.solicitud_b2b === item.id : location.solicitud_b2c === item.id);
  if (saved?.estado === 'revision') return null;
  return (saved && coordinates(saved.latitud,saved.longitud)) || coordinates(item.latitud,item.longitud);
}
export function availablePickups(plan: DispatchPlan): Pickup[] {
  const booked = new Set(plan.paradas.filter(stop => stop.activa).map(stopKey));
  return plan.solicitudes.filter(item => ['pendiente', 'aprobado', 'aprobada', 'en ruta'].includes(item.estado?.trim().toLowerCase() ?? '') && !booked.has(pickupKey(item)));
}
export const orderedStops = (plan: DispatchPlan, routeId: string) => plan.paradas
  .filter(stop => stop.ruta_id === routeId && stop.activa).sort((a, b) => a.orden - b.orden);
export function routeSummary(plan: DispatchPlan, route: DispatchRoute) {
  const stops = orderedStops(plan, route.id);
  const requests = new Map(plan.solicitudes.map(item => [pickupKey(item), item]));
  const items = stops.map(stop => requests.get(stopKey(stop)));
  const weights = items.map(item => item ? pickupWeight(item) : null);
  const points = items.map(item => item ? pickupCoordinates(item, plan.ubicaciones) : null);
  let distance = 0;
  if (points.length >= 2 && points.every(point => point !== null)) {
    for (let i = 1; i < points.length; i++) {
      const [lat1, lon1] = points[i - 1]!; const [lat2, lon2] = points[i]!;
      const rad = Math.PI / 180;
      const a = Math.sin((lat2-lat1)*rad/2)**2 + Math.cos(lat1*rad)*Math.cos(lat2*rad)*Math.sin((lon2-lon1)*rad/2)**2;
      distance += 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
    }
  }
  return { stops, points, weight: weights.every(value => value !== null) && weights.length ? weights.reduce<number>((sum, n) => sum + (n ?? 0), 0) : null,
    distance: points.length >= 2 && points.every(point => point !== null) ? distance : null };
}
export function livePositions(plan: DispatchPlan, route: DispatchRoute | undefined, phones: PhonePosition[], now: number): LivePosition[] {
  if (!route) return [];
  const positions: LivePosition[] = [];
  const phone = phones.find(item => item.ruta_id === route.id && item.conductor_id === route.conductor_id);
  const add = (source: LivePosition['source'], label: string, lat: unknown, lng: unknown, timestamp: string) => {
    const point = coordinates(lat, lng), time = Date.parse(timestamp);
    if (!point || !Number.isFinite(time)) return;
    positions.push({ key: `${source}:${route.id}`, source, label, latitud: point[0], longitud: point[1], timestamp,
      online: time <= now + 60000 && now - time <= 120000 && route.estado === 'En ruta' });
  };
  if (phone) add('phone', 'Driver · teléfono', phone.latitud, phone.longitud, phone.actualizado_en);
  const truck=plan.camiones.find(item=>item.identificador===route.camion);
  const identifiers=truck?.gps_identificador ? [truck.gps_identificador] : [route.camion,truck?.patente].filter(Boolean);
  const telemetry = plan.telemetria.filter(item => identifiers.includes(item.patente_camion) && item.fuente_ubicacion === 'gps')
    .sort((a,b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
  if (telemetry) add('esp32', `ESP32 · ${route.camion}`, telemetry.latitud, telemetry.longitud, telemetry.timestamp);
  return positions;
}
export function reorderStops(stops: DispatchStop[], draggedId: string, targetId: string): string[] | null {
  const order = stops.map(stop => stop.id), from = order.indexOf(draggedId), to = order.indexOf(targetId);
  if (from < 0 || to < 0 || from === to) return null;
  order.splice(to, 0, order.splice(from, 1)[0]);
  return order;
}

export function pickupDay(item: Pickup): string | null {
  const value = item.fecha_retiro || item.fecha_solicitud;
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago' }).format(parsed) : null;
}

export const dispatchStopLabel = (stop: DispatchStop): string => stop.estado === 'en curso' && stop.fase_conductor
  ? ({ en_camino: 'En camino', llegada: 'He llegado', retiro: 'Retiro en proceso' }[stop.fase_conductor])
  : stop.estado;

export function geoStatus(item: Pickup, plan: DispatchPlan): string {
  if (pickupCoordinates(item,plan.ubicaciones)) return 'Ubicación confirmada';
  if (!item.direccion?.trim()) return 'Sin dirección';
  const job=plan.geocodificacion?.find(job=>job.origen===item.origen && job.solicitud===item.id);
  return ({sin_direccion:'Sin dirección',no_encontrada:'Ubicación no encontrada',ambigua:'Ubicación ambigua',error:'Error de geocodificación',confirmada:'Ubicación pendiente de revisión'} as Record<string,string>)[job?.estado ?? ''] || 'Pendiente de geocodificación';
}
export const routeCode = (route: DispatchRoute) => route.codigo || route.nombre;
