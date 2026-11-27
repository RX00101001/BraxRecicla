"use client";

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import type { User } from '@supabase/supabase-js';
import { getErpAccess, type ErpRole } from '@/lib/erp-access';
import { Truck, Map, ShieldCheck, Users, DollarSign, LogOut, Recycle, ExternalLink, Sun, Moon, Navigation } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface SidebarProps {
  currentPath: string;
}

export default function BraxSidebar({ currentPath }: SidebarProps) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<ErpRole | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Inicializar estado de Tema (Día / Noche)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('brax-theme') as 'dark' | 'light' | null;
      if (saved) {
        setTheme(saved);
      }
    }
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    if (typeof window !== 'undefined') {
      localStorage.setItem('brax-theme', nextTheme);
      if (nextTheme === 'light') {
        document.documentElement.classList.remove('dark');
        document.documentElement.classList.add('light');
      } else {
        document.documentElement.classList.remove('light');
        document.documentElement.classList.add('dark');
      }
    }
  };

  useEffect(() => {
    let active = true;
    let request = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function verifyAccess() {
      const current = ++request;
      try {
        const access = await getErpAccess();
        if (!active || current !== request) return;
        if (!access) {
          window.location.replace('/');
          return;
        }
        setCurrentUser(access.user);
        setUserRole(access.role);
        const { role } = access;
        if (role === 'chofer' && currentPath !== '/rutas') window.location.replace('/rutas/');
        else if (currentPath === '/finanzas' && role !== 'dueno') window.location.replace('/');
        else if ((currentPath === '/certificados' || currentPath === '/ciudadanos') && role === 'operador') {
          window.location.replace('/pesaje/');
        }
      } catch (error) {
        if (active && current === request) {
          setCurrentUser(null);
          setUserRole(null);
          console.error('Error verificando el acceso al ERP:', error);
        }
      }
    }
    void verifyAccess();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      // Supabase holds its session lock while delivering the event.
      clearTimeout(timer);
      ++request;
      timer = setTimeout(() => { void verifyAccess(); }, 0);
    });
    return () => {
      active = false;
      clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, [currentPath]);

  const handleSignOut = async () => {
    try {
      const savedRoutes = localStorage.getItem('brax-rutas-planificadas');
      const savedTheme = localStorage.getItem('brax-theme');
      localStorage.clear();
      if (savedRoutes) localStorage.setItem('brax-rutas-planificadas', savedRoutes);
      if (savedTheme) localStorage.setItem('brax-theme', savedTheme);
      sessionStorage.clear();
      await supabase.auth.signOut();
    } finally {
      window.location.replace('/');
    }
  };

  return (
    <aside className="w-64 bg-[#0a0f1d] border-r border-slate-800/80 flex flex-col shrink-0 h-screen sticky top-0 z-20">
      
      {/* HEADER: LOGO GIRATORIO DE BRAXRECICLA CON REDIRECCIÓN AL INICIO DE BRAXPANEL */}
      <div className="h-20 flex items-center px-4 border-b border-slate-800/80 bg-slate-950/60">
        <Link 
          href="/" 
          title="Ir al inicio de BraxPanel (braxpanel.braxrecicla.cl)"
          className="flex items-center gap-3 group w-full p-2 rounded-xl hover:bg-slate-900/80 transition-all border border-transparent hover:border-emerald-500/20"
        >
          {/* Contenedor del logo de reciclaje giratorio */}
          <div className="w-10 h-10 rounded-xl border border-emerald-400/40 p-1 bg-emerald-950/40 shadow-lg shadow-emerald-500/20 flex items-center justify-center text-emerald-400 overflow-hidden shrink-0 group-hover:scale-105 transition-transform">
            <Recycle 
              size={22} 
              strokeWidth={2.4} 
              className="animate-spin-slow transition-transform filter drop-shadow-[0_0_8px_rgba(16,185,129,0.7)]" 
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between">
              <span className="font-extrabold tracking-tight text-base text-slate-900 dark:text-white flex items-center gap-1">
                Brax<span className="text-emerald-600 dark:text-emerald-400">Recicla</span>
              </span>
              <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30">
                Panel
              </span>
            </div>
            <p className="text-[9px] text-emerald-700 dark:text-emerald-300 font-semibold tracking-wider uppercase truncate mt-0.5 flex items-center gap-1 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Economía Circular</span>
            </p>
          </div>
        </Link>
      </div>
      
      {/* MENÚ DE NAVEGACIÓN INDUSTRIAL */}
      <nav className="flex-1 py-6 px-3 flex flex-col gap-1.5 overflow-y-auto">
        {userRole === 'chofer' ? (
          <>
            <div className="px-3 pb-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              Operación en Terreno
            </div>

            <Link 
              href="/rutas/" 
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shadow-sm shadow-emerald-950/50"
            >
              <Navigation size={18} className="text-emerald-400" /> 
              <span>Mi Hoja de Ruta</span>
            </Link>
          </>
        ) : (
          <>
            <div className="px-3 pb-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
              Módulos Operativos
            </div>

            <Link 
              href="/" 
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm ${
                currentPath === '/' 
                  ? 'bg-emerald-100 text-emerald-950 border border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30 font-bold shadow-xs' 
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900/60 dark:hover:text-slate-200 font-medium border border-transparent'
              }`}
            >
              <Map size={18} className={currentPath === '/' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400'} /> 
              <span>Principal / Monitoreo</span>
            </Link>

            <Link 
              href="/pesaje/" 
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm ${
                currentPath === '/pesaje' 
                  ? 'bg-emerald-100 text-emerald-950 border border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30 font-bold shadow-xs' 
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900/60 dark:hover:text-slate-200 font-medium border border-transparent'
              }`}
            >
              <Truck size={18} className={currentPath === '/pesaje' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400'} /> 
              <span>Romana (Báscula)</span>
            </Link>

            <Link 
              href="/rutas/" 
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm ${
                currentPath === '/rutas' 
                  ? 'bg-emerald-100 text-emerald-950 border border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30 font-bold shadow-xs' 
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900/60 dark:hover:text-slate-200 font-medium border border-transparent'
              }`}
            >
              <Navigation size={18} className={currentPath === '/rutas' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400'} /> 
              <span>Logística & Rutas</span>
            </Link>

            {(userRole === 'admin' || userRole === 'dueno') && (
              <>
                <div className="px-3 pt-3 pb-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  Auditoría & Legal
                </div>

                <Link 
                  href="/certificados/" 
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm ${
                    currentPath === '/certificados' 
                      ? 'bg-emerald-100 text-emerald-950 border border-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30 font-bold shadow-xs' 
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900/60 dark:hover:text-slate-200 font-medium border border-transparent'
                  }`}
                >
                  <ShieldCheck size={18} className={currentPath === '/certificados' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400'} /> 
                  <span>Certificados Clientes</span>
                </Link>

                <Link 
                  href="/ciudadanos/" 
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-sm ${
                    currentPath === '/ciudadanos' 
                      ? 'bg-blue-100 text-blue-950 border border-blue-300 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30 font-bold shadow-xs' 
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900/60 dark:hover:text-slate-200 font-medium border border-transparent'
                  }`}
                >
                  <Users size={18} className={currentPath === '/ciudadanos' ? 'text-blue-700 dark:text-blue-400' : 'text-slate-400'} /> 
                  <span>Ciudadanos (Privacidad)</span>
                </Link>
              </>
            )}

            {userRole === 'dueno' && (
              <>
                <div className="px-3 pt-3 pb-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  Gerencia
                </div>
                <Link 
                  href="/finanzas/" 
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all text-sm ${
                    currentPath === '/finanzas'
                      ? 'bg-amber-100 text-amber-950 border-amber-300 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/40 font-bold shadow-xs'
                      : 'text-amber-800 hover:bg-amber-50 border-amber-200 dark:text-amber-400/90 dark:hover:bg-amber-950/30 dark:border-amber-500/20 font-medium'
                  }`}
                >
                  <DollarSign size={18} className="text-amber-700 dark:text-amber-400" /> 
                  <span>Finanzas y Balances</span>
                </Link>
              </>
            )}
          </>
        )}
      </nav>
      
      {/* FOOTER DE USUARIO Y CIERRE DE SESIÓN */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-950/40">
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs text-white uppercase shadow-md ${
            userRole === 'dueno' ? 'bg-amber-600 shadow-amber-900/30' : 
            userRole === 'admin' ? 'bg-blue-600 shadow-blue-900/30' : 
            userRole === 'chofer' ? 'bg-cyan-600 shadow-cyan-900/30' :
            'bg-emerald-700 shadow-emerald-900/30'
          }`}>
            {currentUser?.email?.[0] || 'U'}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-xs font-semibold truncate text-slate-800 dark:text-slate-200">{currentUser?.email || 'Verificando...'}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wider ${
              userRole === 'dueno' ? 'text-amber-800 dark:text-amber-400' : 
              userRole === 'admin' ? 'text-blue-800 dark:text-blue-400' : 
              userRole === 'chofer' ? 'text-cyan-800 dark:text-cyan-400' :
              'text-emerald-800 dark:text-emerald-400'
            }`}>
              Rol: {
                userRole === 'dueno' ? 'Dueño (Total)' : 
                userRole === 'admin' ? 'Administrador' : 
                userRole === 'chofer' ? 'Chofer en Ruta' : 
                'Operador Báscula'
              }
            </span>
          </div>
        </div>
        {/* INTERRUPTOR MODO DÍA / MODO NOCHE */}
        <button
          type="button"
          onClick={toggleTheme}
          className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-xl transition-all mb-2 cursor-pointer border ${
            theme === 'light'
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-900 hover:bg-amber-500/20'
              : 'bg-slate-900/60 border-slate-800/80 text-slate-300 hover:bg-slate-800/80'
          }`}
          title="Alternar entre Modo Día y Modo Noche"
        >
          <div className="flex items-center gap-2">
            {theme === 'light' ? (
              <Sun size={15} className="text-amber-500 animate-spin-slow" />
            ) : (
              <Moon size={15} className="text-emerald-400" />
            )}
            <span className="font-medium">
              {theme === 'light' ? 'Modo Día (Activo)' : 'Modo Noche (Activo)'}
            </span>
          </div>
          <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
            theme === 'light'
              ? 'bg-amber-100 text-amber-800 border-amber-300'
              : 'bg-slate-800 text-slate-300 border-slate-700/60'
          }`}>
            {theme === 'light' ? '☀️ Claro' : '🌙 Oscuro'}
          </span>
        </button>

        <button
          onClick={handleSignOut}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-slate-400 hover:text-red-400 hover:bg-red-950/30 border border-transparent hover:border-red-900/40 rounded-xl transition-all text-xs font-medium cursor-pointer"
        >
          <LogOut size={14} />
          Cerrar sesión
        </button>
      </div>
    </aside>
  );
}
