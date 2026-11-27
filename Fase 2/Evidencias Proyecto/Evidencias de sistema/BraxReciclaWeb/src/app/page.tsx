'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  Users,
  Leaf,
  ShieldCheck,
  Recycle,
  Truck,
  Layers,
  MapPin,
  Mail,
  FileCheck2,
  Zap,
  Award,
  Lock,
  Scale
} from 'lucide-react';
import B2BForm from '@/components/forms/B2BForm';
import B2CForm from '@/components/forms/B2CForm';
import LegalModal, { LegalTab } from '@/components/LegalModal';

// Vueltas completas que dan las flechas al recorrer la página de arriba a abajo
const ARROW_TURNS_PER_PAGE = 1.5;

// Zoom del logo: parte grande y se achica durante el primer tramo de scroll
const LOGO_SCALE_TOP = 1.22;
const LOGO_SCALE_SCROLLED = 0.86;
const LOGO_ZOOM_DISTANCE_VH = 1.4; // cuántas alturas de pantalla dura el zoom-out
const LOGO_INTRO_SCALE = 1.5; // escala inicial de la entrada al cargar

// Resorte amortiguado (frecuencia en rad/s, zeta < 1 deja un leve rebote al asentarse)
type Spring = { value: number; velocity: number };
const stepSpring = (s: Spring, target: number, omega: number, zeta: number, dt: number) => {
  const accel = omega * omega * (target - s.value) - 2 * zeta * omega * s.velocity;
  s.velocity += accel * dt;
  s.value += s.velocity * dt;
};
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

