"use client";

import React, { useState } from 'react';
import { ChevronRight, MapPin, CheckCircle2, AlertCircle, Mail, ShieldCheck } from 'lucide-react';
import { formatRut, validateRut } from '@/lib/rutUtils';
import { supabase } from '@/lib/supabase';

const COMUNAS_CHILE = [
  "Quilicura",
  "Santiago Centro",
  "Providencia",
  "Las Condes",
  "Vitacura",
  "Ñuñoa",
  "La Reina",
  "Lo Barnechea",
  "Maipú",
  "La Florida",
  "Puente Alto",
  "San Bernardo",
  "Pudahuel",
  "Renca",
  "Recoleta",
  "Independencia",
  "Conchalí",
  "Huechuraba",
  "Estación Central",
  "Cerrillos",
  "Peñalolén",
  "Macul",
  "San Miguel",
  "La Cisterna",
  "Colina",
  "Lampa",
  "Otra Comuna / Región"
];

export default function B2CForm() {
  const [nombre, setNombre] = useState('');
  const [rut, setRut] = useState('');
  const [rutError, setRutError] = useState('');
  const [email, setEmail] = useState('');
  const [comuna, setComuna] = useState('Quilicura');
  const [calleNumero, setCalleNumero] = useState('');
  const [material, setMaterial] = useState('Botellas de Bebida (PET 1)');
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleRutChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatRut(e.target.value);
    setRut(formatted);
    setRutError('');
  };

  const handleRutBlur = () => {
    if (rut.length > 0 && !validateRut(rut)) {
      setRutError('RUT inválido. Comprueba el dígito verificador.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateRut(rut)) {
      setRutError('Por favor ingresa un RUT válido');
      return;
    }

    if (!calleNumero.trim()) {
      alert('Por favor ingresa tu calle y número.');
      return;
    }

    const direccionConContacto = email.trim() 
      ? `${calleNumero.trim()}, ${comuna} · Contacto: ${email.trim()}`
      : `${calleNumero.trim()}, ${comuna}`;

    setLoading(true);
    setSuccessMessage(null);

    try {
      const { error } = await supabase
        .from('solicitudes_b2c')
        .insert([
          {
            nombre,
            rut,
            direccion: direccionConContacto,
            material,
            kilos_estimados: 1,
            estado: 'Pendiente'
          }
        ]);

      if (!error) {
        const ticketB2C = `B2C-BRX-${Math.floor(10000 + Math.random() * 90000)}`;

        // Disparar notificación por correo asíncrona al ciudadano y administración
        fetch('/api/notificar.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tipo: 'B2C',
            ticket: ticketB2C,
            nombre,
            rut,
            email,
            material,
            volumen: 'Recolección Urbana Domiciliaria',
            direccion: direccionConContacto
          })
        }).catch(err => console.log('Envío de notificación por correo B2C:', err));

        setSuccessMessage('¡Solicitud ciudadana registrada con éxito! Tu retiro ha quedado programado en nuestro sistema.');
        setNombre('');
        setRut('');
        setEmail('');
        setCalleNumero('');
      } else {
        console.error('Error al registrar solicitud B2C:', error);
        alert('No fue posible procesar la solicitud en este momento. Por favor verifica los datos ingresados e intenta nuevamente.');
      }
    } catch (err) {
      console.error('Error de red en B2C:', err);
      alert('Error de conexión con el servidor. Por favor intenta más tarde.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="flex flex-col justify-between h-full space-y-4" onSubmit={handleSubmit}>
      
      {successMessage && (
        <div className="bg-emerald-500/15 border border-emerald-400/40 text-emerald-300 p-3.5 rounded-2xl flex items-center gap-3">
          <CheckCircle2 size={20} className="text-emerald-400 shrink-0" />
          <p className="text-xs sm:text-sm font-medium">{successMessage}</p>
        </div>
      )}

      {/* Fila 1: Nombre + RUT Ciudadano (Symmetrical 2 cols) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-emerald-200 uppercase tracking-wider">Nombre Completo</label>
          <input 
            type="text" 
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            className="w-full bg-slate-900/90 border border-emerald-500/30 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm transition-all placeholder:text-slate-600" 
            placeholder="Ej: Constanza Morales" 
            required 
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-emerald-200 uppercase tracking-wider">RUT Ciudadano</label>
          <input 
            type="text" 
            value={rut}
            onChange={handleRutChange}
            onBlur={handleRutBlur}
            maxLength={12}
            className={`w-full bg-slate-900/90 border ${rutError ? 'border-red-500' : 'border-emerald-500/30'} rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm transition-all placeholder:text-slate-600`} 
            placeholder="12.345.678-9" 
            required 
          />
          {rutError && <p className="text-red-400 text-[11px] flex items-center gap-1"><AlertCircle size={11} /> {rutError}</p>}
        </div>
      </div>

      {/* Fila 2: Correo Electrónico de Contacto (Sin mención de WhatsApp ni teléfono) */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-emerald-200 uppercase tracking-wider flex items-center gap-1.5">
          <Mail size={13} className="text-emerald-400" /> Correo Electrónico de Contacto
        </label>
        <input 
          type="email" 
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full bg-slate-900/90 border border-emerald-500/30 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm transition-all placeholder:text-slate-600" 
          placeholder="contacto@correo.cl" 
          required
        />
      </div>

      {/* Fila 3: Dirección de Retiro (Comuna + Calle y Número) */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 space-y-0">
        <div className="sm:col-span-5 space-y-1.5">
          <label className="text-xs font-semibold text-emerald-200 uppercase tracking-wider flex items-center gap-1">
            <MapPin size={12} className="text-emerald-400" /> Comuna
          </label>
          <select 
            value={comuna}
            onChange={(e) => setComuna(e.target.value)}
            className="w-full bg-slate-900/90 border border-emerald-500/30 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-emerald-400 text-sm transition-all appearance-none cursor-pointer"
          >
            {COMUNAS_CHILE.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-7 space-y-1.5">
          <label className="text-xs font-semibold text-emerald-200 uppercase tracking-wider">
            Calle y Número
          </label>
          <input 
            type="text" 
            value={calleNumero}
            onChange={(e) => setCalleNumero(e.target.value)}
            className="w-full bg-slate-900/90 border border-emerald-500/30 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm transition-all placeholder:text-slate-600" 
            placeholder="Ej: Av. Las Torres 1234, Block B" 
            required
          />
        </div>
      </div>

      {/* Fila 4: Tipo de Residuos Reciclables */}
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-emerald-200 uppercase tracking-wider">Tipo de Residuos Reciclables</label>
        <select 
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
          className="w-full bg-slate-900/90 border border-emerald-500/30 rounded-xl px-3.5 py-2.5 text-white focus:outline-none focus:border-emerald-400 text-sm transition-all appearance-none cursor-pointer"
        >
          <option>Botellas de Bebida (PET 1)</option>
          <option>Envases de Alimentos / Frascos</option>
          <option>Plásticos Mixtos (PEAD / PP)</option>
          <option>Cartón y Papel Limpio</option>
          <option>Latas de Aluminio y Conserva</option>
          <option>Vidrio (Botellas y Frascos)</option>
          <option>RAEE (Electrodomésticos pequeños)</option>
          <option>Mix Domiciliario Multimaterial</option>
        </select>
      </div>

      {/* Botón de Envío Verde Ciudadano */}
      <div className="pt-2 mt-auto">
        <button 
          type="submit" 
          disabled={loading}
          className="w-full bg-gradient-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 disabled:opacity-50 text-slate-950 font-extrabold py-3.5 px-6 rounded-xl shadow-lg shadow-emerald-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-[0.99]"
        >
          <span>{loading ? 'Agendando retiro...' : 'Agendar Retiro Ciudadano B2C'}</span>
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Footer Legal B2C */}
      <div className="flex items-center justify-center gap-2 text-slate-400 text-xs pt-1 border-t border-slate-800/60">
        <ShieldCheck size={14} className="text-emerald-400" />
        <span>Datos personales protegidos bajo la <strong>Ley N° 21.719</strong></span>
      </div>

    </form>
  );
}