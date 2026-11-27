'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import BraxSidebar from '@/components/BraxSidebar';
import { 
  Scale, Save, Search, ShieldCheck, Truck, AlertCircle, CheckCircle2, 
  RefreshCw, Clock, Filter, Lock, ArrowUpRight, Usb, Unplug
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getErpAccess } from '@/lib/erp-access';
import { watchErpChanges } from '@/lib/erp-realtime';
import { formatPesoChileno } from '@/lib/format-peso';

export default function Pesaje() {
  const fetchVersion = useRef(0);
  const [solicitudesB2B, setSolicitudesB2B] = useState<any[]>([]);
  const [kilosInput, setKilosInput] = useState<{ [key: string]: number }>({});
  const [kilosRawInput, setKilosRawInput] = useState<{ [key: string]: string }>({});
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTab, setFilterTab] = useState<'todos' | 'pendientes' | 'pesados'>('todos');
  const [loading, setLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [modalConfirm, setModalConfirm] = useState<{ id: string; empresa: string; kilos: number } | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authError, setAuthError] = useState('');
  const [isRealtimeActive, setIsRealtimeActive] = useState(false);

  // Web Serial API (Lectura directa de Báscula RS-232 / CH340 a 9600 baud)
  const [serialSupported, setSerialSupported] = useState(false);
  const [serialConnected, setSerialConnected] = useState(false);
  const [liveSerialWeight, setLiveSerialWeight] = useState<number | null>(null);
  const serialPortRef = useRef<any>(null);
  const serialReaderRef = useRef<any>(null);
  const keepReadingRef = useRef<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setSerialSupported('serial' in navigator);
    }
    return () => {
      keepReadingRef.current = false;
      if (serialReaderRef.current) {
        serialReaderRef.current.cancel().catch(() => {});
      }
      if (serialPortRef.current) {
        serialPortRef.current.close().catch(() => {});
      }
    };
  }, []);

  const parsearTramaRomana = (texto: string): number | null => {
    if (!texto) return null;
    // 1. Tramas estándar con unidad Kg (ej: "4A0+  83202 Kg05D", "ST,GS,+  82.95kg", "WN 82.952 Kg")
    const kgRegex = /([+-]?)\s*(\d+(?:[.,]\d+)?)\s*Kg/gi;
    const kgMatches = Array.from(texto.matchAll(kgRegex));
    if (kgMatches.length > 0) {
      const last = kgMatches[kgMatches.length - 1];
      const sign = last[1] === '-' ? -1 : 1;
      const num = parseFloat(last[2].replace(',', '.'));
      if (!isNaN(num)) return sign * num;
    }

    // 2. Tramas con unidad gramos g / gr (ej: "ST,GS,+ 1002g", "1002 g") -> convertir a kg (/ 1000)
    const gRegex = /([+-]?)\s*(\d+(?:[.,]\d+)?)\s*g(?:r)?(?:\s|$|\r|\n)/gi;
    const gMatches = Array.from(texto.matchAll(gRegex));
    if (gMatches.length > 0) {
      const last = gMatches[gMatches.length - 1];
      const sign = last[1] === '-' ? -1 : 1;
      const num = parseFloat(last[2].replace(',', '.'));
      if (!isNaN(num)) return Number(((sign * num) / 1000).toFixed(3));
    }

    // 3. Tramas numéricas continuas con signo (ej: "+0082.95", "-0010.50")
    const numRegex = /([+-])\s*(\d+(?:[.,]\d+)?)/g;
    const numMatches = Array.from(texto.matchAll(numRegex));
    if (numMatches.length > 0) {
      const last = numMatches[numMatches.length - 1];
      const sign = last[1] === '-' ? -1 : 1;
      const num = parseFloat(last[2].replace(',', '.'));
      if (!isNaN(num)) return sign * num;
    }

    // 4. Tramas numéricas continuas sin signo o tras prefijos comunes de báscula (ej: "WT: 8420", "WN: 8420.5", "8420\r\n")
    const rawNumRegex = /(?:^|\s|[A-Za-z:=])([+-]?\d+(?:[.,]\d+)?)(?:\s|$|\r|\n)/g;
    const rawMatches = Array.from(texto.matchAll(rawNumRegex));
    if (rawMatches.length > 0) {
      const last = rawMatches[rawMatches.length - 1];
      const num = parseFloat(last[1].replace(',', '.'));
      if (!isNaN(num) && num > 0) return num;
    }

    return null;
  };

  const handleConnectSerial = async () => {
    if (typeof window === 'undefined' || !('serial' in navigator)) {
      alert('Tu navegador no soporta Web Serial API. Por favor utiliza Google Chrome o Microsoft Edge.');
      return;
    }

    try {
      // Abre el selector nativo del navegador para que el operador elija el puerto USB (CH340)
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' });

      serialPortRef.current = port;
      keepReadingRef.current = true;
      setSerialConnected(true);
      showToast('Báscula RS-232 conectada exitosamente a 9600 baud');

      // Decodificación de flujo continuo
      const textDecoder = new TextDecoderStream();
      port.readable.pipeTo(textDecoder.writable).catch(() => {});
      const reader = textDecoder.readable.getReader();
      serialReaderRef.current = reader;

      let buffer = '';
      while (keepReadingRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          buffer += value;
          if (buffer.length > 500) {
            buffer = buffer.slice(-300);
          }
          const peso = parsearTramaRomana(buffer);
          if (peso !== null && peso >= 0) {
            setLiveSerialWeight(peso);
          }
        }
      }
    } catch (err: any) {
      console.error('Error al conectar puerto RS-232:', err);
      if (err.name !== 'NotFoundError') {
        alert('Error al acceder al puerto serial RS-232: ' + (err.message || err));
      }
      setSerialConnected(false);
      setLiveSerialWeight(null);
    }
  };

  const handleDisconnectSerial = async () => {
    keepReadingRef.current = false;
    try {
      if (serialReaderRef.current) {
        await serialReaderRef.current.cancel();
        serialReaderRef.current = null;
      }
      if (serialPortRef.current) {
        await serialPortRef.current.close();
        serialPortRef.current = null;
      }
    } catch (e) {
      console.warn('Cerrando puerto serial:', e);
    }
    setSerialConnected(false);
    setLiveSerialWeight(null);
    showToast('Báscula RS-232 desconectada.');
  };

  const capturarPesoRomana = (id: string) => {
    if (liveSerialWeight === null || liveSerialWeight <= 0) {
      alert('Aún no se ha detectado un pesaje estabilizado mayor a 0 kg en la báscula.');
      return;
    }
    const val = liveSerialWeight;
    setKilosInput(prev => ({ ...prev, [id]: val }));
    const formatted = val % 1 !== 0 ? val.toString().replace('.', ',') : String(val);
    setKilosRawInput(prev => ({ ...prev, [id]: formatted }));
    showToast(`Peso capturado de báscula: ${formatKilosDisplay(val)}`);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const fetchSolicitudes = useCallback(async (signal?: AbortSignal) => {
    const version = ++fetchVersion.current;
    try {
      const query = supabase.from('solicitudes_b2b').select('*').order('fecha_solicitud', { ascending: false });
      const { data, error } = await (signal ? query.abortSignal(signal) : query);

      if (!signal?.aborted && version === fetchVersion.current && !error && data) {
        setSolicitudesB2B(data);
      }
    } catch (e) {
      console.error('Error al cargar pesajes:', e);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function checkAuth() {
      try {
        const access = await getErpAccess();
        if (!active) return;
        if (!access) window.location.replace('/');
        else if (access.role === 'chofer') window.location.replace('/rutas/');
        else setIsAuthorized(true);
      } catch (error) {
        if (active) {
          console.error('Error verificando el acceso a pesaje:', error);
          setAuthError('No se pudo verificar el acceso a Romana. Recarga la página para reintentar.');
        }
      } finally {
        if (active) setCheckingAuth(false);
      }
    }
    void checkAuth();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!isAuthorized) return;
    const controller = new AbortController();
    const invalidateFetch = () => { ++fetchVersion.current; };
    const refresh = () => { void fetchSolicitudes(controller.signal); };
    const stop = watchErpChanges('pesaje-realtime', ['solicitudes_b2b'], refresh, setIsRealtimeActive);
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => {
      invalidateFetch();
      controller.abort();
      clearInterval(timer);
      stop();
    };
  }, [isAuthorized, fetchSolicitudes]);

  const handleKilosChange = (id: string, value: string) => {
    // Permite números y un punto o coma decimal
    const cleaned = value.replace(/[^0-9.,]/g, '');
    setKilosRawInput(prev => ({ ...prev, [id]: cleaned }));

    // Convertir a número float: si tiene coma la reemplazamos por punto
    const normalized = cleaned.replace(',', '.');
    const num = parseFloat(normalized);
    setKilosInput(prev => ({ ...prev, [id]: isNaN(num) ? 0 : num }));
  };

  const formatKilosDisplay = (kilos: number) => {
    return formatPesoChileno(kilos);
  };

  const openConfirmation = (id: string, empresa: string) => {
    const kilos = kilosInput[id];
    if (!kilos || kilos <= 0) {
      alert("Por favor ingresa un pesaje válido mayor a 0 kg dictado por la báscula.");
      return;
    }
    setModalConfirm({ id, empresa, kilos });
  };

  const ejecutarPesaje = async () => {
    if (!modalConfirm) return;
    setLoading(true);

    try {
      // Generar Sello Criptográfico SHA-256 inmutable de pesaje oficial
      const rawPayload = `${modalConfirm.id}-${modalConfirm.empresa}-${modalConfirm.kilos}-${Date.now()}`;
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawPayload));
      const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

      const { error } = await (supabase
        .from('solicitudes_b2b') as any)
        .update({
          estado: 'Certificado Emitido',
          kilos_reales: modalConfirm.kilos,
          hash_certificado: hashHex
        })
        .eq('id', modalConfirm.id);

      if (!error) {
        setSolicitudesB2B(prev => prev.map(item => 
          item.id === modalConfirm.id 
            ? { ...item, estado: 'Certificado Emitido', kilos_reales: modalConfirm.kilos, hash_certificado: hashHex }
            : item
        ));
        showToast(`Pesaje certificado de ${formatKilosDisplay(modalConfirm.kilos)} para ${modalConfirm.empresa}`);
      } else {
        alert('Error al registrar pesaje: ' + error.message);
      }
    } catch (err: any) {
      alert('Error en conexión con la base de datos: ' + err.message);
    } finally {
      setLoading(false);
      setModalConfirm(null);
      fetchSolicitudes();
    }
  };

  // Métricas agregadas
  const totalCamiones = solicitudesB2B.length;
  const pesados = solicitudesB2B.filter(s => Number(s.kilos_reales) > 0);
  const pendientes = solicitudesB2B.filter(s => !s.kilos_reales || Number(s.kilos_reales) === 0);
  const totalKilosCertificados = pesados.reduce((acc, curr) => acc + Number(curr.kilos_reales), 0);

  // Filtrado
  const filteredList = solicitudesB2B.filter(sol => {
    const matchesSearch = 
      (sol.razon_social?.toLowerCase() || '').includes(searchTerm.toLowerCase()) || 
      (sol.rut?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (sol.material?.toLowerCase() || '').includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;
    if (filterTab === 'pendientes') return !sol.kilos_reales || Number(sol.kilos_reales) === 0;
    if (filterTab === 'pesados') return Number(sol.kilos_reales) > 0;
    return true;
  });

  // BLOQUEO ESTRICTO DE SEGURIDAD (CWE-200 / OWASP A01):
  if (checkingAuth || !isAuthorized) {
    return (
      <div className="min-h-screen bg-[#0b0f19] flex flex-col items-center justify-center font-sans text-slate-100">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <div className="flex items-center gap-2 text-xs text-emerald-400 font-mono tracking-wider">
            <Scale size={14} />
            <span>{authError || 'Verificando acceso a Romana y Báscula...'}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#0b0f19] text-slate-50 font-sans overflow-hidden">
      {/* SIDEBAR CORPORATIVO */}
      <BraxSidebar currentPath="/pesaje" />

      {/* CONTENIDO PRINCIPAL */}
      <main className="flex-1 flex flex-col h-screen overflow-y-auto bg-[#0b0f19]">
        {/* HEADER LIMPIO (Sin RS-232) */}
        <header className="h-16 flex items-center justify-between px-8 border-b border-slate-800 bg-[#0f172a]/90 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
              <Scale size={20} />
            </div>
            <div>
              <h1 className="text-base font-bold text-white flex items-center gap-2">
                Terminal de Báscula Romana <span className="text-xs font-normal text-slate-400">· Pesaje Industrial Fiscalizado</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Conexión Báscula RS-232 Directa (Web Serial API) */}
            {serialSupported ? (
              serialConnected ? (
                <div className="flex items-center gap-2 bg-emerald-950/80 border border-emerald-500/40 px-3 py-1.5 rounded-full shadow-inner animate-in fade-in">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-mono font-bold text-emerald-300">
                    RS-232: {liveSerialWeight !== null ? formatKilosDisplay(liveSerialWeight) : 'Leyendo romana...'}
                  </span>
                  <button
                    onClick={handleDisconnectSerial}
                    title="Desconectar báscula RS-232"
                    className="text-slate-400 hover:text-rose-400 ml-1 transition-colors p-0.5 rounded cursor-pointer"
                  >
                    <Unplug size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleConnectSerial}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-blue-300 text-xs font-semibold transition-all cursor-pointer shadow-sm hover:border-blue-400 hover:text-white"
                  title="Conectar directamente a la báscula física por cable USB-Serial RS-232 (CH340)"
                >
                  <Usb size={14} className="text-blue-400" />
                  <span>Conectar Báscula RS-232</span>
                </button>
              )
            ) : null}

            {isRealtimeActive ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="hidden sm:inline">WebSocket En Vivo</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-xs font-medium">
                <span className="w-2 h-2 rounded-full bg-slate-500" />
                <span className="hidden sm:inline">Conectando...</span>
              </div>
            )}

            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input 
                type="text" 
                placeholder="Buscar cliente, RUT o material..." 
                className="bg-slate-800/60 border border-slate-700 text-sm rounded-full pl-9 pr-4 py-1.5 focus:outline-none focus:border-blue-500 w-64 text-slate-200 placeholder-slate-500 transition-colors" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <button 
              onClick={() => void fetchSolicitudes()} 
              title="Actualizar pesajes" 
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        {/* CONTENEDOR CENTRAL */}
        <div className="p-8 max-w-7xl mx-auto w-full space-y-6">
          {/* TOAST NOTIFICATION */}
          {toastMessage && (
            <div className="p-4 bg-emerald-950/80 border border-emerald-500/40 rounded-xl text-emerald-300 text-sm flex items-center gap-3 shadow-lg animate-in fade-in slide-in-from-top-2">
              <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
              <p className="font-medium">{toastMessage}</p>
            </div>
          )}

          {/* TARJETAS DE MÉTRICAS (3 Tarjetas claras, sin OIML) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-[#1e293b]/80 border border-slate-800 p-6 rounded-2xl flex flex-col justify-between shadow-xl">
              <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider">
                <span>Total Procesado</span>
                <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400">
                  <Scale size={20} />
                </div>
              </div>
              <div className="mt-3">
                <span className="text-3xl font-extrabold font-mono text-white tracking-tight">
                  {formatKilosDisplay(totalKilosCertificados)}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-2">Peso neto acumulado verificado en planta</p>
            </div>

            <div className="bg-[#1e293b]/80 border border-slate-800 p-6 rounded-2xl flex flex-col justify-between shadow-xl">
              <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider">
                <span>Camiones Certificados</span>
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400">
                  <ShieldCheck size={20} />
                </div>
              </div>
              <div className="mt-3">
                <span className="text-3xl font-extrabold font-mono text-emerald-400">
                  {pesados.length}
                </span>
                <span className="text-sm text-slate-400 ml-2">/ {totalCamiones} totales</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">Con ticket y sello digital cerrado</p>
            </div>

            <div className="bg-[#1e293b]/80 border border-slate-800 p-6 rounded-2xl flex flex-col justify-between shadow-xl">
              <div className="flex items-center justify-between text-slate-400 text-xs font-semibold uppercase tracking-wider">
                <span>En Espera de Pesaje</span>
                <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400">
                  <Clock size={20} />
                </div>
              </div>
              <div className="mt-3">
                <span className="text-3xl font-extrabold font-mono text-amber-400">
                  {pendientes.length}
                </span>
                <span className="text-sm text-slate-400 ml-2">camiones</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">Ingresados en patio de maniobras</p>
            </div>
          </div>

          {/* TABLA PRINCIPAL DE CONTROL DE ROMANA */}
          <div className="bg-[#1e293b] rounded-2xl border border-slate-800 shadow-xl overflow-hidden">
            {/* BARRA DE ACCIÓN Y PESTAÑAS DE FILTRO */}
            <div className="p-5 border-b border-slate-800 bg-[#0f172a]/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="font-bold text-white text-base flex items-center gap-2">
                  <Truck size={18} className="text-blue-400" />
                  Registro de Pesajes en Báscula de Plataforma
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Ingresa y certifica el peso bruto dictado por la báscula antes de emitir el certificado oficial MMA/SINADER.
                </p>
              </div>

              {/* TABS */}
              <div className="flex items-center gap-1 bg-[#0b0f19] p-1 rounded-xl border border-slate-800">
                <button
                  onClick={() => setFilterTab('todos')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    filterTab === 'todos' 
                      ? 'bg-blue-600 text-white shadow-md' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Todos ({solicitudesB2B.length})
                </button>
                <button
                  onClick={() => setFilterTab('pendientes')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    filterTab === 'pendientes' 
                      ? 'bg-amber-600 text-white shadow-md' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Pendientes ({pendientes.length})
                </button>
                <button
                  onClick={() => setFilterTab('pesados')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    filterTab === 'pesados' 
                      ? 'bg-emerald-600 text-white shadow-md' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Pesados ({pesados.length})
                </button>
              </div>
            </div>

            {/* TABLA CON DETALLE INDUSTRIAL */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-[#0f172a] text-slate-400 text-xs uppercase tracking-wider font-semibold border-b border-slate-800">
                  <tr>
                    <th className="px-6 py-4">Ticket / Fecha</th>
                    <th className="px-6 py-4">Empresa & RUT</th>
                    <th className="px-6 py-4">Material / Estimado</th>
                    <th className="px-6 py-4 text-center">Estado Romana</th>
                    <th className="px-6 py-4 text-right">Peso Físico Registrado</th>
                    <th className="px-6 py-4 text-center">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredList.map((sol, idx) => {
                    const isPesado = sol.kilos_reales > 0;
                    const ticketId = `TK-BRX-${sol.id ? sol.id.substring(0, 6).toUpperCase() : `00${idx + 1}`}`;
                    const fechaStr = sol.fecha_solicitud 
                      ? new Date(sol.fecha_solicitud).toLocaleDateString('es-CL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                      : 'Hoy';

                    return (
                      <tr key={sol.id} className="hover:bg-slate-800/30 transition-colors">
                        {/* TICKET / FECHA */}
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-blue-400 bg-blue-950/40 border border-blue-800/40 px-2 py-0.5 rounded">
                              {ticketId}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                            <Clock size={11} /> {fechaStr}
                          </div>
                        </td>

                        {/* EMPRESA & RUT */}
                        <td className="px-6 py-4">
                          <p className="font-semibold text-white tracking-wide">{sol.razon_social}</p>
                          <p className="text-xs text-slate-400 font-mono mt-0.5">
                            RUT: <span className="text-slate-300 font-medium">{sol.rut}</span>
                          </p>
                        </td>

                        {/* MATERIAL */}
                        <td className="px-6 py-4">
                          <span className="inline-block px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-800 border border-slate-700/60 text-slate-200">
                            {sol.material || 'Material Mixto'}
                          </span>
                          <p className="text-[11px] text-slate-400 mt-1">
                            {sol.volumen_toneladas} Tons Estimadas
                          </p>
                        </td>

                        {/* ESTADO */}
                        <td className="px-6 py-4 text-center whitespace-nowrap">
                          {isPesado ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                              <CheckCircle2 size={13} className="text-emerald-400" />
                              Pesado & Cerrado
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 border border-amber-500/30 text-amber-400">
                              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                              En Plataforma
                            </span>
                          )}
                        </td>

                        {/* PESO BÁSCULA (Con formato exacto y soporte para decimales) */}
                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          {isPesado ? (
                            <div className="flex flex-col items-end">
                              <span className="text-base font-bold font-mono text-emerald-400">
                                {formatKilosDisplay(Number(sol.kilos_reales))}
                              </span>
                              <span className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                                <Lock size={10} /> Registro Bloqueado
                              </span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-end gap-1.5">
                              <div className="flex justify-end items-center gap-2">
                                {serialConnected && (
                                  <button
                                    type="button"
                                    onClick={() => capturarPesoRomana(sol.id)}
                                    className="bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer shadow-sm hover:border-emerald-400 active:scale-95"
                                    title="Capturar peso estabilizado directo desde la báscula física RS-232"
                                  >
                                    <Scale size={13} className="text-emerald-400" />
                                    <span>Capturar</span>
                                  </button>
                                )}
                                <input 
                                  type="text" 
                                  placeholder="Ej: 82,95"
                                  value={kilosRawInput[sol.id] !== undefined ? kilosRawInput[sol.id] : ''}
                                  className="bg-[#0b0f19] border border-slate-700 rounded-lg px-3 py-1.5 w-32 text-right text-white font-mono font-bold focus:border-blue-500 focus:outline-none transition-colors"
                                  onChange={(e) => handleKilosChange(sol.id, e.target.value)}
                                />
                                <span className="text-slate-400 text-xs font-mono font-semibold">kg</span>
                              </div>
                              <span className="text-[10px] text-slate-500">
                                {kilosInput[sol.id] > 0 
                                  ? `= ${formatKilosDisplay(kilosInput[sol.id])}` 
                                  : (serialConnected ? 'Presiona Capturar o ingresa manual' : 'Ingreso manual o vía RS-232')}
                              </span>
                            </div>
                          )}
                        </td>

                        {/* ACCIÓN */}
                        <td className="px-6 py-4 text-center whitespace-nowrap">
                          {isPesado ? (
                            <span className="inline-flex items-center gap-1 text-xs text-slate-400 font-medium px-2 py-1 bg-slate-900/60 rounded border border-slate-800">
                              <ShieldCheck size={14} className="text-emerald-400" /> Certificado
                            </span>
                          ) : (
                            <button 
                              onClick={() => openConfirmation(sol.id, sol.razon_social)}
                              className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold px-3.5 py-1.5 rounded-lg transition-all shadow-md shadow-blue-900/30 cursor-pointer"
                              title="Registrar y certificar pesaje"
                            >
                              <Save size={14} /> Certificar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {filteredList.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-slate-500">
                        <Scale size={32} className="mx-auto mb-2 text-slate-600" />
                        No se encontraron registros de camiones en la categoría seleccionada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* FOOTER */}
            <div className="p-4 border-t border-slate-800 bg-[#0f172a]/40 flex flex-col sm:flex-row justify-between items-center text-xs text-slate-400 gap-2">
              <span className="flex items-center gap-1.5 font-mono">
                <ShieldCheck size={14} className="text-emerald-400" />
                Control de Pesaje Certificado para Declaración SINADER / MMA
              </span>
              <span>
                Mostrando <strong className="text-white">{filteredList.length}</strong> de <strong className="text-white">{solicitudesB2B.length}</strong> registros totales
              </span>
            </div>
          </div>
        </div>

        {/* MODAL DE CONFIRMACIÓN IRREVERSIBLE DE PESAJE */}
        {modalConfirm && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-[#0f172a] border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
              <div className="flex items-center gap-3 text-amber-400 border-b border-slate-800 pb-3">
                <AlertCircle size={24} />
                <h3 className="font-bold text-white text-base">Confirmar Certificación en Romana</h3>
              </div>
              
              <div className="text-sm text-slate-300 space-y-3">
                <p>
                  Vas a registrar formalmente el pesaje para la empresa:
                </p>
                <div className="bg-[#1e293b] p-3 rounded-xl border border-slate-700/60 font-mono text-center">
                  <p className="text-white font-bold text-base">{modalConfirm.empresa}</p>
                  <p className="text-2xl font-bold text-emerald-400 mt-1">
                    {formatKilosDisplay(modalConfirm.kilos)}
                  </p>
                  {modalConfirm.kilos < 500 && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      (Equivalente a {formatPesoChileno(modalConfirm.kilos)} netos)
                    </p>
                  )}
                </div>
                <p className="text-xs text-amber-300/90 bg-amber-950/30 border border-amber-800/40 p-2.5 rounded-lg leading-relaxed">
                  ⚠️ <strong>Acción Legal e Irreversible:</strong> Al confirmar, este valor será sellado criptográficamente y quedará inmutable para la emisión del certificado oficial SINADER.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setModalConfirm(null)}
                  disabled={loading}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={ejecutarPesaje}
                  disabled={loading}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-emerald-900/30"
                >
                  {loading ? 'Sellando...' : 'Confirmar y Sellar Pesaje'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
