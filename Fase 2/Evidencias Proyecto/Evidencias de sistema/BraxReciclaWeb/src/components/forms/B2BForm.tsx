"use client";

import React, { useState } from 'react';
import { ChevronRight, Building2, CheckCircle2, AlertCircle, Mail, ShieldCheck, RefreshCw, FileText } from 'lucide-react';
import { formatRut, validateRut } from '@/lib/rutUtils';
import { validarRutSII } from '@/lib/validarSiiClient';
import { supabase } from '@/lib/supabase';

export default function B2BForm() {
  const [rut, setRut] = useState('');
  const [rutError, setRutError] = useState('');
  const [nombreEmpresa, setNombreEmpresa] = useState('');
  const [email, setEmail] = useState('');
  const [material, setMaterial] = useState('Chatarra Ferrosa');
  const [volumen, setVolumen] = useState('1');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [confirmedInfo, setConfirmedInfo] = useState<{ empresa: string; rut: string; material: string; ticket: string } | null>(null);

  const handleRutChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatRut(e.target.value);
    setRut(formatted);
    setRutError('');
    setStatusMessage('');
  };

  const handleRutBlur = () => {
    if (rut.length > 0 && !validateRut(rut)) {
      setRutError('RUT corporativo inválido. Comprueba el dígito verificador.');
    }
  };

  const validarSII = async () => {
    if (!validateRut(rut)) {
      setRutError('Ingresa un RUT válido para consultar');
      return;
    }
    
    setIsLoading(true);
    setStatusMessage('');
    setRutError('');

    try {
      const res = await validarRutSII(rut);
      if (res.isValid && res.razonSocial) {
        setNombreEmpresa(res.razonSocial);
        setStatusMessage(res.razonSocial);
      } else if (res.isValid) {
        setStatusMessage('RUT verificado correctamente.');
      } else if (res.error) {
        setRutError(res.error);
      }
    } catch {
      setStatusMessage('RUT verificado');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateRut(rut)) {
      setRutError('Por favor ingresa un RUT válido');
      return;
    }
    
    setSubmitting(true);
    const empresaActual = nombreEmpresa.trim() || 'Empresa Solicitante';
    const ticketId = `B2B-BRX-${Math.floor(10000 + Math.random() * 90000)}`;

    try {
      const { error } = await supabase
        .from('solicitudes_b2b')
        .insert([
          {
            rut,
            razon_social: empresaActual,
            email,
            material,
            volumen_toneladas: parseInt(volumen) || 1
          }
        ]);
      
      if (!error) {
        // Disparar notificación por correo asíncrona al cliente y administración
        fetch('/api/notificar.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tipo: 'B2B',
            ticket: ticketId,
            empresa: empresaActual,
            rut,
            email,
            material,
            volumen: `${volumen} Tonelada(s)`
          })
        }).catch(err => console.log('Envío de notificación por correo en segundo plano:', err));

        setConfirmedInfo({
          empresa: empresaActual,
          rut,
          material,
          ticket: ticketId
        });
        setSuccess(true);
        setRut('');
        setNombreEmpresa('');
        setEmail('');
        setStatusMessage('');
      } else {
        console.error('Error insert B2B:', error);
        alert('No fue posible procesar la solicitud en este momento. Por favor verifica los datos e inténtalo nuevamente.');
      }
    } catch (err) {
      console.error('Error de conexión B2B:', err);
      alert('Error de conexión con el servidor. Por favor intenta más tarde.');
    } finally {
      setSubmitting(false);
    }
  };

  // VISTA DE CONFIRMACIÓN CLARA Y DIFERENCIADORA
  if (success && confirmedInfo) {
    return (
      <div className="flex flex-col justify-between h-full space-y-4 p-2 animate-in fade-in zoom-in-95">
        <div className="text-center space-y-3 pt-2">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-400/40 text-emerald-400 mx-auto flex items-center justify-center shadow-lg shadow-emerald-950/40">
            <CheckCircle2 size={32} />
          </div>
          <h3 className="text-base font-extrabold text-white tracking-wide">
            ¡SOLICITUD CORPORATIVA REGISTRADA CON ÉXITO!
          </h3>
          <p className="text-xs text-slate-300">
            Tu requerimiento logístico ya ingresó formalmente al sistema de gestión de BraxRecicla.
          </p>
        </div>

        {/* Tarjeta de Resumen Corporativo */}
        <div className="bg-slate-900/90 border border-emerald-500/40 rounded-2xl p-4 space-y-2.5 font-mono text-xs">
          <div className="flex justify-between items-center pb-2 border-b border-slate-800">
            <span className="text-slate-400">N° de Ticket:</span>
            <span className="text-emerald-400 font-bold">{confirmedInfo.ticket}</span>
          </div>
          <div className="flex justify-between items-center pb-2 border-b border-slate-800">
            <span className="text-slate-400">Empresa:</span>
            <span className="text-white font-bold">{confirmedInfo.empresa}</span>
          </div>
          <div className="flex justify-between items-center pb-2 border-b border-slate-800">
            <span className="text-slate-400">RUT:</span>
            <span className="text-slate-200">{confirmedInfo.rut}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-slate-400">Material:</span>
            <span className="text-emerald-300">{confirmedInfo.material}</span>
          </div>
        </div>

        <div className="p-3 bg-blue-950/30 border border-blue-500/30 rounded-xl text-[11px] text-blue-200 leading-relaxed">
          <p className="flex items-center gap-1.5 font-bold mb-1">
            <ShieldCheck size={14} className="text-blue-400" /> Próximos Pasos Operativos:
          </p>
          <p className="text-slate-300">
            Nuestro equipo de patio coordinará la asignación de tolva y el pesaje en báscula romana para la posterior emisión del <strong>Certificado Oficial SHA-256 (SINADER / MMA)</strong>.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setSuccess(false);
            setConfirmedInfo(null);
          }}
          className="w-full bg-slate-800 hover:bg-slate-700 text-white font-semibold py-3 px-4 rounded-xl transition-all text-xs flex items-center justify-center gap-2 cursor-pointer border border-slate-700"
        >
          <RefreshCw size={14} />
          <span>Ingresar otra Solicitud Corporativa</span>
        </button>
      </div>
    );
  }

  return (
    <form className="flex flex-col justify-between h-full space-y-4" onSubmit={handleSubmit}>
      
      {/* Fila 1: RUT + Nombre de Empresa */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-blue-200 uppercase tracking-wider">RUT Empresa</label>
          <div className="flex gap-2">
            <input 
              type="text" 
              value={rut}
              onChange={handleRutChange}
              onBlur={handleRutBlur}
              maxLength={12}
              className={`w-full bg-slate-900/90 border ${rutError ? 'border-red-500' : statusMessage ? 'border-blue-400' : 'border-blue-500/30'} rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm transition-all placeholder:text-slate-600`} 
              placeholder="76.123.456-7" 
              required 
            />
            <button 
              type="button" 
              onClick={validarSII}
              disabled={isLoading || rut.length < 8}
              className="bg-blue-600/30 hover:bg-blue-600/50 border border-blue-500/40 text-xs px-3 rounded-xl text-blue-200 transition-colors disabled:opacity-50 whitespace-nowrap cursor-pointer font-medium"
            >
              {isLoading ? '...' : 'Validar SII'}
            </button>
          </div>
          {rutError && <p className="text-red-400 text-[11px] flex items-center gap-1"><AlertCircle size={11} /> {rutError}</p>}
          {statusMessage && <p className="text-blue-400 text-[11px] flex items-center gap-1"><CheckCircle2 size={11} /> {statusMessage}</p>}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-blue-200 uppercase tracking-wider">Razón Social</label>
          <input 
            type="text" 
            value={nombreEmpresa}
            onChange={(e) => setNombreEmpresa(e.target.value)}
            className="w-full bg-slate-900/90 border border-blue-500/30 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm transition-all placeholder:text-slate-600" 
            placeholder="Ej: Empresa Ejemplo SpA" 
            required
          />
        </div>
      </div>

      {/* Fila 2: Correo Electrónico Corporativo */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-blue-200 uppercase tracking-wider flex items-center gap-1.5">
          <Mail size={13} className="text-blue-400" /> Correo Electrónico de Contacto
        </label>
        <input 
          type="email" 
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-slate-900/90 border border-blue-500/30 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm transition-all placeholder:text-slate-600" 
          placeholder="contacto@empresa.cl" 
          required
        />
      </div>

      {/* Fila 3: Material Principal */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-blue-200 uppercase tracking-wider">Material Principal a Retirar</label>
        <select 
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
          className="w-full bg-slate-900/90 border border-blue-500/30 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-blue-400 text-sm transition-all appearance-none cursor-pointer"
        >
          <option>Chatarra Ferrosa & Acero</option>
          <option>Cobre & Metales No Ferrosos</option>
          <option>Aluminio & Perfiles Industriales</option>
          <option>Plástico Industrial (PET / PEAD / Film)</option>
          <option>Cartón Corrugado & Papel a Granel</option>
          <option>Vidrio Industrial & Envases</option>
          <option>RAEE (Residuos Eléctricos y Electrónicos)</option>
          <option>Mix Multimaterial Industrial</option>
        </select>
      </div>

      {/* Fila 4: Volumen Estimado */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-blue-200 uppercase tracking-wider">Volumen Estimado por Retiro</label>
        <select 
          value={volumen}
          onChange={(e) => setVolumen(e.target.value)}
          className="w-full bg-slate-900/90 border border-blue-500/30 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-blue-400 text-sm transition-all appearance-none cursor-pointer"
        >
          <option value="1">1 - 5 Toneladas (Camión Tres Cuartos)</option>
          <option value="5">5 - 10 Toneladas (Camión Tolva Mediano)</option>
          <option value="10">+ 10 Toneladas (Batea Industrial Granel)</option>
        </select>
      </div>

      {/* Botón de Envío Corporativo Azul */}
      <div className="pt-2 mt-auto">
        <button 
          type="submit" 
          disabled={submitting}
          className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white font-extrabold py-3.5 px-6 rounded-xl shadow-lg shadow-blue-500/30 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
        >
          <span>{submitting ? 'Enviando solicitud...' : 'Enviar Solicitud Corporativa B2B'}</span>
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Footer Legal B2B */}
      <div className="flex items-center justify-center gap-2 text-slate-400 text-xs pt-1 border-t border-slate-800/60">
        <ShieldCheck size={14} className="text-blue-400" />
        <span>Emisión de <strong>Certificado Oficial SHA-256</strong> para SINADER / MMA</span>
      </div>

    </form>
  );
}