export default function LivingBraxReciclaPage() {
  const bgCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Dos capas recortadas del logo completo: anillo de flechas (gira) y texto BRAX RECICLA (fijo encima)
  const arrowsImgRef = useRef<HTMLImageElement | null>(null);
  const textImgRef = useRef<HTMLImageElement | null>(null);
  const [logoLoaded, setLogoLoaded] = useState(false);

  // Modal Legal Interactivo
  const [legalModalOpen, setLegalModalOpen] = useState(false);
  const [legalModalTab, setLegalModalTab] = useState<LegalTab>('terms');

  const openLegalModal = (tab: LegalTab) => {
    setLegalModalTab(tab);
    setLegalModalOpen(true);
  };

  // Estado de Animación & Scroll (Giro 3D impulsado por el desplazamiento)
  const angleSpringRef = useRef<Spring>({ value: 0, velocity: 0 });
  const scaleSpringRef = useRef<Spring>({ value: LOGO_INTRO_SCALE, velocity: 0 });
  const targetAngleRef = useRef(0);
  const targetScaleRef = useRef(LOGO_SCALE_TOP);
  const scrollYRef = useRef(0);
  const mouseRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0 });

  // 1. Precarga de las dos capas del logo (ambas cuadradas y centradas en el eje de giro)
  useEffect(() => {
    let loadedCount = 0;
    const load = (src: string) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
      img.onload = () => {
        loadedCount++;
        if (loadedCount >= 2) setLogoLoaded(true);
      };
      return img;
    };
    arrowsImgRef.current = load('/logo_layers/arrows.webp?v=4');
    textImgRef.current = load('/logo_layers/text.webp?v=4');
  }, []);

  // 2. Loop de Renderizado: Logo 3D giratorio de Brax fusionado con la ciudad y reactivo al scroll
  useEffect(() => {
    if (!logoLoaded) return;

    let animId: number;

    const canvas = bgCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const startTime = performance.now();
    let lastTime = startTime;

    const render = (now: number) => {
      // Paso de tiempo real (independiente de los FPS), acotado tras pestañas en segundo plano
      const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      const t = (now - startTime) / 1000;

      const width = window.innerWidth;
      const height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // Suavizado del mouse para profundidad parallax
      mouseRef.current.x += (mouseRef.current.targetX - mouseRef.current.x) * 0.08;
      mouseRef.current.y += (mouseRef.current.targetY - mouseRef.current.y) * 0.08;
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      // Giro y zoom con resortes: cada vuelta de ruedita se convierte en un giro fluido con inercia
      const angle = angleSpringRef.current;
      const scale = scaleSpringRef.current;
      if (reducedMotion) {
        angle.value = targetAngleRef.current;
        scale.value = targetScaleRef.current;
      } else {
        stepSpring(angle, targetAngleRef.current, 5.5, 0.62, dt);
        stepSpring(scale, targetScaleRef.current, 4.2, 0.85, dt);
      }

      // Invitación a scrollear: arriba del todo el logo "respira" y se balancea levemente
      const idle = reducedMotion ? 0 : Math.max(0, 1 - scrollYRef.current / 120);
      const idleAngle = Math.sin(t * 1.4) * 0.05 * idle;
      const idleScale = 1 + Math.sin(t * 1.4 + 0.6) * 0.015 * idle;

      // Entrada suave al cargar
      const introAlpha = reducedMotion ? 1 : Math.min(1, t / 0.9);
      const logoScale = scale.value * idleScale;
      // El aura brilla más mientras las flechas giran rápido
      const spinGlow = Math.min(1, Math.abs(angle.velocity) * 0.35);

      // Aura volumétrica esmeralda fusionada con el paisaje ecológico (alta presencia y luminosidad equilibrada)
      const auraX = width * 0.5 + mx * -8;
      const auraY = height * 0.50 + my * -8;
      const auraRadius = Math.min(width, height) * 0.42 * logoScale;

      const auraGrad = ctx.createRadialGradient(auraX, auraY, 20, auraX, auraY, auraRadius);
      auraGrad.addColorStop(0, `rgba(16, 185, 129, ${(0.35 + spinGlow * 0.15) * introAlpha})`);
      auraGrad.addColorStop(0.4, `rgba(5, 150, 105, ${(0.18 + spinGlow * 0.1) * introAlpha})`);
      auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = auraGrad;
      ctx.beginPath();
      ctx.arc(auraX, auraY, auraRadius, 0, Math.PI * 2);
      ctx.fill();

      // Logo completo: flechas girando detrás y texto BRAX RECICLA fijo encima
      const arrows = arrowsImgRef.current;
      const text = textImgRef.current;
      if (arrows?.naturalWidth && text?.naturalWidth) {
        const size = Math.min(height * 0.62, width * 0.62) * logoScale;
        const cx = width * 0.5 + mx * -12;
        const cy = height * 0.5 + my * -8;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.globalAlpha = introAlpha;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle.value + idleAngle);
        ctx.drawImage(arrows, -size / 2, -size / 2, size, size);
        ctx.restore();

        ctx.drawImage(text, cx - size / 2, cy - size / 2, size, size);
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [logoLoaded]);

  // 3. Control de Scroll: Giro reactivo exclusivo al desplazamiento
  useEffect(() => {
    const handleScroll = () => {
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const currentScroll = window.scrollY;
      const progress = Math.max(0, Math.min(1, currentScroll / (maxScroll || 1)));
      scrollYRef.current = currentScroll;

      // Mapeo continuo y armónico a lo largo de toda la página (sin repeticiones ni reinicios bruscos)
      targetAngleRef.current = progress * ARROW_TURNS_PER_PAGE * Math.PI * 2;

      // Zoom-out: grande arriba, se achica en el primer tramo de scroll
      const zoomProgress = Math.min(1, currentScroll / (window.innerHeight * LOGO_ZOOM_DISTANCE_VH));
      targetScaleRef.current =
        LOGO_SCALE_TOP + (LOGO_SCALE_SCROLLED - LOGO_SCALE_TOP) * easeOutCubic(zoomProgress);
    };

    handleScroll(); // estado correcto si la página carga ya desplazada
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // 4. Parallax de Mouse
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const { clientX, clientY } = e;
    const { innerWidth, innerHeight } = window;
    mouseRef.current.targetX = (clientX / innerWidth - 0.5) * 2;
    mouseRef.current.targetY = (clientY / innerHeight - 0.5) * 2;
  };

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div
      className="relative w-full min-h-screen bg-[#030712] text-slate-100 font-sans selection:bg-emerald-500 selection:text-black overflow-x-hidden"
      onMouseMove={handleMouseMove}
    >

      {/* =========================================================================
          CAPA 1: PAISAJE ECOLÓGICO VIBRANTE + ESCUDO 3D GIRATORIO CON SCROLL
         ========================================================================= */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        {/* Ciudad ecológica fusionada */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-60 mix-blend-normal scale-105 transition-transform duration-700 ease-out"
          style={{
            backgroundImage: "url('/hero_eco_landscape.jpg')",
          }}
        />

        <div className="absolute inset-0 bg-gradient-to-b from-[#030712]/90 via-[#030712]/65 to-[#030712]/95" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#030712]/85 via-[#030712]/40 to-[#030712]/85" />
        <div className="absolute inset-0 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:40px_40px] opacity-10" />
        <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_120px_rgba(3,7,18,0.7)]" />

        {/* CANVAS VIVIENTE: LOGO 3D ROTATORIO BRAXRECICLA */}
        <canvas
          ref={bgCanvasRef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none filter drop-shadow-[0_0_40px_rgba(16,185,129,0.35)]"
        />
      </div>

      {/* =========================================================================
          HEADER FLOTANTE CON LOGO DE RECICLAJE Y CLICK PARA RETORNO
         ========================================================================= */}
      <header className="fixed top-0 left-0 w-full z-50 bg-[#030712]/85 backdrop-blur-xl border-b border-slate-800/80 px-6 sm:px-12 py-3 flex items-center justify-between transition-all">

        {/* Click en el logo y nombre vuelve al inicio suavemente */}
        <div
          onClick={scrollToTop}
          className="flex items-center gap-3.5 cursor-pointer hover:opacity-90 transition-opacity group"
          title="Volver al inicio"
        >
          <div className="w-10 h-10 rounded-2xl border border-emerald-400/40 p-1 bg-emerald-950/40 shadow-lg shadow-emerald-500/25 flex items-center justify-center text-emerald-400 overflow-hidden">
            <Recycle
              size={22}
              strokeWidth={2.4}
              className="animate-spin-slow transition-transform group-hover:scale-110 filter drop-shadow-[0_0_8px_rgba(16,185,129,0.7)]"
            />
          </div>
          <div>
            <span className="font-extrabold tracking-tight text-xl text-white flex items-center gap-1">
              Brax<span className="text-emerald-400">Recicla</span>
            </span>
            <p className="text-[10px] text-emerald-300 font-semibold tracking-wider uppercase">
              Economía Circular & Trazabilidad Oficial
            </p>
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-6 lg:gap-8 text-sm text-slate-300 font-medium">
          <button onClick={scrollToTop} className="hover:text-emerald-400 transition-colors cursor-pointer">
            Inicio
          </button>
          <button onClick={() => scrollToSection('acto-servicios')} className="hover:text-emerald-400 transition-colors cursor-pointer">
            Servicios & Logística
          </button>
          <button onClick={() => scrollToSection('acto-leyrep')} className="hover:text-emerald-400 transition-colors cursor-pointer">
            Cumplimiento Legal
          </button>
          <a
            href="/verificar/"
            className="hover:text-emerald-400 transition-colors cursor-pointer flex items-center gap-1.5 text-emerald-400/90 hover:text-emerald-300"
            title="Verificar autenticidad de certificados oficiales SINADER"
          >
            <ShieldCheck size={15} className="text-emerald-400" />
            <span>Verificar Certificado</span>
          </a>
          <button onClick={() => scrollToSection('acto-accion')} className="hover:text-emerald-400 transition-colors cursor-pointer">
            Solicitar Retiro
          </button>
        </nav>

        <div className="flex items-center gap-2.5 sm:gap-3">
          <a
            href="/verificar/"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-emerald-400 border border-emerald-500/30 hover:border-emerald-400 text-xs font-semibold transition-all shadow-sm cursor-pointer"
            title="Consultar validez de certificado oficial"
          >
            <ShieldCheck size={14} />
            <span className="hidden sm:inline">Verificar</span>
          </a>

          <button
            onClick={() => scrollToSection('acto-accion')}
            className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs sm:text-sm transition-all shadow-lg shadow-emerald-500/25 active:scale-95 flex items-center gap-1.5 cursor-pointer"
          >
            <Zap size={14} />
            <span>Agendar Retiro</span>
          </button>
        </div>
      </header>

      {/* =========================================================================
          CONTENIDO DE LA PÁGINA
         ========================================================================= */}
      <main className="relative z-10 w-full">

        {/* -----------------------------------------------------------------------
            ACTO 1: HERO LIMPIO Y FUSIONADO CON EL LOGO 3D EN EL FONDO
           ----------------------------------------------------------------------- */}
        <section id="acto-intro" className="min-h-screen flex flex-col justify-center items-center px-6 sm:px-12 pt-28 pb-16 max-w-7xl mx-auto text-center">

          <div className="space-y-6 max-w-3xl my-auto">

            {/* Badge ambiental Ley REP */}
            <div className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold tracking-wide uppercase backdrop-blur-md shadow-lg shadow-emerald-500/10 mb-2">
              <Leaf size={14} className="text-emerald-400" />
              <span>Compromiso Ambiental · Ley REP Nº 20.920</span>
            </div>

            {/* Slogan de alto impacto */}
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-black text-white tracking-tight leading-[1.08] drop-shadow-[0_4px_16px_rgba(0,0,0,0.8)]">
              Reciclaje consciente <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 via-teal-300 to-green-200">
                para cuidar nuestro planeta.
              </span>
            </h1>

            <p className="text-slate-200 text-base sm:text-lg lg:text-xl font-normal leading-relaxed drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] max-w-2xl mx-auto bg-slate-950/40 p-4 rounded-2xl backdrop-blur-sm border border-slate-800/40">
              Transformamos residuos en recursos circulares mediante logística responsable, pesaje industrial verificado con Báscula Romana RS-232 y trazabilidad oficial ante el Ministerio del Medio Ambiente (SINADER).
            </p>

            {/* Botones de acción */}
            <div className="pt-4 flex flex-wrap items-center justify-center gap-4">
              <button
                onClick={() => scrollToSection('acto-accion')}
                className="px-8 py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm sm:text-base transition-all shadow-xl shadow-emerald-500/30 active:scale-95 flex items-center gap-2 cursor-pointer"
              >
                <span>Solicitar Retiro en Línea</span>
                <Zap size={18} />
              </button>

              <button
                onClick={() => openLegalModal('rep')}
                className="px-6 py-3.5 rounded-2xl bg-slate-900/85 hover:bg-slate-800 text-slate-200 border border-slate-700/80 hover:border-emerald-500/50 font-semibold text-sm sm:text-base transition-all backdrop-blur-md cursor-pointer flex items-center gap-2 shadow-lg"
              >
                <ShieldCheck size={18} className="text-emerald-400" />
                <span>Protección de Datos & Ley REP</span>
              </button>
            </div>

          </div>
        </section>

        {/* -----------------------------------------------------------------------
            ACTO 2: GESTIÓN INTEGRAL DE RESIDUOS (ALINEACIÓN PERFECTA DE TARJETAS)
           ----------------------------------------------------------------------- */}
        <section id="acto-servicios" className="min-h-screen flex items-center px-6 sm:px-12 py-24 max-w-7xl mx-auto">
          <div className="w-full grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">

            {/* TARJETA 1: OPERACIÓN Y LOGÍSTICA VERDE */}
            <div className="bg-slate-950/60 border border-emerald-500/35 rounded-3xl p-8 sm:p-10 backdrop-blur-xl shadow-2xl flex flex-col justify-between h-full space-y-6">
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
                  <div className="flex items-center gap-2 text-xs uppercase font-bold tracking-wider text-emerald-400">
                    <Truck size={18} />
                    <span>Operación & Logística Verde</span>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-300 text-xs font-bold border border-emerald-500/20">
                    Retiro Programado
                  </span>
                </div>

                <h3 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight leading-snug mt-4">
                  Recolección Especializada y Retiro en Origen
                </h3>

                <p className="text-slate-300 text-sm sm:text-base leading-relaxed mt-3">
                  Coordinamos retiros directos para empresas, industrias, condominios y hogares. Gestionamos metales ferrosos y no ferrosos, plásticos (PET y PEAD), cartones y residuos electrónicos (RAEE).
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800/80 text-left space-y-2">
                  <div className="text-xl font-black text-white flex items-center gap-2">
                    <Truck size={20} className="text-emerald-400" />
                    <span>Flota Ágil</span>
                  </div>
                  <p className="text-xs text-slate-300">Equipamiento técnico para retiros a granel y logística urbana segura.</p>
                </div>

                <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800/80 text-left space-y-2">
                  <div className="text-xl font-black text-white flex items-center gap-2">
                    <Layers size={20} className="text-emerald-400" />
                    <span>Clasificación</span>
                  </div>
                  <p className="text-xs text-slate-300">Pesaje verificado y separación técnica de materiales en el punto de retiro.</p>
                </div>
              </div>
            </div>

            {/* TARJETA 2: ECONOMÍA CIRCULAR SOSTENIBLE */}
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-3xl p-8 sm:p-10 backdrop-blur-xl shadow-2xl flex flex-col justify-between h-full space-y-6">
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-slate-800/80">
                  <div className="flex items-center gap-2 text-xs uppercase font-bold tracking-wider text-teal-400">
                    <Award size={18} />
                    <span>Economía Circular Sostenible</span>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-teal-500/10 text-teal-300 text-xs font-bold border border-teal-500/20">
                    Destino Certificado
                  </span>
                </div>

                <h3 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight leading-snug mt-4">
                  Reintegración Productiva y Cero Vertedero
                </h3>

                <p className="text-slate-300 text-sm sm:text-base leading-relaxed mt-3">
                  Garantizamos que cada residuo recolectado ingrese a procesos formales de valorización y fundición, transformando pasivos ambientales en nuevas materias primas secundarias de alto valor.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800/80 text-left space-y-2">
                  <div className="text-xl font-black text-white flex items-center gap-2">
                    <Recycle size={20} className="text-teal-400" />
                    <span>100% Circular</span>
                  </div>
                  <p className="text-xs text-slate-300">Respaldo formal de valorización en fundiciones y plantas autorizadas.</p>
                </div>

                <div className="bg-slate-900/60 p-5 rounded-2xl border border-slate-800/80 text-left space-y-2">
                  <div className="text-xl font-black text-white flex items-center gap-2">
                    <FileCheck2 size={20} className="text-teal-400" />
                    <span>Reportes ESG</span>
                  </div>
                  <p className="text-xs text-slate-300">Documentación digital consolidada para auditorías ambientales y balances.</p>
                </div>
              </div>
            </div>

          </div>
        </section>

        {/* -----------------------------------------------------------------------
            ACTO 3: CUMPLIMIENTO LEGAL (MARCO REGULATORIO CHILENO)
           ----------------------------------------------------------------------- */}
        <section id="acto-leyrep" className="min-h-screen flex items-center px-6 sm:px-12 py-24 max-w-7xl mx-auto">
          <div className="w-full bg-slate-950/60 border border-emerald-500/35 rounded-3xl p-8 sm:p-12 backdrop-blur-xl shadow-2xl space-y-8">

            <div className="max-w-3xl space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                <ShieldCheck size={16} /> Marco Regulatorio y Legal en Chile
              </div>

              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight leading-tight">
                Cumplimiento de la <br />
                <span className="text-emerald-400">Ley REP Nº 20.920 y Ley Nº 21.719</span>
              </h2>

              <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
                Nuestra empresa opera bajo los más altos estándares normativos chilenos. Cada retiro genera un certificado inmutable respaldado con <strong>hash criptográfico SHA-256</strong>, validado para declaraciones automáticas ante la Ventanilla Única del SINADER.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
              <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800/80 space-y-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400">
                  <FileCheck2 size={20} />
                </div>
                <h4 className="text-white font-bold text-base">SINADER / MMA</h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Declaración electrónica oficial validada ante el Sistema Nacional de Declaración de Residuos del Ministerio del Medio Ambiente.
                </p>
              </div>

              <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800/80 space-y-3">
                <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-400/30 flex items-center justify-center text-teal-400">
                  <Lock size={20} />
                </div>
                <h4 className="text-white font-bold text-base">Ley Nº 21.719 (Privacidad)</h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Estricta protección de datos personales para personas y comunidades residenciales con derecho a supresión y anonimización.
                </p>
              </div>

              <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800/80 space-y-3">
                <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400">
                  <ShieldCheck size={20} />
                </div>
                <h4 className="text-white font-bold text-base">Trazabilidad Segura</h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Sellado digital de auditoría y certificación electrónica que garantiza pesajes exactos para tributación y balances corporativos.
                </p>
              </div>
            </div>

            {/* BOTONES DE ACCIÓN: VERIFICADOR EN LÍNEA & MARCO LEGAL COMPLETO */}
            <div className="pt-2 flex flex-wrap items-center gap-4 justify-center sm:justify-start">
              <a
                href="/verificar/"
                className="px-6 py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs sm:text-sm transition-all flex items-center gap-2.5 shadow-xl shadow-emerald-500/25 active:scale-95 group cursor-pointer"
              >
                <ShieldCheck size={18} className="group-hover:scale-110 transition-transform" />
                <span>Validar Certificado en Línea (SINADER)</span>
              </a>

              <button
                onClick={() => openLegalModal('rep')}
                className="px-6 py-3.5 rounded-2xl bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 font-bold text-xs sm:text-sm transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-emerald-500/10"
              >
                <Scale size={16} />
                <span>Ver Marco Legal Completo (Términos, Ley REP & Privacidad)</span>
              </button>
            </div>

          </div>
        </section>

        {/* -----------------------------------------------------------------------
            ACTO 4: FORMULARIOS SEPARADOS, ALINEADOS Y DIFERENCIADOS POR COLOR
           ----------------------------------------------------------------------- */}
        <section id="acto-accion" className="min-h-screen flex flex-col justify-center px-6 sm:px-12 py-28 max-w-7xl mx-auto">

          <div className="text-center space-y-4 mb-12">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-bold uppercase tracking-wider backdrop-blur-md">
              <Zap size={14} /> Solicitudes en Línea
            </div>

            <h2 className="text-4xl sm:text-5xl font-black text-white tracking-tight">
              Inicia tu Gestión de Reciclaje
            </h2>

            <p className="text-slate-300 text-sm sm:text-base max-w-2xl mx-auto">
              Selecciona tu sector para ingresar los datos. Ambos canales cuentan con pesaje certificado RS-232, trazabilidad transparente y logística programada.
            </p>
          </div>

          {/* FORMULARIOS SEPARADOS, ALINEADOS Y DIFERENCIADOS POR COLOR */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">

            {/* FORMULARIO 1: EMPRESAS & INDUSTRIAS (B2B) - COLOR AZUL CORPORATIVO */}
            <div className="bg-gradient-to-b from-blue-950/45 via-slate-950/60 to-slate-950/70 border-2 border-blue-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-blue-950/50 backdrop-blur-2xl flex flex-col justify-between h-full space-y-6">
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-blue-900/40">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400">Canal Corporativo B2B</span>
                    <h3 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 mt-0.5">
                      <Building2 className="text-blue-400 shrink-0" size={22} />
                      Empresas & Industrias
                    </h3>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-blue-500/15 text-blue-300 text-xs font-semibold border border-blue-500/30 whitespace-nowrap">
                    Certificado SHA-256
                  </span>
                </div>
                <p className="text-xs text-slate-300 pt-3">
                  Retiros a granel de chatarra, metales, plásticos industriales y RAEE con pesaje para SINADER / MMA.
                </p>
              </div>

              <div className="flex-1">
                <B2BForm />
              </div>
            </div>

            {/* FORMULARIO 2: COMUNIDADES & HOGARES (B2C) - COLOR VERDE ECOLÓGICO */}
            <div className="bg-gradient-to-b from-emerald-950/45 via-slate-950/60 to-slate-950/70 border-2 border-emerald-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-emerald-950/50 backdrop-blur-2xl flex flex-col justify-between h-full space-y-6">
              <div>
                <div className="flex items-center justify-between pb-4 border-b border-emerald-900/40">
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Canal Ciudadano B2C</span>
                    <h3 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2 mt-0.5">
                      <Users className="text-emerald-400 shrink-0" size={22} />
                      Hogares & Comunidades
                    </h3>
                  </div>
                  <span className="px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-300 text-xs font-semibold border border-emerald-500/30 whitespace-nowrap">
                    Logística Urbana
                  </span>
                </div>
                <p className="text-xs text-slate-300 pt-3">
                  Recolección de botellas PET, envases, cartón y reciclables con cobertura urbana y protección legal Ley Nº 21.719.
                </p>
              </div>

              <div className="flex-1">
                <B2CForm />
              </div>
            </div>

          </div>

        </section>

      </main>

      {/* =========================================================================
          FOOTER CORPORATIVO FINAL
         ========================================================================= */}
      <footer className="relative z-10 bg-slate-950/80 border-t border-slate-900/80 py-16 px-6 sm:px-12 text-slate-400 text-sm backdrop-blur-xl">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-10">

          <div className="space-y-4">
            <div onClick={scrollToTop} className="flex items-center gap-3 cursor-pointer hover:opacity-90 transition-opacity">
              <div className="w-9 h-9 rounded-xl border border-emerald-400/40 p-1.5 bg-emerald-950/40 flex items-center justify-center text-emerald-400">
                <Recycle size={20} className="animate-spin-slow" />
              </div>
              <span className="font-bold text-lg text-white">BraxRecicla</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Liderando la economía circular con trazabilidad certificada, pesaje de precisión y logística sustentable en Chile.
            </p>
          </div>

          <div>
            <h4 className="text-white font-bold mb-3 text-sm">Plataforma</h4>
            <ul className="space-y-2 text-xs">
              <li><button onClick={() => scrollToSection('acto-servicios')} className="hover:text-emerald-400 transition-colors cursor-pointer">Servicios & Logística</button></li>
              <li><button onClick={() => scrollToSection('acto-leyrep')} className="hover:text-emerald-400 transition-colors cursor-pointer">Trazabilidad SINADER</button></li>
              <li><button onClick={() => scrollToSection('acto-accion')} className="hover:text-emerald-400 transition-colors cursor-pointer">Portal Empresas B2B</button></li>
              <li><button onClick={() => scrollToSection('acto-accion')} className="hover:text-emerald-400 transition-colors cursor-pointer">Portal Ciudadanos B2C</button></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-bold mb-3 text-sm">Cumplimiento Legal</h4>
            <ul className="space-y-2 text-xs">
              <li>
                <button onClick={() => openLegalModal('rep')} className="hover:text-emerald-400 transition-colors cursor-pointer text-left">
                  Ley Nº 20.920 (Responsabilidad Extendida del Productor)
                </button>
              </li>
              <li>
                <button onClick={() => openLegalModal('rep')} className="hover:text-emerald-400 transition-colors cursor-pointer text-left">
                  Plataforma SINADER / Ministerio del Medio Ambiente
                </button>
              </li>
              <li>
                <button onClick={() => openLegalModal('privacy')} className="hover:text-emerald-400 transition-colors cursor-pointer text-left">
                  Ley Nº 21.719 (Protección de Datos Personales)
                </button>
              </li>
              <li>
                <button onClick={() => openLegalModal('terms')} className="hover:text-emerald-400 transition-colors cursor-pointer text-left">
                  Trazabilidad Digital Certificada
                </button>
              </li>
              <li className="pt-1.5 border-t border-slate-800/80">
                <a
                  href="/verificar/"
                  className="hover:text-emerald-300 text-emerald-400 font-semibold transition-colors cursor-pointer text-left flex items-center gap-1.5"
                >
                  <ShieldCheck size={13} className="shrink-0" />
                  <span>Verificador Público de Certificados SINADER</span>
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-bold mb-3 text-sm">Canal Oficial</h4>
            <ul className="space-y-2.5 text-xs">
              <li className="flex items-center gap-2"><MapPin size={14} className="text-emerald-400" /> Santiago, Chile</li>
              <li className="flex items-center gap-2"><Mail size={14} className="text-emerald-400" /> contacto@braxrecicla.cl</li>
              <li className="flex items-center gap-2"><Mail size={14} className="text-emerald-400" /> legal@braxrecicla.cl</li>
            </ul>
          </div>

        </div>

        <div className="max-w-7xl mx-auto mt-12 pt-6 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
          <p>© {new Date().getFullYear()} BraxRecicla SpA. Innovación, Sustentabilidad y Cumplimiento Legal.</p>
          <div className="flex gap-6">
            <button
              onClick={() => openLegalModal('terms')}
              className="hover:text-emerald-400 underline underline-offset-4 transition-colors cursor-pointer"
            >
              Términos del Servicio
            </button>
            <button
              onClick={() => openLegalModal('privacy')}
              className="hover:text-emerald-400 underline underline-offset-4 transition-colors cursor-pointer"
            >
              Seguridad & Privacidad
            </button>
          </div>
        </div>
      </footer>

      {/* MODAL LEGAL INTERACTIVO */}
      <LegalModal
        isOpen={legalModalOpen}
        initialTab={legalModalTab}
        onClose={() => setLegalModalOpen(false)}
      />

    </div>
  );
}
