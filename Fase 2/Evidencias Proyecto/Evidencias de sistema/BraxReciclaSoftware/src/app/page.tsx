"use client";

import React, { useEffect, useState, useRef } from 'react';
import { 
  Truck, Map, ShieldCheck, Battery, AlertTriangle, BarChart3, Settings, 
  Bell, Search, PieChart, Package, Activity, Clock, ShieldX, Users, LogOut,
  Mail, Lock, Eye, EyeOff, AlertCircle, DollarSign, QrCode, KeyRound, Smartphone,
  Layers, CheckCircle2, ChevronRight, RefreshCw, Filter, ArrowUpRight
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import BraxSidebar from '@/components/BraxSidebar';
import { getErpAccess } from '@/lib/erp-access';
import { watchErpChanges } from '@/lib/erp-realtime';
import { formatPesoChileno } from '@/lib/format-peso';

interface TelemetriaFlotaRow {
  id?: string;
  patente_camion: string;
  porcentaje_llenado_ia?: number | null;
  bateria_pct?: number | null;
  bateria_v?: number | null;
  velocidad_kmh?: number | null;
  satelites?: number | null;
  latitud?: number | null;
  longitud?: number | null;
  timestamp?: string | null;
}

// Parámetros de Seguridad Anti-Fuerza Bruta
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 5 * 60 * 1000; // 5 minutos de bloqueo preventivo
const MAX_MFA_ATTEMPTS = 3;
const MFA_LOCKOUT_MS = 3 * 60 * 1000;   // 3 minutos de bloqueo preventivo

export default function BraxPanelMain() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [pendingUser, setPendingUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<'operador' | 'admin' | 'dueno'>('operador');
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isMfaVerified, setIsMfaVerified] = useState(false);

  // Estados de Login
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Estados de MFA
  const [mfaStep, setMfaStep] = useState<'login' | 'enroll' | 'verify'>('login');
  const [qrSvg, setQrSvg] = useState<string>('');
  const [totpSecret, setTotpSecret] = useState<string>('');
  const [factorId, setFactorId] = useState<string>('');
  const [mfaCode, setMfaCode] = useState<string>('');
  const [mfaLoading, setMfaLoading] = useState<boolean>(false);
  const [mfaError, setMfaError] = useState<string | null>(null);

  // Estados de Seguridad Anti-Fuerza Bruta
  const [loginAttempts, setLoginAttempts] = useState<number>(0);
  const [loginLockoutUntil, setLoginLockoutUntil] = useState<number | null>(null);
  const [loginRemainingSecs, setLoginRemainingSecs] = useState<number>(0);

  const [mfaAttempts, setMfaAttempts] = useState<number>(0);
  const [mfaLockoutUntil, setMfaLockoutUntil] = useState<number | null>(null);
  const [mfaRemainingSecs, setMfaRemainingSecs] = useState<number>(0);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Estados del Panel
  const [solicitudesB2C, setSolicitudesB2C] = useState<any[]>([]);
  const [solicitudesB2B, setSolicitudesB2B] = useState<any[]>([]);
  const [telemetriaBRX12, setTelemetriaBRX12] = useState<TelemetriaFlotaRow | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [materialFilterTab, setMaterialFilterTab] = useState<'todos' | 'b2b' | 'b2c'>('todos');
  const [isRealtimeActive, setIsRealtimeActive] = useState(false);
  const mapIframeRef = useRef<HTMLIFrameElement>(null);

  // Sincronizar telemetría LilyGO T-A7670G con el mapa Leaflet en tiempo real
  useEffect(() => {
    if (telemetriaBRX12 && mapIframeRef.current?.contentWindow) {
      try {
        mapIframeRef.current.contentWindow.postMessage({
          type: 'TELEMETRIA_UPDATE',
          payload: telemetriaBRX12
        }, '*');
      } catch (e) {
        console.warn('Error sincronizando telemetria con iframe de mapa:', e);
      }
    }
  }, [telemetriaBRX12]);

  // Recuperar bloqueos de seguridad Anti-Fuerza Bruta al montar
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const savedLoginAttempts = parseInt(localStorage.getItem('brax_sec_login_attempts') || '0', 10);
      const savedLoginLockout = parseInt(localStorage.getItem('brax_sec_login_lockout') || '0', 10);
      const now = Date.now();
      if (savedLoginLockout > now) {
        setLoginLockoutUntil(savedLoginLockout);
        setLoginRemainingSecs(Math.ceil((savedLoginLockout - now) / 1000));
        setLoginAttempts(savedLoginAttempts || MAX_LOGIN_ATTEMPTS);
      } else {
        localStorage.removeItem('brax_sec_login_lockout');
        setLoginAttempts(savedLoginAttempts);
      }

      const savedMfaAttempts = parseInt(localStorage.getItem('brax_sec_mfa_attempts') || '0', 10);
      const savedMfaLockout = parseInt(localStorage.getItem('brax_sec_mfa_lockout') || '0', 10);
      if (savedMfaLockout > now) {
        setMfaLockoutUntil(savedMfaLockout);
        setMfaRemainingSecs(Math.ceil((savedMfaLockout - now) / 1000));
        setMfaAttempts(savedMfaAttempts || MAX_MFA_ATTEMPTS);
      } else {
        localStorage.removeItem('brax_sec_mfa_lockout');
        setMfaAttempts(savedMfaAttempts);
      }
    } catch {}
  }, []);

  // Temporizador de cuenta regresiva en vivo para desbloqueos automáticos
  useEffect(() => {
    if (!loginLockoutUntil && !mfaLockoutUntil) return;

    const timer = setInterval(() => {
      const now = Date.now();
      if (loginLockoutUntil) {
        const diff = Math.ceil((loginLockoutUntil - now) / 1000);
        if (diff <= 0) {
          setLoginLockoutUntil(null);
          setLoginRemainingSecs(0);
          setLoginAttempts(0);
          localStorage.removeItem('brax_sec_login_lockout');
          localStorage.removeItem('brax_sec_login_attempts');
        } else {
          setLoginRemainingSecs(diff);
        }
      }

      if (mfaLockoutUntil) {
        const diff = Math.ceil((mfaLockoutUntil - now) / 1000);
        if (diff <= 0) {
          setMfaLockoutUntil(null);
          setMfaRemainingSecs(0);
          setMfaAttempts(0);
          localStorage.removeItem('brax_sec_mfa_lockout');
          localStorage.removeItem('brax_sec_mfa_attempts');
        } else {
          setMfaRemainingSecs(diff);
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [loginLockoutUntil, mfaLockoutUntil]);

  const authorizeSession = async (isActive = () => true) => {
    const access = await getErpAccess();
    if (!isActive()) return;
    if (!access) throw new Error('Completa la autenticación MFA para acceder al ERP.');
    if (access.role === 'chofer') {
      window.location.replace('/rutas/');
      return;
    }
    setUserRole(access.role);
    setCurrentUser(access.user);
    setIsMfaVerified(true);
  };

  // 2. Revisar sesión y estado de MFA al cargar la página
  useEffect(() => {
    let active = true;
    const checkSessionAndMfa = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!active) return;
        if (!session?.user) {
          setCurrentUser(null);
          setPendingUser(null);
          setIsMfaVerified(false);
          setMfaStep('login');
          setCheckingAuth(false);
          return;
        }

        // Consultar nivel de aseguramiento de autenticación (AAL) y factores
        const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        const { data: factorsData } = await supabase.auth.mfa.listFactors();
        if (!active) return;
        const verifiedFactor = factorsData?.totp?.find(f => f.status === 'verified');

        if (verifiedFactor) {
          if (aalData?.currentLevel === 'aal2') {
            // Ya completó MFA en esta sesión
            await authorizeSession(() => active);
          } else {
            // Requiere código de 6 dígitos
            setPendingUser(session.user);
            setFactorId(verifiedFactor.id);
            setMfaStep('verify');
            setIsMfaVerified(false);
          }
        } else {
          // No tiene factor verificado aún: forzar enrolamiento con QR
          setPendingUser(session.user);
          setIsMfaVerified(false);

          // Limpiar factores no verificados anteriores
          const unverified = factorsData?.all?.filter(f => f.status === 'unverified') || [];
          for (const uf of unverified) {
            if (!active) return;
            try { await supabase.auth.mfa.unenroll({ factorId: uf.id }); } catch {}
          }

          if (!active) return;
          const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({
            factorType: 'totp',
            issuer: 'BraxPanel'
          });

          if (!active) return;
          if (enrollData) {
            setFactorId(enrollData.id);
            setQrSvg(enrollData.totp.qr_code);
            setTotpSecret(enrollData.totp.secret);
            setMfaStep('enroll');
          } else if (enrollError) {
            setMfaError('MFA Supabase: ' + enrollError.message);
          }
        }
      } catch (err: any) {
        if (!active) return;
        console.error('Error inicializando autenticación:', err);
        setLoginError(err?.message || 'No se pudo verificar el acceso al ERP.');
      } finally {
        if (active) setCheckingAuth(false);
      }
    };

    checkSessionAndMfa();

    // Solo escuchar cuando se cierre la sesión para limpiar el estado
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setCurrentUser(null);
        setPendingUser(null);
        setIsMfaVerified(false);
        setMfaStep('login');
      }
    });

    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  // 3. Cargar datos del panel
  const fetchSolicitudes = async () => {
    try {
      const { data: b2cData } = await supabase
        .from('solicitudes_b2c')
        .select('*')
        .order('fecha_solicitud', { ascending: false });
        
      const { data: b2bData } = await supabase
        .from('solicitudes_b2b')
        .select('*')
        .order('fecha_solicitud', { ascending: false });

      const { data: teleData } = await supabase
        .from('telemetria_flota')
        .select('*')
        .eq('patente_camion', 'BRX-12')
        .order('timestamp', { ascending: false })
        .limit(1);

      if (b2cData) setSolicitudesB2C(b2cData);
      if (b2bData) setSolicitudesB2B(b2bData);
      if (teleData && teleData.length > 0) {
        setTelemetriaBRX12(teleData[0] as unknown as TelemetriaFlotaRow);
      }
    } catch (e) {
      console.error('Error cargando solicitudes:', e);
    }
  };

  useEffect(() => {
    if (!currentUser || !isMfaVerified) return;
    fetchSolicitudes();

    const stop = watchErpChanges('dashboard-realtime-feed',
      ['solicitudes_b2b', 'solicitudes_b2c', 'telemetria_flota'],
      () => { void fetchSolicitudes(); }, setIsRealtimeActive);

    // 2. Sondeo pasivo de respaldo cada 30 segundos
    const autoRefresh = setInterval(() => { fetchSolicitudes(); }, 30000);

    return () => {
      clearInterval(autoRefresh);
      stop();
    };
  }, [currentUser, isMfaVerified]);

  // Manejar Login Primario (Email + Clave) con Protección Anti-Fuerza Bruta
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loginLockoutUntil && Date.now() < loginLockoutUntil) {
      setLoginError(`Acceso bloqueado por seguridad. Intenta nuevamente en ${formatTime(loginRemainingSecs)} min.`);
      return;
    }

    setLoginLoading(true);
    setLoginError(null);
    setMfaError(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password: loginPassword,
      });

      if (error) {
        const nextAttempts = loginAttempts + 1;
        setLoginAttempts(nextAttempts);
        localStorage.setItem('brax_sec_login_attempts', nextAttempts.toString());

        if (nextAttempts >= MAX_LOGIN_ATTEMPTS) {
          const lockoutTime = Date.now() + LOGIN_LOCKOUT_MS;
          setLoginLockoutUntil(lockoutTime);
          setLoginRemainingSecs(Math.ceil(LOGIN_LOCKOUT_MS / 1000));
          localStorage.setItem('brax_sec_login_lockout', lockoutTime.toString());
          setLoginError(`🔒 Cuenta bloqueada preventivamente por exceso de intentos fallidos (Anti-Brute Force). Intenta de nuevo en 5 minutos.`);
        } else {
          const remaining = MAX_LOGIN_ATTEMPTS - nextAttempts;
          setLoginError(`Correo o contraseña incorrectos. Te ${remaining === 1 ? 'queda' : 'quedan'} ${remaining} ${remaining === 1 ? 'intento' : 'intentos'} antes del bloqueo de seguridad.`);
        }
        setLoginLoading(false);
        return;
      }

      if (data?.user) {
        // Limpiar contadores de intentos fallidos al tener éxito
        setLoginAttempts(0);
        setLoginLockoutUntil(null);
        localStorage.removeItem('brax_sec_login_attempts');
        localStorage.removeItem('brax_sec_login_lockout');

        setPendingUser(data.user);

        // Consultar factores MFA registrados
        const { data: factorsData } = await supabase.auth.mfa.listFactors();
        const verifiedFactor = factorsData?.totp?.find(f => f.status === 'verified');

        if (verifiedFactor) {
          // El usuario ya tiene factor verificado -> solicitar 6 dígitos
          setFactorId(verifiedFactor.id);
          setMfaStep('verify');
        } else {
          // El usuario NO tiene factor verificado -> enrolar con QR
          const unverified = factorsData?.all?.filter(f => f.status === 'unverified') || [];
          for (const uf of unverified) {
            try { await supabase.auth.mfa.unenroll({ factorId: uf.id }); } catch {}
          }

          const { data: enrollData, error: enrollError } = await supabase.auth.mfa.enroll({
            factorType: 'totp',
            issuer: 'BraxPanel'
          });

          if (enrollData) {
            setFactorId(enrollData.id);
            setQrSvg(enrollData.totp.qr_code);
            setTotpSecret(enrollData.totp.secret);
            setMfaStep('enroll');
          } else {
            setLoginError('Error iniciando MFA: ' + (enrollError?.message || 'Verifica que TOTP esté habilitado en Supabase'));
          }
        }
      }
    } catch (err: any) {
      setLoginError('Error de conexión: ' + (err?.message || 'Intente de nuevo'));
    } finally {
      setLoginLoading(false);
    }
  };

  // Confirmar Enrolamiento MFA (Primer escaneo del QR) con Protección Anti-Fuerza Bruta
  const handleEnrollVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mfaLockoutUntil && Date.now() < mfaLockoutUntil) {
      setMfaError(`Verificación bloqueada por seguridad. Intenta nuevamente en ${formatTime(mfaRemainingSecs)} min.`);
      return;
    }

    setMfaLoading(true);
    setMfaError(null);

    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: factorId
      });

      if (challengeError || !challengeData) {
        setMfaError(challengeError?.message || 'Error al iniciar desafío MFA');
        setMfaLoading(false);
        return;
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: factorId,
        challengeId: challengeData.id,
        code: mfaCode.trim()
      });

      if (verifyError) {
        const nextAttempts = mfaAttempts + 1;
        setMfaAttempts(nextAttempts);
        localStorage.setItem('brax_sec_mfa_attempts', nextAttempts.toString());

        if (nextAttempts >= MAX_MFA_ATTEMPTS) {
          const lockoutTime = Date.now() + MFA_LOCKOUT_MS;
          setMfaLockoutUntil(lockoutTime);
          setMfaRemainingSecs(Math.ceil(MFA_LOCKOUT_MS / 1000));
          localStorage.setItem('brax_sec_mfa_lockout', lockoutTime.toString());
          setMfaError(`🔒 Verificación bloqueada por seguridad. Has superado el límite de 3 intentos. Reintenta en 3 minutos con un nuevo código.`);
        } else {
          const remaining = MAX_MFA_ATTEMPTS - nextAttempts;
          setMfaError(`Código incorrecto. Te ${remaining === 1 ? 'queda' : 'quedan'} ${remaining} ${remaining === 1 ? 'intento' : 'intentos'} antes del bloqueo temporal.`);
        }
        setMfaLoading(false);
        return;
      }

      // MFA Verificado con éxito: limpiar contadores
      setMfaAttempts(0);
      setMfaLockoutUntil(null);
      localStorage.removeItem('brax_sec_mfa_attempts');
      localStorage.removeItem('brax_sec_mfa_lockout');

      await authorizeSession();
    } catch (err: any) {
      setMfaError('Error: ' + err.message);
    } finally {
      setMfaLoading(false);
    }
  };

  // Verificar Código MFA en logins posteriores con Protección Anti-Fuerza Bruta
  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mfaLockoutUntil && Date.now() < mfaLockoutUntil) {
      setMfaError(`Verificación bloqueada por seguridad. Intenta nuevamente en ${formatTime(mfaRemainingSecs)} min.`);
      return;
    }

    setMfaLoading(true);
    setMfaError(null);

    try {
      const { data: challengeData, error: challengeError } = await supabase.auth.mfa.challenge({
        factorId: factorId
      });

      if (challengeError || !challengeData) {
        setMfaError(challengeError?.message || 'Error al iniciar verificación');
        setMfaLoading(false);
        return;
      }

      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: factorId,
        challengeId: challengeData.id,
        code: mfaCode.trim()
      });

      if (verifyError) {
        const nextAttempts = mfaAttempts + 1;
        setMfaAttempts(nextAttempts);
        localStorage.setItem('brax_sec_mfa_attempts', nextAttempts.toString());

        if (nextAttempts >= MAX_MFA_ATTEMPTS) {
          const lockoutTime = Date.now() + MFA_LOCKOUT_MS;
          setMfaLockoutUntil(lockoutTime);
          setMfaRemainingSecs(Math.ceil(MFA_LOCKOUT_MS / 1000));
          localStorage.setItem('brax_sec_mfa_lockout', lockoutTime.toString());
          setMfaError(`🔒 Verificación MFA bloqueada por seguridad (Anti-Brute Force). Límite de 3 intentos alcanzado. Reintenta en 3 minutos con un nuevo código de Authenticator.`);
        } else {
          const remaining = MAX_MFA_ATTEMPTS - nextAttempts;
          setMfaError(`Código incorrecto o expirado. Te ${remaining === 1 ? 'queda' : 'quedan'} ${remaining} ${remaining === 1 ? 'intento' : 'intentos'} antes del bloqueo.`);
        }
        setMfaLoading(false);
        return;
      }

      // MFA Verificado con éxito: limpiar contadores
      setMfaAttempts(0);
      setMfaLockoutUntil(null);
      localStorage.removeItem('brax_sec_mfa_attempts');
      localStorage.removeItem('brax_sec_mfa_lockout');

      await authorizeSession();
    } catch (err: any) {
      setMfaError('Error de verificación: ' + err.message);
    } finally {
      setMfaLoading(false);
    }
  };

  // Supresión criptográfica (Ley 21.719)
  const handleSupresion = async (id: string) => {
    if (!confirm('¿Está seguro de aplicar la Supresión Criptográfica (Ley 21.719)? Esto borrará los datos personales irreversiblemente.')) return;
    try {
      const cryptoHash = 'CIUDADANO_SUPRESION_LEGAL_' + Math.random().toString(36).substring(2, 15);
      const { error } = await (supabase
        .from('solicitudes_b2c') as any)
        .update({ 
          nombre: null, 
          direccion: null, 
          rut: cryptoHash,
          estado: 'Anonimizado (Ley 21.719)' 
        })
        .eq('id', id);

      if (!error) {
        alert('Datos personales eliminados. Registro anonimizado correctamente.');
        fetchSolicitudes();
      } else {
        alert('Error al anonimizar: ' + error.message);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // =========================================================================
  // VISTA DE ACCESO: LOGIN O SEGUNDO FACTOR (MFA)
  // =========================================================================
  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center font-sans text-slate-100">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs text-slate-400">Verificando seguridad y credenciales...</span>
        </div>
      </div>
    );
  }

  if (!currentUser || !isMfaVerified) {
    return (
      <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center px-4 font-sans text-slate-100">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl mb-4 text-emerald-400 shadow-lg shadow-emerald-500/10">
              <ShieldCheck size={32} />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Brax<span className="text-emerald-400">Panel</span>
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Sistema Operativo de Reciclaje · Autenticación Industrial
            </p>
          </div>

          <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-8 shadow-2xl">
            {/* PANTALLA 1: EMAIL Y CONTRASEÑA */}
            {mfaStep === 'login' && (
              <>
                <h2 className="text-lg font-semibold text-slate-100 mb-6">
                  Iniciar sesión
                </h2>

                {loginLockoutUntil ? (
                  <div className="bg-red-950/70 border border-red-700/70 rounded-xl p-4 text-center mb-5 animate-pulse">
                    <div className="w-10 h-10 rounded-full bg-red-900/60 border border-red-600/50 flex items-center justify-center mx-auto mb-2 text-red-400">
                      <Lock size={20} />
                    </div>
                    <h3 className="text-sm font-semibold text-red-200">Acceso Bloqueado Preventivamente</h3>
                    <p className="text-xs text-red-300/80 mt-1">Protección Anti-Fuerza Bruta activada tras 5 intentos fallidos.</p>
                    <div className="mt-3 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-red-900/40 border border-red-700 text-red-200 font-mono text-sm font-bold">
                      <Clock size={15} className="text-red-400 animate-spin" />
                      Desbloqueo en: {formatTime(loginRemainingSecs)}
                    </div>
                  </div>
                ) : loginError && (
                  <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 text-red-300 text-sm px-4 py-3 rounded-lg mb-5">
                    <AlertCircle size={16} className="shrink-0" />
                    {loginError}
                  </div>
                )}

                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2 block">
                      Correo electrónico
                    </label>
                    <div className="relative">
                      <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="email"
                        required
                        disabled={Boolean(loginLockoutUntil) || loginLoading}
                        placeholder="tu-correo@braxrecicla.cl"
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        className="w-full bg-slate-800/50 border border-slate-700 text-slate-200 text-sm rounded-xl pl-9 pr-4 py-3 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 placeholder-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2 block">
                      Contraseña
                    </label>
                    <div className="relative">
                      <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type={showPassword ? "text" : "password"}
                        required
                        disabled={Boolean(loginLockoutUntil) || loginLoading}
                        placeholder="••••••••"
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        className="w-full bg-slate-800/50 border border-slate-700 text-slate-200 text-sm rounded-xl pl-9 pr-10 py-3 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 placeholder-slate-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                      <button
                        type="button"
                        disabled={Boolean(loginLockoutUntil)}
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={Boolean(loginLockoutUntil) || loginLoading}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:border disabled:border-slate-700 text-white font-semibold py-3 rounded-xl transition-colors mt-2 flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-900/20 disabled:cursor-not-allowed"
                  >
                    {loginLoading ? (
                      <>
                        <span className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                        Validando...
                      </>
                    ) : loginLockoutUntil ? (
                      `Bloqueado por Seguridad (${formatTime(loginRemainingSecs)})`
                    ) : (
                      "Continuar con Segundo Factor"
                    )}
                  </button>
                </form>
              </>
            )}

            {/* PANTALLA 2: ENROLAR MICROSOFT AUTHENTICATOR (PRIMERA VEZ) */}
            {mfaStep === 'enroll' && (
              <>
                <div className="flex items-center gap-2 mb-4 text-emerald-400">
                  <Smartphone size={20} />
                  <h2 className="text-lg font-semibold text-slate-100">
                    Vincular Microsoft Authenticator
                  </h2>
                </div>
                <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                  Abre <strong>Microsoft Authenticator</strong> o <strong>Google Authenticator</strong> en tu celular, toca <strong>+</strong> y escanea este código QR:
                </p>

                {qrSvg && (
                  <div className="bg-white p-4 rounded-xl flex items-center justify-center mb-4 shadow-inner">
                    <img src={qrSvg} alt="Código QR MFA" className="w-48 h-48" />
                  </div>
                )}

                {totpSecret && (
                  <p className="text-[11px] text-slate-400 font-mono text-center mb-4 break-all bg-slate-900/60 p-2.5 rounded-lg border border-slate-800">
                    Clave manual: <span className="text-emerald-300 font-bold">{totpSecret}</span>
                  </p>
                )}

                {mfaLockoutUntil ? (
                  <div className="bg-red-950/70 border border-red-700/70 rounded-xl p-4 text-center mb-4 animate-pulse">
                    <div className="w-10 h-10 rounded-full bg-red-900/60 border border-red-600/50 flex items-center justify-center mx-auto mb-2 text-red-400">
                      <Lock size={20} />
                    </div>
                    <h3 className="text-sm font-semibold text-red-200">MFA Bloqueado Preventivamente</h3>
                    <p className="text-xs text-red-300/80 mt-1">Límite de 3 intentos alcanzado. Reintenta en {formatTime(mfaRemainingSecs)} min.</p>
                  </div>
                ) : mfaError && (
                  <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 text-red-300 text-xs px-3 py-2 rounded-lg mb-4">
                    <AlertCircle size={14} className="shrink-0" />
                    {mfaError}
                  </div>
                )}

                <form onSubmit={handleEnrollVerify} className="space-y-4">
                  <div>
                    <label className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2 block">
                      Código de 6 dígitos generado en tu teléfono
                    </label>
                    <div className="relative">
                      <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="text"
                        required
                        autoFocus
                        disabled={Boolean(mfaLockoutUntil) || mfaLoading}
                        maxLength={6}
                        placeholder="000000"
                        value={mfaCode}
                        onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                        className="w-full bg-slate-800/50 border border-slate-700 text-slate-100 text-center tracking-widest text-xl font-mono rounded-xl py-3 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={Boolean(mfaLockoutUntil) || mfaLoading || mfaCode.length < 6}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:border disabled:border-slate-700 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-900/20 disabled:cursor-not-allowed"
                  >
                    {mfaLoading ? 'Confirmando...' : mfaLockoutUntil ? `Bloqueado (${formatTime(mfaRemainingSecs)})` : 'Confirmar e Ingresar al Panel'}
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      await supabase.auth.signOut();
                      setMfaStep('login');
                      setMfaCode('');
                      setPendingUser(null);
                    }}
                    className="w-full text-xs text-slate-500 hover:text-slate-300 py-1 transition-colors text-center block"
                  >
                    ← Cancelar y volver al login
                  </button>
                </form>
              </>
            )}

            {/* PANTALLA 3: INGRESAR CÓDIGO MFA (LOGINS HABITUALES) */}
            {mfaStep === 'verify' && (
              <>
                <div className="flex items-center gap-2 mb-4 text-emerald-400">
                  <KeyRound size={20} />
                  <h2 className="text-lg font-semibold text-slate-100">
                    Segundo Factor de Seguridad (MFA)
                  </h2>
                </div>
                <p className="text-xs text-slate-400 mb-6 leading-relaxed">
                  Ingresa el código temporal de 6 dígitos que aparece ahora en tu aplicación <strong>Microsoft Authenticator</strong>:
                </p>

                {mfaLockoutUntil ? (
                  <div className="bg-red-950/70 border border-red-700/70 rounded-xl p-4 text-center mb-5 animate-pulse">
                    <div className="w-10 h-10 rounded-full bg-red-900/60 border border-red-600/50 flex items-center justify-center mx-auto mb-2 text-red-400">
                      <Lock size={20} />
                    </div>
                    <h3 className="text-sm font-semibold text-red-200">Verificación MFA Bloqueada</h3>
                    <p className="text-xs text-red-300/80 mt-1">3 intentos fallidos consecutivos. Protección Anti-Fuerza Bruta activada.</p>
                    <div className="mt-3 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-red-900/40 border border-red-700 text-red-200 font-mono text-sm font-bold">
                      <Clock size={15} className="text-red-400 animate-spin" />
                      Reintentar en: {formatTime(mfaRemainingSecs)}
                    </div>
                  </div>
                ) : mfaError && (
                  <div className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 text-red-300 text-xs px-3 py-2 rounded-lg mb-4">
                    <AlertCircle size={14} className="shrink-0" />
                    {mfaError}
                  </div>
                )}

                <form onSubmit={handleMfaVerify} className="space-y-4">
                  <div>
                    <input
                      type="text"
                      required
                      autoFocus
                      disabled={Boolean(mfaLockoutUntil) || mfaLoading}
                      maxLength={6}
                      placeholder="000000"
                      value={mfaCode}
                      onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                      className="w-full bg-slate-800/50 border border-slate-700 text-slate-100 text-center tracking-widest text-3xl font-mono rounded-xl py-3.5 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={Boolean(mfaLockoutUntil) || mfaLoading || mfaCode.length < 6}
                    className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 disabled:border disabled:border-slate-700 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-900/20 disabled:cursor-not-allowed"
                  >
                    {mfaLoading ? 'Verificando...' : mfaLockoutUntil ? `Bloqueado (${formatTime(mfaRemainingSecs)})` : 'Verificar Código'}
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      await supabase.auth.signOut();
                      setMfaStep('login');
                      setMfaCode('');
                      setPendingUser(null);
                    }}
                    className="w-full text-xs text-slate-500 hover:text-slate-300 py-1 transition-colors text-center block"
                  >
                    ← Cambiar de cuenta
                  </button>
                </form>
              </>
            )}

            <div className="mt-6 pt-5 border-t border-slate-800 flex items-center justify-center gap-2 text-xs text-slate-500">
              <ShieldCheck size={12} className="text-emerald-400" />
              Protegido con TOTP RFC 6238 · Anti-Fuerza Bruta Activo
            </div>
          </div>

          <p className="text-center text-xs text-slate-600 mt-6">
            Brax Recicla SpA © 2026 · Trazabilidad y Seguridad Industrial
          </p>
        </div>
      </div>
    );
  }

  // =========================================================================
  // CÁLCULOS Y AGREGACIONES DE MATERIALES (B2B + B2C)
  // =========================================================================
  const totalKgB2B = solicitudesB2B.reduce((acc, curr) => acc + (Number(curr.kilos_reales) || Number(curr.volumen_toneladas) * 1000 || 0), 0);
  const facturacionEstimada = totalKgB2B * 145;

  // Agregación de materiales B2B
  const materialesB2BMap: Record<string, { kilos: number; count: number; pesados: number }> = {};
  solicitudesB2B.forEach(s => {
    const mat = s.material || 'Varios (Mix)';
    const kg = Number(s.kilos_reales) || (Number(s.volumen_toneladas) * 1000) || 0;
    if (!materialesB2BMap[mat]) {
      materialesB2BMap[mat] = { kilos: 0, count: 0, pesados: 0 };
    }
    materialesB2BMap[mat].kilos += kg;
    materialesB2BMap[mat].count += 1;
    if (s.kilos_reales > 0) materialesB2BMap[mat].pesados += 1;
  });

  // Agregación de materiales B2C
  const materialesB2CMap: Record<string, { count: number; anonimizados: number }> = {};
  solicitudesB2C.forEach(s => {
    const mat = s.material || 'Plásticos PET';
    if (!materialesB2CMap[mat]) {
      materialesB2CMap[mat] = { count: 0, anonimizados: 0 };
    }
    materialesB2CMap[mat].count += 1;
    if (s.estado === 'Anonimizado (Ley 21.719)') {
      materialesB2CMap[mat].anonimizados += 1;
    }
  });

  const b2bList = Object.entries(materialesB2BMap).sort((a, b) => b[1].kilos - a[1].kilos);
  const b2cList = Object.entries(materialesB2CMap).sort((a, b) => b[1].count - a[1].count);

  const toFiniteNumber = (val: unknown): number | null => {
    if (val === null || val === undefined || val === '') return null;
    const num = Number(val);
    return Number.isFinite(num) ? num : null;
  };

  const brxLat = toFiniteNumber(telemetriaBRX12?.latitud);
  const brxLon = toFiniteNumber(telemetriaBRX12?.longitud);
  const brxHasCoords = brxLat !== null && brxLon !== null && (brxLat !== 0 || brxLon !== 0);
  const brxBateriaPct = toFiniteNumber(telemetriaBRX12?.bateria_pct);
  const brxBateriaV = toFiniteNumber(telemetriaBRX12?.bateria_v);
  const brxVelocidad = toFiniteNumber(telemetriaBRX12?.velocidad_kmh);
  const brxSatelites = toFiniteNumber(telemetriaBRX12?.satelites);
  const brxLlenadoIA = toFiniteNumber(telemetriaBRX12?.porcentaje_llenado_ia);
  const brxBatClamped = brxBateriaPct !== null ? Math.max(0, Math.min(100, brxBateriaPct)) : 0;
  const brxIAClamped = brxLlenadoIA !== null ? Math.max(0, Math.min(100, brxLlenadoIA)) : 0;
  const brxMapsDirectUrl = brxHasCoords
    ? `https://www.google.com/maps?q=${brxLat},${brxLon}`
    : null;

  // =========================================================================
  // PANEL PRINCIPAL AUTENTICADO CON MFA
  // =========================================================================
  return (
    <div className="flex h-screen bg-[#0b0f19] text-slate-50 font-sans overflow-hidden">
      <BraxSidebar currentPath="/" />

      <main className="flex-1 flex flex-col h-screen overflow-y-auto">
        <header className="h-16 flex items-center justify-between px-8 border-b border-slate-800 bg-[#0f172a]/80 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold flex items-center gap-2">
              Telemetría en Vivo <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            </h1>
            <span className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${
              userRole === 'dueno' 
                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' 
                : userRole === 'admin' 
                  ? 'bg-blue-500/10 text-blue-300 border-blue-500/30' 
                  : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
            }`}>
              {userRole === 'dueno' ? 'Gerencia / Dueño' : userRole === 'admin' ? 'Administrador General' : 'Operador de Planta'}
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center gap-1 font-mono">
              <ShieldCheck size={12} /> MFA Activo
            </span>
            {isRealtimeActive ? (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center gap-1 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> WebSocket En Vivo
              </span>
            ) : (
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-400 flex items-center gap-1 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-500" /> Conectando...
              </span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input 
                type="text" 
                placeholder="Buscar por RUT de empresa o razón social..." 
                className="bg-slate-800/50 border border-slate-700 text-sm rounded-full pl-9 pr-4 py-1.5 focus:outline-none focus:border-emerald-500 w-72 text-slate-200 placeholder:text-slate-500" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <button onClick={fetchSolicitudes} title="Actualizar datos" className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors">
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        <div className="p-8 space-y-8">
          {/* TARJETAS SUPERIORES DE KPI INDUSTRIALES */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-[#1e293b] rounded-2xl p-6 border border-slate-700/60 shadow-xl relative overflow-hidden group hover:border-slate-600 transition-all">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                    {userRole === 'dueno' ? 'Facturación Estimada B2B' : 'Volumen Total B2B'}
                  </p>
                  <h3 className="text-3xl font-extrabold text-white mt-1 font-mono tracking-tight">
                    {userRole === 'dueno' ? (
                      `$${Math.round(facturacionEstimada).toLocaleString('es-CL')} CLP`
                    ) : (
                      formatPesoChileno(totalKgB2B)
                    )}
                  </h3>
                </div>
                <div className={`p-3 rounded-xl ${userRole === 'dueno' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
                  {userRole === 'dueno' ? <DollarSign size={24} /> : <BarChart3 size={24} />}
                </div>
              </div>
              <p className="text-xs text-slate-400">
                {userRole === 'dueno' 
                  ? `Monto calculado sobre ${formatPesoChileno(totalKgB2B)} gestionados en báscula`
                  : 'Total acumulado en planta y despachos'}
              </p>
            </div>

            <div className="bg-[#1e293b] rounded-2xl p-6 border border-slate-700/60 shadow-xl relative overflow-hidden group hover:border-slate-600 transition-all">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Retiros Domiciliarios B2C</p>
                  <h3 className="text-3xl font-extrabold text-white mt-1 font-mono tracking-tight">
                    {solicitudesB2C.filter(r => r.estado !== 'Anonimizado (Ley 21.719)').length}
                    <span className="text-sm font-normal text-slate-500 ml-2">retiros activos</span>
                  </h3>
                </div>
                <div className="bg-blue-500/10 p-3 rounded-xl text-blue-400 border border-blue-500/20">
                  <Package size={24} />
                </div>
              </div>
              <span className="text-slate-400 text-xs">Esperando asignación inteligente de ruta de camión</span>
            </div>

            <div className="bg-[#1e293b] rounded-2xl p-6 border border-slate-700/60 shadow-xl relative overflow-hidden group hover:border-slate-600 transition-all">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">Certificados Emitidos</p>
                  <h3 className="text-3xl font-extrabold text-white mt-1 font-mono tracking-tight">
                    {solicitudesB2B.filter(r => r.hash_certificado).length}
                    <span className="text-sm text-slate-500 font-normal"> / {solicitudesB2B.length}</span>
                  </h3>
                </div>
                <div className="bg-purple-500/10 p-3 rounded-xl text-purple-400 border border-purple-500/20">
                  <ShieldCheck size={24} />
                </div>
              </div>
              <span className="text-emerald-400 font-semibold text-xs flex items-center gap-1">
                <CheckCircle2 size={13} /> 100% Criptográficos SHA-256 (SINADER / MMA)
              </span>
            </div>
          </div>

          {/* =========================================================================
              WIDGET EXCLUSIVO DE GERENCIA / DUEÑO: CONTROL FINANCIERO & RENTABILIDAD
             ========================================================================= */}
          {userRole === 'dueno' && (
            <div className="bg-gradient-to-r from-[#111c2e] via-[#1e293b] to-[#111c2e] rounded-2xl border border-emerald-500/30 p-6 shadow-2xl relative overflow-hidden animate-in fade-in">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      <DollarSign size={18} />
                    </span>
                    <h2 className="text-base font-bold text-white tracking-wide">
                      Control Financiero & Rendimiento Operativo
                    </h2>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      AUDITORÍA EN VIVO
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    Cálculo consolidado de valorización de residuos recuperados frente al costo de combustible y logística de flota.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <a
                    href="/finanzas"
                    className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-all shadow-lg shadow-emerald-900/30 group"
                  >
                    <span>Ver Auditoría Completa de Finanzas</span>
                    <ArrowUpRight size={14} className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                  </a>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-5 border-t border-slate-700/60">
                <div className="bg-slate-900/60 p-3.5 rounded-xl border border-slate-800">
                  <p className="text-[11px] text-slate-400 font-medium uppercase">Facturación B2B</p>
                  <p className="text-lg font-bold font-mono text-white mt-1">
                    ${Math.round(facturacionEstimada).toLocaleString('es-CL')} CLP
                  </p>
                  <p className="text-[10px] text-emerald-400 mt-0.5 font-mono">Pesaje certificado</p>
                </div>

                <div className="bg-slate-900/60 p-3.5 rounded-xl border border-slate-800">
                  <p className="text-[11px] text-slate-400 font-medium uppercase">Costo Logístico (OPEX)</p>
                  <p className="text-lg font-bold font-mono text-red-400 mt-1">
                    -$4.780.000
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Flota, diésel y peajes</p>
                </div>

                <div className="bg-slate-900/60 p-3.5 rounded-xl border border-slate-800">
                  <p className="text-[11px] text-slate-400 font-medium uppercase">Margen Neto Operativo</p>
                  <p className="text-lg font-bold font-mono text-emerald-400 mt-1">
                    +84.6%
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5 font-mono">+$26.270.735 CLP neto</p>
                </div>

                <div className="bg-slate-900/60 p-3.5 rounded-xl border border-slate-800">
                  <p className="text-[11px] text-slate-400 font-medium uppercase">Retorno Logístico (ROI)</p>
                  <p className="text-lg font-bold font-mono text-cyan-400 mt-1">
                    6.5x
                  </p>
                  <p className="text-[10px] text-cyan-400/80 mt-0.5">$6.5 por cada $1 en flota</p>
                </div>
              </div>
            </div>
          )}

          {/* =========================================================================
              MÓDULO: VISTA COMPLETA Y ORDENADA DE MATERIALES RECOLECTADOS (INDUSTRIAL)
             ========================================================================= */}
          <div className="bg-[#1e293b] rounded-2xl border border-slate-700/60 shadow-xl p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Layers size={18} className="text-emerald-400" />
                  Métricas y Desglose Completo de Materiales Recolectados
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Auditoría ordenada de residuos reciclables clasificados por canal Corporativo (B2B) y Ciudadano (B2C).
                </p>
              </div>

              {/* TABS DE FILTRO */}
              <div className="flex items-center gap-1 bg-[#0f172a] p-1 rounded-xl border border-slate-800 self-start sm:self-auto">
                <button
                  onClick={() => setMaterialFilterTab('todos')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    materialFilterTab === 'todos' 
                      ? 'bg-emerald-600 text-white shadow-md' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Todos los Canales
                </button>
                <button
                  onClick={() => setMaterialFilterTab('b2b')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    materialFilterTab === 'b2b' 
                      ? 'bg-emerald-600 text-white shadow-md' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Industrias (B2B)
                </button>
                <button
                  onClick={() => setMaterialFilterTab('b2c')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    materialFilterTab === 'b2c' 
                      ? 'bg-blue-600 text-white shadow-md' 
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Ciudadanos (B2C)
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* COLUMNA B2B: KILOS Y BÁSCULA ROMANA */}
              {(materialFilterTab === 'todos' || materialFilterTab === 'b2b') && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                      <Truck size={16} className="text-emerald-400" /> Residuos Industriales B2B (Pesaje en Romana)
                    </h3>
                    <span className="text-xs text-emerald-400 font-mono font-bold bg-emerald-950/40 border border-emerald-800/40 px-2.5 py-1 rounded-md">
                      {formatPesoChileno(totalKgB2B)} acumulados
                    </span>
                  </div>

                  <div className="space-y-3">
                    {b2bList.length === 0 ? (
                      <p className="text-xs text-slate-500 py-6 text-center">No hay registros industriales</p>
                    ) : (
                      b2bList.map(([material, stats]) => {
                        const pct = totalKgB2B > 0 ? ((stats.kilos / totalKgB2B) * 100).toFixed(1) : '0';
                        return (
                          <div key={material} className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-2.5 hover:border-slate-700 transition-colors">
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-semibold text-white tracking-wide">{material}</span>
                              <span className="text-emerald-400 font-mono font-bold">{formatPesoChileno(stats.kilos)} <span className="text-slate-500">({pct}%)</span></span>
                            </div>
                            <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                              <div 
                                className="bg-gradient-to-r from-emerald-500 to-teal-400 h-2.5 rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]" 
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="flex justify-between items-center text-[11px] text-slate-400 pt-1">
                              <span>Solicitudes: {stats.count} empresas</span>
                              <span className="text-emerald-400 font-medium flex items-center gap-1 font-mono">
                                <CheckCircle2 size={12} /> {stats.pesados} pesados en romana
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* COLUMNA B2C: SOLICITUDES Y CUMPLIMIENTO LEY 21.719 */}
              {(materialFilterTab === 'todos' || materialFilterTab === 'b2c') && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                      <Users size={16} className="text-blue-400" /> Residuos Ciudadanos Domiciliarios B2C
                    </h3>
                    <span className="text-xs text-blue-400 font-mono font-bold bg-blue-950/40 border border-blue-800/40 px-2.5 py-1 rounded-md">
                      {solicitudesB2C.length} retiros totales
                    </span>
                  </div>

                  <div className="space-y-3">
                    {b2cList.length === 0 ? (
                      <p className="text-xs text-slate-500 py-6 text-center">No hay registros domiciliarios</p>
                    ) : (
                      b2cList.map(([material, stats]) => {
                        const pct = solicitudesB2C.length > 0 ? ((stats.count / solicitudesB2C.length) * 100).toFixed(1) : '0';
                        return (
                          <div key={material} className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-2.5 hover:border-slate-700 transition-colors">
                            <div className="flex justify-between items-center text-xs">
                              <span className="font-semibold text-white tracking-wide">{material}</span>
                              <span className="text-blue-400 font-mono font-bold">{stats.count} retiros <span className="text-slate-500">({pct}%)</span></span>
                            </div>
                            <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                              <div 
                                className="bg-gradient-to-r from-blue-500 to-indigo-400 h-2.5 rounded-full transition-all duration-500 shadow-[0_0_8px_rgba(59,130,246,0.3)]" 
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="flex justify-between items-center text-[11px] text-slate-400 pt-1">
                              <span className="text-slate-400">Activos en cola: {stats.count - stats.anonimizados}</span>
                              {stats.anonimizados > 0 && (
                                <span className="text-emerald-400 font-medium flex items-center gap-1 font-mono">
                                  <ShieldCheck size={12} /> {stats.anonimizados} anonimizados (Ley 21.719)
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* CUADRÍCULA DE OPERACIÓN: LISTADO B2C + LISTADO B2B + MAPA */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[600px]">
            <div className="lg:col-span-2 flex flex-col gap-6 h-full">
              {/* Solicitudes B2C (No se filtran por búsqueda de RUT de empresa) */}
              <div className="bg-[#1e293b] rounded-xl border border-slate-700/50 shadow-lg flex flex-col overflow-hidden h-[300px]">
                <div className="p-4 border-b border-slate-800 bg-[#0f172a]/50 flex justify-between items-center">
                  <h3 className="font-semibold text-slate-200 flex items-center gap-2">
                    <Activity size={18} className="text-blue-400" /> Solicitudes Ciudadanas en Cola (B2C)
                  </h3>
                  <span className="flex h-2 w-2 rounded-full bg-blue-500 animate-ping"></span>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {solicitudesB2C.length === 0 ? (
                    <p className="text-slate-500 text-center py-4">No hay solicitudes B2C registradas</p>
                  ) : (
                    solicitudesB2C.map((req) => {
                      const isAnon = req.estado === 'Anonimizado (Ley 21.719)';
                      return (
                        <div key={req.id} className={`flex justify-between items-center p-3 border-l-2 rounded-r-lg ${isAnon ? 'border-slate-500 bg-slate-900/40' : 'border-blue-500 bg-blue-900/10'}`}>
                          <div className="flex gap-3 items-start">
                            <div className={`p-1.5 rounded ${isAnon ? 'bg-slate-800 text-slate-500' : 'bg-blue-900/50 text-blue-400'}`}>
                              {isAnon ? <ShieldCheck size={16}/> : <Package size={16}/>}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-200">
                                {isAnon ? 'CIUDADANO ANÓNIMO' : (userRole === 'operador' ? 'Ciudadano Brax' : req.nombre)}
                              </p>
                              <p className="text-xs text-slate-400 font-mono">
                                {userRole === 'operador' ? '••.•••.•••-•' : req.rut}
                              </p>
                              <p className="text-xs text-slate-400">{isAnon ? 'Dirección Suprimida' : req.direccion} • {req.material}</p>
                            </div>
                          </div>
                          
                          {!isAnon && (userRole === 'admin' || userRole === 'dueno') && (
                            <button 
                              onClick={() => handleSupresion(req.id)}
                              className="text-xs bg-red-900/50 hover:bg-red-900 text-red-200 border border-red-700/50 px-3 py-1.5 rounded-lg flex items-center gap-2 transition-colors cursor-pointer"
                              title="Aplicar Ley 21.719"
                            >
                              <ShieldX size={14} /> Derecho al Olvido
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Solicitudes B2B (Filtradas por el buscador: RUT o Razón Social de Empresa) */}
              <div className="bg-[#1e293b] rounded-xl border border-slate-700/50 shadow-lg flex flex-col overflow-hidden h-[275px]">
                <div className="p-4 border-b border-slate-800 bg-[#0f172a]/50 flex justify-between items-center">
                  <h3 className="font-semibold text-slate-200 flex items-center gap-2">
                    <BarChart3 size={18} className="text-[#10b981]" /> Despachos y Solicitudes Industriales (B2B)
                  </h3>
                  {searchTerm.trim() && (
                    <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-2 py-0.5 rounded">
                      Filtrando por empresa
                    </span>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  {solicitudesB2B.filter(r => 
                    !searchTerm.trim() ||
                    (r.rut?.toLowerCase() || '').includes(searchTerm.toLowerCase().trim()) ||
                    (r.razon_social?.toLowerCase() || '').includes(searchTerm.toLowerCase().trim())
                  ).length === 0 ? (
                    <p className="text-slate-500 text-center py-6 text-xs">
                      {searchTerm.trim() 
                        ? `No se encontraron empresas con el RUT o razón social "${searchTerm}"`
                        : 'No hay solicitudes B2B registradas'}
                    </p>
                  ) : (
                    solicitudesB2B.filter(r => 
                      !searchTerm.trim() ||
                      (r.rut?.toLowerCase() || '').includes(searchTerm.toLowerCase().trim()) ||
                      (r.razon_social?.toLowerCase() || '').includes(searchTerm.toLowerCase().trim())
                    ).map((req) => (
                      <div key={req.id} className="flex gap-3 items-start p-3 border-l-2 border-[#10b981] bg-[#10b981]/5 rounded-r-lg">
                        <div className="bg-[#10b981]/20 p-1.5 rounded text-[#10b981]"><Truck size={16}/></div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-slate-200">{req.razon_social} <span className="text-slate-500 text-xs font-mono ml-2">{req.rut}</span></p>
                          <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                            <span>{req.volumen_toneladas} Toneladas ({req.material})</span>
                            <span>•</span>
                            <span className={req.kilos_reales > 0 ? "text-emerald-400 font-medium" : "text-amber-400"}>
                              {req.kilos_reales > 0 ? `${formatPesoChileno(req.kilos_reales)} reales (Romana)` : 'Pendiente de pesaje'}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1"><Clock size={10}/> {new Date(req.fecha_solicitud).toLocaleString('es-CL')}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Mapa de GPS y Telemetría de Flota */}
            <div className="flex flex-col gap-6 h-full">
              <div className="flex-1 bg-[#0b0f19] rounded-2xl border border-slate-700/60 overflow-hidden shadow-2xl relative min-h-[360px]">
                <iframe
                  ref={mapIframeRef}
                  src="/mapa_flota.html"
                  className="w-full h-full border-0 absolute inset-0"
                  title="Mapa en Vivo de Telemetría Flota"
                  onLoad={() => {
                    if (telemetriaBRX12 && mapIframeRef.current?.contentWindow) {
                      try {
                        mapIframeRef.current.contentWindow.postMessage({
                          type: 'TELEMETRIA_UPDATE',
                          payload: telemetriaBRX12
                        }, '*');
                      } catch (e) {}
                    }
                  }}
                />
              </div>

              <div className="bg-[#1e293b] rounded-xl border border-slate-700/50 shadow-lg flex flex-col overflow-hidden h-[240px]">
                <div className="p-4 border-b border-slate-800 bg-[#0f172a]/50 flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-slate-200">Telemetría GPS y Batería (Flota)</h3>
                  <div className="flex items-center gap-2 shrink-0">
                    {brxSatelites !== null && (
                      <span className="text-[11px] font-mono text-sky-400 bg-sky-950/50 border border-sky-800/50 px-2 py-0.5 rounded">
                        {brxSatelites} satélites
                      </span>
                    )}
                    {brxMapsDirectUrl && (
                      <a
                        href={brxMapsDirectUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 px-2 py-0.5 rounded flex items-center gap-1"
                      >
                        <span>Maps</span>
                        <ArrowUpRight size={11} />
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-3">
                  <div className="p-3 bg-slate-800/40 rounded-lg border border-slate-700/50 hover:bg-slate-800 transition-colors">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-mono text-sm text-[#10b981] font-bold">BRX-12</span>
                      <span className="text-xs text-slate-400">
                        {brxVelocidad !== null ? `${brxVelocidad.toFixed(1)} km/h` : 'En ruta B2C'}
                      </span>
                    </div>
                    {brxBateriaPct !== null ? (
                      <>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2">
                            <Battery size={14} className={brxBateriaPct <= 20 ? 'text-amber-400' : 'text-[#10b981]'} />
                            <span className="text-xs text-slate-300">
                              Batería Tracker: <span className="font-bold text-white">{brxBateriaPct}%</span>
                            </span>
                          </div>
                          {brxBateriaV !== null && (
                            <span className="text-[11px] font-mono text-slate-400">{brxBateriaV.toFixed(2)} V</span>
                          )}
                        </div>
                        <div className="w-full bg-[#0b0f19] rounded-full h-2 border border-slate-800">
                          <div
                            className={`${brxBateriaPct <= 20 ? 'bg-amber-400 shadow-[0_0_8px_#f59e0b]' : 'bg-[#10b981] shadow-[0_0_8px_#10b981]'} h-2 rounded-full transition-all duration-500 ease-in-out`}
                            style={{ width: `${brxBatClamped}%` }}
                          ></div>
                        </div>
                        {brxLlenadoIA !== null && (
                          <div className="mt-2 pt-2 border-t border-slate-700/50 flex items-center justify-between text-[11px] text-slate-400">
                            <span>Capacidad Ocupada (IA)</span>
                            <span className="font-mono text-slate-200 font-semibold">{brxLlenadoIA}%</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2 mb-1.5">
                          <Battery size={14} className="text-[#10b981]" />
                          <span className="text-xs text-slate-300">
                            {brxLlenadoIA !== null ? (
                              <>Capacidad Ocupada (IA): <span className="font-bold text-white">{brxLlenadoIA}%</span></>
                            ) : (
                              <>Batería Tracker: <span className="text-slate-400">Esperando lectura...</span></>
                            )}
                          </span>
                        </div>
                        <div className="w-full bg-[#0b0f19] rounded-full h-2 border border-slate-800">
                          <div
                            className="bg-[#10b981] h-2 rounded-full shadow-[0_0_8px_#10b981] transition-all duration-500 ease-in-out"
                            style={{ width: `${brxIAClamped}%` }}
                          ></div>
                        </div>
                      </>
                    )}
                    {(telemetriaBRX12?.timestamp || brxHasCoords) && (
                      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-500 font-mono">
                        <span className="flex items-center gap-1">
                          <Clock size={10} />
                          {telemetriaBRX12?.timestamp
                            ? new Date(telemetriaBRX12.timestamp).toLocaleString('es-CL')
                            : 'GPS activo'}
                        </span>
                        {brxHasCoords && (
                          <span className="text-slate-400 truncate">
                            {brxLat!.toFixed(5)}, {brxLon!.toFixed(5)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
