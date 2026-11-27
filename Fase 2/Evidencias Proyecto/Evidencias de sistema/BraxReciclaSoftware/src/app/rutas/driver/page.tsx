'use client';

import { useEffect } from 'react';

export default function RutasDriverPage() {
  useEffect(() => {
    window.location.replace('/rutas/?tab=chofer');
  }, []);

  return (
    <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center text-slate-300 font-sans">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs text-emerald-400 font-mono">Cargando Hoja de Ruta para Conductor...</p>
      </div>
    </div>
  );
}
