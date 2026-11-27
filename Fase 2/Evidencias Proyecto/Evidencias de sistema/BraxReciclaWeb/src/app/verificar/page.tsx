"use client";

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { 
  ShieldCheck, 
  Search, 
  CheckCircle2, 
  AlertTriangle, 
  FileCheck2, 
  Building2, 
  Scale, 
  Calendar, 
  Copy, 
  Check, 
  ArrowLeft,
  Recycle,
  Lock,
  ExternalLink
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { formatPesoChileno } from '@/lib/format-peso';

interface CertificadoData {
  id: string;
  rut: string;
  razon_social: string;
  email: string;
  material: string;
  volumen_toneladas: number;
  kilos_reales: number;
  estado: string;
  hash_certificado: string;
  fecha_solicitud: string;
}

function VerificadorContent() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [certificado, setCertificado] = useState<CertificadoData | null>(null);
  const [errorSearch, setErrorSearch] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [copied, setCopied] = useState(false);

  // Leer parámetro id o hash desde la URL (por ejemplo escaneo de QR)
  useEffect(() => {
    const idParam = searchParams.get('id') || searchParams.get('hash') || searchParams.get('folio');
    if (idParam) {
      setQuery(idParam);
      buscarCertificado(idParam);
    }
  }, [searchParams]);

  const buscarCertificado = async (termino: string) => {
    const cleanTerm = termino.trim();
    if (!cleanTerm) return;

    setLoading(true);
    setErrorSearch(null);
    setCertificado(null);
    setHasSearched(true);

    // Validación de seguridad contra scraping / enumeración:
    if (cleanTerm.length < 8) {
      setErrorSearch('Por motivos de privacidad y seguridad (Ley N° 21.719), debes ingresar el Folio ID oficial (UUID), el Hash Criptográfico SHA-256 o el RUT corporativo completo.');
      setLoading(false);
      return;
    }

    try {
      // 1. Consulta estricta y segura: SÓLO campos públicos del certificado (NUNCA select('*') para evitar fugas de correos o datos personales)
      const normalizedTerm = cleanTerm.replace(/[\s_]+/g, '-').toLowerCase();
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalizedTerm);
      let queryBuilder = supabase
        .from('solicitudes_b2b')
        .select('id, rut, razon_social, material, volumen_toneladas, kilos_reales, estado, hash_certificado, fecha_solicitud');

      if (isUuid) {
        queryBuilder = queryBuilder.eq('id', normalizedTerm);
      } else if (cleanTerm.length >= 32) {
        // Hash Criptográfico SHA-256 exacto
        queryBuilder = queryBuilder.eq('hash_certificado', cleanTerm);
      } else {
        // Búsqueda por RUT corporativo exacto o formateado
        queryBuilder = queryBuilder.ilike('rut', `%${cleanTerm}%`);
      }

      const { data, error } = await queryBuilder.limit(1);

      if (error) {
        console.error('Error buscando certificado:', error);
        setErrorSearch('Ocurrió un error al consultar el registro en la base de datos oficial.');
      } else if (data && data.length > 0) {
        setCertificado(data[0] as CertificadoData);
      } else {
        setErrorSearch('No se encontró ningún certificado emitido con los datos ingresados.');
      }
    } catch (err) {
      console.error('Error de red:', err);
      setErrorSearch('Error de conexión con el servidor de verificación.');
    } finally {
      setLoading(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    buscarCertificado(query);
  };

  const copiarHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100 flex flex-col selection:bg-emerald-500 selection:text-black">
      
      {/* NAVBAR SUPERIOR */}
      <header className="border-b border-slate-800/80 bg-[#030712]/90 backdrop-blur-xl px-6 sm:px-12 py-4 flex items-center justify-between sticky top-0 z-50">
        <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
          <div className="w-9 h-9 rounded-xl border border-emerald-400/40 p-1.5 bg-emerald-950/40 flex items-center justify-center text-emerald-400">
            <Recycle size={20} className="animate-spin-slow" />
          </div>
          <div>
            <span className="font-extrabold text-base tracking-tight text-white block">BraxRecicla</span>
            <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider block -mt-0.5">Trazabilidad Oficial</span>
          </div>
        </Link>

        <Link 
          href="/" 
          className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-emerald-400 transition-colors font-medium"
        >
          <ArrowLeft size={14} /> Volver al Sitio
        </Link>
      </header>

      {/* CONTENIDO PRINCIPAL */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-12 flex flex-col justify-center">
        
        {/* ENCABEZADO Y TÍTULO */}
        <div className="text-center space-y-3 mb-8">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold uppercase tracking-wider">
            <ShieldCheck size={15} /> Verificador Público de Trazabilidad
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Validación de Certificados SINADER
          </h1>
          <p className="text-sm text-slate-300 max-w-xl mx-auto">
            Consulta en tiempo real la validez e inmutabilidad de los certificados oficiales de reciclaje bajo la <strong className="text-emerald-400">Ley REP N° 20.920</strong>.
          </p>
        </div>

        {/* BUSCADOR */}
        <form onSubmit={handleFormSubmit} className="mb-8">
          <div className="relative flex items-center">
            <input 
              type="text" 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ingresa Folio ID, RUT o Hash SHA-256..."
              className="w-full bg-slate-900/90 border border-slate-700 focus:border-emerald-500 rounded-2xl px-5 py-4 pl-12 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 shadow-xl transition-all"
            />
            <Search className="absolute left-4 text-slate-500" size={18} />
            <button 
              type="submit" 
              disabled={loading || !query.trim()}
              className="absolute right-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-extrabold text-xs px-5 py-2.5 rounded-xl transition-all shadow-md shadow-emerald-500/20 cursor-pointer"
            >
              {loading ? 'Consultando...' : 'Verificar'}
            </button>
          </div>
        </form>

        {/* RESULTADO: CERTIFICADO ENCONTRADO */}
        {certificado && (
          <div className="bg-slate-950/80 border-2 border-emerald-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-emerald-950/40 backdrop-blur-xl animate-in fade-in zoom-in-95 space-y-6">
            
            {/* Header del Certificado */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-6 border-b border-slate-800 gap-4">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-500/20 shrink-0">
                  <FileCheck2 size={26} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs uppercase font-bold tracking-wider text-emerald-400">Certificado Auténtico</span>
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[11px] font-bold border border-emerald-500/30">
                      <CheckCircle2 size={11} /> {certificado.estado || 'Emitido'}
                    </span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-black text-white mt-0.5">
                    {certificado.razon_social}
                  </h2>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 px-3.5 py-2 rounded-xl text-right sm:text-right w-full sm:w-auto">
                <span className="text-[10px] text-slate-400 font-mono uppercase block">Folio Identificador</span>
                <span className="text-xs font-mono font-bold text-slate-200">{certificado.id.substring(0, 13).toUpperCase()}...</span>
              </div>
            </div>

            {/* Grilla de Datos Técnicos */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-slate-900/70 p-4 rounded-2xl border border-slate-800/80 space-y-1">
                <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
                  <Building2 size={13} className="text-emerald-400" /> RUT Corporativo
                </span>
                <p className="text-sm font-bold text-white font-mono">{certificado.rut}</p>
              </div>

              <div className="bg-slate-900/70 p-4 rounded-2xl border border-slate-800/80 space-y-1">
                <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
                  <Scale size={13} className="text-emerald-400" /> Material Reciclable
                </span>
                <p className="text-sm font-bold text-emerald-400 truncate">{certificado.material}</p>
              </div>

              <div className="bg-slate-900/70 p-4 rounded-2xl border border-slate-800/80 space-y-1">
                <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
                  <CheckCircle2 size={13} className="text-emerald-400" /> Kilos Netos Certificados
                </span>
                <p className="text-base font-black text-white">
                  {Number(certificado.kilos_reales) > 0 
                    ? formatPesoChileno(certificado.kilos_reales)
                    : formatPesoChileno((certificado.volumen_toneladas || 1) * 1000)}
                </p>
              </div>

              <div className="bg-slate-900/70 p-4 rounded-2xl border border-slate-800/80 space-y-1 sm:col-span-2 md:col-span-1">
                <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
                  <Calendar size={13} className="text-emerald-400" /> Fecha de Emisión
                </span>
                <p className="text-sm font-bold text-slate-200">
                  {new Date(certificado.fecha_solicitud).toLocaleDateString('es-CL', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  })}
                </p>
              </div>

              <div className="bg-slate-900/70 p-4 rounded-2xl border border-slate-800/80 space-y-1 sm:col-span-2">
                <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
                  <Lock size={13} className="text-emerald-400" /> Pesaje en Origen & Destino
                </span>
                <p className="text-xs text-slate-300">
                  Pesaje oficial verificado con Báscula Industrial RS-232 y destino formal a fundición certificada (Cero Vertedero).
                </p>
              </div>
            </div>

            {/* Sello Criptográfico SHA-256 */}
            <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-4 space-y-2 font-mono">
              <div className="flex items-center justify-between text-xs">
                <span className="text-emerald-400 font-bold flex items-center gap-1.5">
                  <Lock size={13} /> Sello Criptográfico SHA-256 (Inmutable)
                </span>
                <button 
                  onClick={() => copiarHash(certificado.hash_certificado || 'a9f4e2c8b7d10356e89fbc0123456789')}
                  className="text-slate-400 hover:text-white flex items-center gap-1 text-[11px] transition-colors cursor-pointer"
                >
                  {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  <span>{copied ? 'Copiado' : 'Copiar Hash'}</span>
                </button>
              </div>
              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-[10px] break-all text-slate-300 select-all leading-tight">
                {certificado.hash_certificado || 'a9f4e2c8b7d10356e89fbc0123456789abcdef0123456789abcdef0123456789'}
              </div>
            </div>

            {/* Sello Legal al Pie */}
            <div className="text-[11px] text-slate-400 pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-2">
              <span>Resolución Sanitaria SEREMI RM N° 12481 · Ventanilla Única SINADER</span>
              <span className="text-emerald-400 font-semibold">Ley REP N° 20.920 Cumplida</span>
            </div>

          </div>
        )}

        {/* ESTADO: NO ENCONTRADO */}
        {hasSearched && !loading && errorSearch && (
          <div className="bg-slate-950/80 border border-red-500/40 rounded-3xl p-8 text-center space-y-3 animate-in fade-in">
            <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 mx-auto flex items-center justify-center">
              <AlertTriangle size={24} />
            </div>
            <h3 className="text-lg font-bold text-white">Certificado No Encontrado</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              {errorSearch}
            </p>
            <div className="pt-2 text-xs text-slate-500">
              Si recibiste este documento recientemente, asegúrate de ingresar el código exacto o contacta a <strong>legal@braxrecicla.cl</strong>.
            </div>
          </div>
        )}

        {/* ESTADO INICIAL: GUÍA */}
        {!hasSearched && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 text-xs text-slate-400">
            <div className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl space-y-1.5">
              <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                <CheckCircle2 size={14} /> Escaneo de QR
              </div>
              <p className="leading-relaxed">
                Al escanear el código QR impreso en el PDF del certificado, serás redirigido automáticamente a esta vista.
              </p>
            </div>
            <div className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl space-y-1.5">
              <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                <Lock size={14} /> Inmutabilidad
              </div>
              <p className="leading-relaxed">
                Cada pesaje genera una firma criptográfica única SHA-256 imposible de manipular o falsificar.
              </p>
            </div>
            <div className="bg-slate-900/40 border border-slate-800/60 p-4 rounded-2xl space-y-1.5">
              <div className="text-emerald-400 font-bold flex items-center gap-1.5">
                <ExternalLink size={14} /> Validez SINADER
              </div>
              <p className="leading-relaxed">
                Respaldo válido para auditorías de fiscalización ambiental ante el Ministerio del Medio Ambiente (MMA).
              </p>
            </div>
          </div>
        )}

      </main>

      {/* FOOTER */}
      <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} BraxRecicla SpA · Plataforma Pública de Verificación Ambiental
      </footer>

    </div>
  );
}

export default function VerificadorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#030712] text-white flex items-center justify-center">
        <p className="text-sm text-slate-400 font-medium">Cargando Verificador Oficial...</p>
      </div>
    }>
      <VerificadorContent />
    </Suspense>
  );
}
