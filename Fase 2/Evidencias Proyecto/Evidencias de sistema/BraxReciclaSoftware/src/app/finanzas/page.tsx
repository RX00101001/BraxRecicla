'use client';

import React, { useState, useEffect } from 'react';
import BraxSidebar from '@/components/BraxSidebar';
import { 
  DollarSign, TrendingUp, TrendingDown, Fuel, Download, ShieldCheck, 
  BarChart3, PieChart, ArrowUpRight, Filter, AlertTriangle, CheckCircle2,
  Lock, RefreshCw, Truck, Layers, Calendar, ChevronDown, FileSpreadsheet,
  Sliders, Zap, Sparkles, RotateCcw, Calculator, Gauge, Leaf, Timer, Check, X
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { getErpAccess } from '@/lib/erp-access';

interface RutaFinanciera {
  id: string;
  cliente: string;
  comuna: string;
  patente: string;
  distanciaKm: number;
  costoFlota: number;
  kilos: number;
  valorMaterial: number;
  margenPorcentaje: number;
  tipo: 'b2b' | 'b2c';
}

interface MasterPricesConfig {
  precioMetal: number; // $/kg
  precioDiesel: number; // $/L
  fechaActualizacion: string;
  actualizadoPor: string;
}

const DEFAULT_MASTER_PRICES: MasterPricesConfig = {
  precioMetal: 145,
  precioDiesel: 1025,
  fechaActualizacion: '21-11-2026, 23:40',
  actualizadoPor: 'Gerencia General (Rol: Dueño)'
};

export default function Finanzas() {
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<'operador' | 'admin' | 'dueno' | null>(null);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [loading, setLoading] = useState(true);
  const [solicitudesB2B, setSolicitudesB2B] = useState<any[]>([]);
  const [periodo, setPeriodo] = useState<'mes' | 'trimestre' | 'anual'>('mes');
  const [filterRuta, setFilterRuta] = useState<'todas' | 'alta' | 'alerta'>('todas');
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Configuración Maestra de Precios Oficiales (Control Exclusivo Rol Dueño)
  const [masterPrices, setMasterPrices] = useState<MasterPricesConfig>(DEFAULT_MASTER_PRICES);
  const [modalEditarPrecios, setModalEditarPrecios] = useState(false);
  const [tempPrecioMetal, setTempPrecioMetal] = useState(145);
  const [tempPrecioDiesel, setTempPrecioDiesel] = useState(1025);

  // Estados para el Simulador Interactivo de Sensibilidad Financiera
  const [simuladorAbierto, setSimuladorAbierto] = useState(true);
  const [precioSpot, setPrecioSpot] = useState(145); // CLP/kg base
  const [precioDiesel, setPrecioDiesel] = useState(1025); // CLP/L base
  const [filtroCamionSimulado, setFiltroCamionSimulado] = useState<'todos' | 'BRX-12' | 'BRX-14' | 'BRX-08' | 'BRX-05'>('todos');
  const [optimizacionRutasActiva, setOptimizacionRutasActiva] = useState(true);

  // Estados Adaptables Multi-Material y Combustible (A conciencia del dueño)
  const [materialActivo, setMaterialActivo] = useState<'todos' | 'cobre' | 'aluminio' | 'chatarra' | 'plasticos' | 'carton' | 'vidrio' | 'raee'>('todos');
  const [preciosMateriales, setPreciosMateriales] = useState({
    cobre: 4500,     // Cobre & Metales No Ferrosos ($/kg)
    aluminio: 1200,  // Aluminio Perfiles & Latas ($/kg)
    chatarra: 145,   // Chatarra Ferrosa & Acero ($/kg)
    plasticos: 280,  // Plásticos Industriales PET/PEAD ($/kg)
    carton: 110,     // Cartón Corrugado & Papel OCC ($/kg)
    vidrio: 50,      // Vidrio Botellas & Envases ($/kg)
    raee: 850        // RAEE Electrónicos y Motores ($/kg)
  });
  const [tipoCombustible, setTipoCombustible] = useState<'petroleo' | 'bencina'>('petroleo');
  const [precioPetroleo, setPrecioPetroleo] = useState(1025); // CLP/L Petróleo/Diésel
  const [precioBencina, setPrecioBencina] = useState(1280);   // CLP/L Bencina Gasolina

  // Cargar precios maestros persistidos
  useEffect(() => {
    try {
      const saved = localStorage.getItem('brax_master_prices');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed.precioMetal === 'number') {
          setMasterPrices(parsed);
          setPrecioSpot(parsed.precioMetal);
          setPrecioDiesel(parsed.precioDiesel);
          setTempPrecioMetal(parsed.precioMetal);
          setTempPrecioDiesel(parsed.precioDiesel);
        }
      }
    } catch {
      // Ignorar error de parseo local
    }
  }, []);

  // 1. Cargar datos B2B reales desde Supabase SOLO tras autorización
  const fetchData = async () => {
    try {
      setLoading(true);
      const { data } = await supabase
        .from('solicitudes_b2b')
        .select('*')
        .order('fecha_solicitud', { ascending: false });
      if (data) setSolicitudesB2B(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // 2. BLINDAJE DE SEGURIDAD (RBAC + MFA): Evita FOUC (Flash of Unauthorized Content)
  useEffect(() => {
    let active = true;
    const checkAuth = async () => {
      try {
        const access = await getErpAccess();
        if (!active) return;
        if (!access) {
          window.location.replace('/');
          return;
        }
        const { role } = access;
        if (role !== 'dueno') {
          window.location.replace(role === 'chofer' ? '/rutas/' : '/');
          return;
        }

        setCurrentUser(access.user);
        setUserRole('dueno');
        setIsAuthorized(true);
        fetchData();
      } catch (err) {
        if (!active) return;
        console.error('Error auth finanzas:', err);
        window.location.replace('/');
      } finally {
        if (active) setCheckingAuth(false);
      }
    };

    checkAuth();
    return () => { active = false; };
  }, []);

  // Cálculos dinámicos
  const totalKilos = solicitudesB2B.reduce((acc, curr) => 
    acc + (Number(curr.kilos_reales) || (Number(curr.volumen_toneladas) * 1000) || 0), 0
  );

  // Rutas operativas auditadas con recálculo dinámico basado en los precios maestros oficiales
  const rutasDetalle: RutaFinanciera[] = [
    {
      id: 'RUT-01',
      cliente: 'Industrias Metalúrgicas S.A.',
      comuna: 'Quilicura',
      patente: 'BRX-12',
      distanciaKm: 14,
      costoFlota: Math.round((14 / 3.8) * masterPrices.precioDiesel + 24700),
      kilos: 83152,
      valorMaterial: Math.round(83152 * masterPrices.precioMetal),
      margenPorcentaje: 0,
      tipo: 'b2b'
    },
    {
      id: 'RUT-02',
      cliente: 'Minera Los Andes S.A.',
      comuna: 'Lampa',
      patente: 'BRX-14',
      distanciaKm: 26,
      costoFlota: Math.round((26 / 3.8) * masterPrices.precioDiesel + 37200),
      kilos: 65420,
      valorMaterial: Math.round(65420 * masterPrices.precioMetal),
      margenPorcentaje: 0,
      tipo: 'b2b'
    },
    {
      id: 'RUT-03',
      cliente: 'TechCorp Chile Ltda.',
      comuna: 'Pudahuel',
      patente: 'BRX-12',
      distanciaKm: 18,
      costoFlota: Math.round((18 / 3.8) * masterPrices.precioDiesel + 27100),
      kilos: 35400,
      valorMaterial: Math.round(35400 * masterPrices.precioMetal),
      margenPorcentaje: 0,
      tipo: 'b2b'
    },
    {
      id: 'RUT-04',
      cliente: 'Constructora Del Sur SpA',
      comuna: 'San Bernardo',
      patente: 'BRX-08',
      distanciaKm: 42,
      costoFlota: Math.round((42 / 3.8) * masterPrices.precioDiesel + 57200),
      kilos: 30171,
      valorMaterial: Math.round(30171 * masterPrices.precioMetal),
      margenPorcentaje: 0,
      tipo: 'b2b'
    },
    {
      id: 'RUT-05',
      cliente: 'Circuito Domiciliario Las Condes (Puntos Limpios)',
      comuna: 'Las Condes',
      patente: 'BRX-05',
      distanciaKm: 58,
      costoFlota: Math.round((58 / 3.8) * masterPrices.precioDiesel + 76800),
      kilos: 1420,
      valorMaterial: Math.round(1420 * masterPrices.precioMetal),
      margenPorcentaje: 0,
      tipo: 'b2c'
    },
    {
      id: 'RUT-06',
      cliente: 'Retiro Domiciliario Extendido Melipilla',
      comuna: 'Melipilla',
      patente: 'BRX-05',
      distanciaKm: 124,
      costoFlota: Math.round((124 / 3.8) * masterPrices.precioDiesel + 151500),
      kilos: 980,
      valorMaterial: Math.round(980 * masterPrices.precioMetal),
      margenPorcentaje: 0,
      tipo: 'b2c'
    }
  ].map((r): RutaFinanciera => ({
    ...r,
    tipo: r.tipo as 'b2b' | 'b2c',
    margenPorcentaje: Number((((r.valorMaterial - r.costoFlota) / r.valorMaterial) * 100).toFixed(1))
  }));

  // Facturación calculada con precio oficial fijado exclusivamente por Gerencia (Rol Dueño)
  const facturacionTotal = totalKilos > 0 ? Math.round(totalKilos * masterPrices.precioMetal) : 31050735;
  const costoFlotaTotal = rutasDetalle.reduce((acc, r) => acc + r.costoFlota, 0);
  const margenNetoTotal = facturacionTotal - costoFlotaTotal;
  const margenPorcentaje = ((margenNetoTotal / facturacionTotal) * 100).toFixed(1);
  const roiFlota = (facturacionTotal / costoFlotaTotal).toFixed(1);

  // Handler para guardar precios maestros oficiales (Solo Rol Dueño)
  const handleGuardarPreciosOficiales = (e: React.FormEvent) => {
    e.preventDefault();
    if (userRole !== 'dueno') {
      alert('Acceso restringido: Solo el usuario con Rol DUEÑO está autorizado a modificar los precios maestros.');
      return;
    }
    const nuevo: MasterPricesConfig = {
      precioMetal: Math.max(1, Number(tempPrecioMetal) || 145),
      precioDiesel: Math.max(1, Number(tempPrecioDiesel) || 1025),
      fechaActualizacion: new Date().toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }),
      actualizadoPor: currentUser?.email ? `${currentUser.email} (Rol: Dueño)` : 'Gerencia General (Rol: Dueño)'
    };
    setMasterPrices(nuevo);
    setPrecioSpot(nuevo.precioMetal);
    setPrecioDiesel(nuevo.precioDiesel);
    localStorage.setItem('brax_master_prices', JSON.stringify(nuevo));
    setModalEditarPrecios(false);
    setExportNotice(`✅ Precios oficiales fijados por Gerencia: Metal $${nuevo.precioMetal} CLP/kg · Diésel $${nuevo.precioDiesel} CLP/L. Balance recalculado.`);
    setTimeout(() => setExportNotice(null), 5000);
  };

  const rutasFiltradas = rutasDetalle.filter(r => {
    if (filterRuta === 'alta') return r.margenPorcentaje >= 80;
    if (filterRuta === 'alerta') return r.margenPorcentaje < 80;
    return true;
  });

  // Cálculos dinámicos del Simulador de Sensibilidad Financiera Multi-Material y Combustible
  const rutasParaSimulacion = rutasDetalle.filter(r => 
    filtroCamionSimulado === 'todos' || r.patente === filtroCamionSimulado
  );

  const totalKilosSimulados = rutasParaSimulacion.reduce((acc, r) => acc + r.kilos, 0);

  // Desglose de kilos por categoría según la matriz integral de valorización industrial (Ley REP):
  // Cobre 25%, Chatarra 28%, Aluminio 12%, Plásticos 14%, Cartón 11%, Vidrio 5%, RAEE 5% (Total 100%)
  const kilosPorCategoria = {
    cobre: Math.round(totalKilosSimulados * 0.25),
    aluminio: Math.round(totalKilosSimulados * 0.12),
    chatarra: Math.round(totalKilosSimulados * 0.28),
    plasticos: Math.round(totalKilosSimulados * 0.14),
    carton: Math.round(totalKilosSimulados * 0.11),
    vidrio: Math.round(totalKilosSimulados * 0.05),
    raee: Math.round(totalKilosSimulados * 0.05)
  };

  // Cálculo de facturación simulada:
  // Si está seleccionado un material específico, valoriza ese subconjunto
  // Si está seleccionado 'todos', valoriza la canasta consolidada con los 7 precios reales definidos por el dueño
  let facturacionSimulada = 0;
  let kilosEvaluados = totalKilosSimulados;
  let precioMedioEquivalente = 0;

  if (materialActivo === 'cobre') {
    kilosEvaluados = kilosPorCategoria.cobre;
    facturacionSimulada = kilosEvaluados * preciosMateriales.cobre;
    precioMedioEquivalente = preciosMateriales.cobre;
  } else if (materialActivo === 'aluminio') {
    kilosEvaluados = kilosPorCategoria.aluminio;
    facturacionSimulada = kilosEvaluados * preciosMateriales.aluminio;
    precioMedioEquivalente = preciosMateriales.aluminio;
  } else if (materialActivo === 'chatarra') {
    kilosEvaluados = kilosPorCategoria.chatarra;
    facturacionSimulada = kilosEvaluados * preciosMateriales.chatarra;
    precioMedioEquivalente = preciosMateriales.chatarra;
  } else if (materialActivo === 'plasticos') {
    kilosEvaluados = kilosPorCategoria.plasticos;
    facturacionSimulada = kilosEvaluados * preciosMateriales.plasticos;
    precioMedioEquivalente = preciosMateriales.plasticos;
  } else if (materialActivo === 'carton') {
    kilosEvaluados = kilosPorCategoria.carton;
    facturacionSimulada = kilosEvaluados * preciosMateriales.carton;
    precioMedioEquivalente = preciosMateriales.carton;
  } else if (materialActivo === 'vidrio') {
    kilosEvaluados = kilosPorCategoria.vidrio;
    facturacionSimulada = kilosEvaluados * preciosMateriales.vidrio;
    precioMedioEquivalente = preciosMateriales.vidrio;
  } else if (materialActivo === 'raee') {
    kilosEvaluados = kilosPorCategoria.raee;
    facturacionSimulada = kilosEvaluados * preciosMateriales.raee;
    precioMedioEquivalente = preciosMateriales.raee;
  } else {
    // Canasta completa consolidada con los 7 materiales ponderados
    facturacionSimulada = (kilosPorCategoria.cobre * preciosMateriales.cobre) +
                          (kilosPorCategoria.aluminio * preciosMateriales.aluminio) +
                          (kilosPorCategoria.chatarra * preciosMateriales.chatarra) +
                          (kilosPorCategoria.plasticos * preciosMateriales.plasticos) +
                          (kilosPorCategoria.carton * preciosMateriales.carton) +
                          (kilosPorCategoria.vidrio * preciosMateriales.vidrio) +
                          (kilosPorCategoria.raee * preciosMateriales.raee);
    precioMedioEquivalente = totalKilosSimulados > 0 
      ? Math.round(facturacionSimulada / totalKilosSimulados)
      : 145;
  }

  // Factor de ahorro en distancia por algoritmo TSP (18% de reducción de kilómetros recorridos)
  const factorDistancia = optimizacionRutasActiva ? 0.82 : 1.0;

  // Rendimiento y precio del combustible seleccionado por el dueño
  // Petróleo (Diésel): rendimiento camiones pesados 3.8 km/L
  // Bencina (Gasolina): rendimiento utilitarios / camionetas 8.5 km/L
  const precioCombustibleActivo = tipoCombustible === 'petroleo' ? precioPetroleo : precioBencina;
  const rendimientoKmPorLitro = tipoCombustible === 'petroleo' ? 3.8 : 8.5;

  // Proporción de OPEX según el material filtrado (prorrateo de flota)
  const factorPonderacionMaterial = materialActivo === 'todos' ? 1.0 : (totalKilosSimulados > 0 ? (kilosEvaluados / totalKilosSimulados) : 1.0);

  // OPEX Flota simulado: Combustible dependiente de precio del combustible elegido + costos fijos (48%)
  const costoFlotaSimulado = Math.round(rutasParaSimulacion.reduce((acc, r) => {
    const litrosCombustible = (r.distanciaKm * factorDistancia) / rendimientoKmPorLitro;
    const gastoCombustible = litrosCombustible * precioCombustibleActivo;
    const costoFijo = r.costoFlota * 0.48;
    return acc + Math.round((gastoCombustible + costoFijo) * factorPonderacionMaterial);
  }, 0));

  const margenNetoSimulado = facturacionSimulada - costoFlotaSimulado;
  const margenPorcentajeSimulado = facturacionSimulada > 0 
    ? ((margenNetoSimulado / facturacionSimulada) * 100).toFixed(1)
    : '0.0';
  const roiSimulado = costoFlotaSimulado > 0 
    ? (facturacionSimulada / costoFlotaSimulado).toFixed(1)
    : '0.0';

  const ahorroCombustiblePorTSP = optimizacionRutasActiva
    ? Math.round(rutasParaSimulacion.reduce((acc, r) => acc + ((r.distanciaKm * 0.18) / rendimientoKmPorLitro) * precioCombustibleActivo * factorPonderacionMaterial, 0))
    : 0;

  const facturacionBaseSubconjunto = totalKilosSimulados * 145 * factorPonderacionMaterial;
  const costoFlotaBaseSubconjunto = costoFlotaTotal * factorPonderacionMaterial;
  const variacionMargen = margenNetoSimulado - (facturacionBaseSubconjunto - costoFlotaBaseSubconjunto);

  // 1. Exportar a Microsoft Excel nativo (.xls con celdas y columnas separadas)
  const handleExportExcel = () => {
    const tableRows = rutasDetalle.map(r => `
      <tr>
        <td style="font-family: monospace; font-weight: bold; text-align: center;">${r.id}</td>
        <td>${r.cliente}</td>
        <td>${r.comuna}</td>
        <td style="text-align: center; font-weight: bold;">${r.patente}</td>
        <td style="text-align: right;">${r.distanciaKm} km</td>
        <td style="mso-number-format:'\\$\\#\\,\\#\\#0'; text-align: right; color: #dc2626;">-${r.costoFlota}</td>
        <td style="mso-number-format:'\\#\\,\\#\\#0'; text-align: right;">${r.kilos}</td>
        <td style="mso-number-format:'\\$\\#\\,\\#\\#0'; text-align: right; color: #059669;">${r.valorMaterial}</td>
        <td style="mso-number-format:'\\$\\#\\,\\#\\#0'; text-align: right; font-weight: bold; color: ${r.valorMaterial - r.costoFlota >= 0 ? '#059669' : '#dc2626'};">${r.valorMaterial - r.costoFlota}</td>
        <td style="mso-number-format:'0\\.0%'; text-align: center; font-weight: bold;">${(r.margenPorcentaje / 100).toFixed(3)}</td>
        <td style="text-align: center; font-weight: bold;">${r.tipo.toUpperCase()}</td>
      </tr>
    `).join('');

    const excelTemplate = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <!--[if gte mso 9]>
        <xml>
          <x:ExcelWorkbook>
            <x:ExcelWorksheets>
              <x:ExcelWorksheet>
                <x:Name>Balance Financiero</x:Name>
                <x:WorksheetOptions>
                  <x:DisplayGridlines/>
                </x:WorksheetOptions>
              </x:ExcelWorksheet>
            </x:ExcelWorksheets>
          </x:ExcelWorkbook>
        </xml>
        <![endif]-->
        <style>
          body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; }
          .title { font-size: 15pt; font-weight: bold; color: #064e3b; padding: 10px 0; }
          .subtitle { font-size: 10.5pt; color: #475569; }
          .kpi-table th { background-color: #0f172a; color: #ffffff; padding: 8px; font-weight: bold; border: 1px solid #334155; }
          .kpi-table td { padding: 6px 10px; border: 1px solid #cbd5e1; }
        </style>
      </head>
      <body>
        <table>
          <tr><td colspan="11" class="title">REPORTE FINANCIERO Y AUDITORÍA DE COSTOS - BRAX RECICLA SPA</td></tr>
          <tr><td colspan="11" class="subtitle">Fecha de Emisión: ${new Date().toLocaleDateString('es-CL')} ${new Date().toLocaleTimeString('es-CL')}</td></tr>
          <tr><td colspan="11" class="subtitle">Facturación Total: $${facturacionTotal.toLocaleString('es-CL')} CLP | Costo Flota OPEX: $${costoFlotaTotal.toLocaleString('es-CL')} CLP | Margen Neto Operativo: ${margenPorcentaje}%</td></tr>
          <tr><td colspan="11"></td></tr>
        </table>

        <table class="kpi-table">
          <thead>
            <tr>
              <th style="background-color: #0f172a; color: white;">ID Ruta</th>
              <th style="background-color: #0f172a; color: white;">Cliente / Entidad</th>
              <th style="background-color: #0f172a; color: white;">Comuna</th>
              <th style="background-color: #0f172a; color: white;">Camión</th>
              <th style="background-color: #0f172a; color: white;">Distancia</th>
              <th style="background-color: #0f172a; color: white;">Costo Flota (CLP)</th>
              <th style="background-color: #0f172a; color: white;">Kilos Gestionados</th>
              <th style="background-color: #0f172a; color: white;">Valorización Bruta (CLP)</th>
              <th style="background-color: #0f172a; color: white;">Beneficio Neto (CLP)</th>
              <th style="background-color: #0f172a; color: white;">Margen Operativo</th>
              <th style="background-color: #0f172a; color: white;">Tipo</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </body>
      </html>
    `;

    const blob = new Blob([excelTemplate], { type: 'application/vnd.ms-excel;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `BraxRecicla_Reporte_Financiero_${new Date().toISOString().slice(0, 10)}.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setExportNotice('Archivo Excel (.xls) descargado. Se abrirá en Microsoft Excel con columnas separadas y formato ordenado.');
    setTimeout(() => setExportNotice(null), 5000);
  };

  // 2. Exportar en CSV estándar
  const handleExportCSV = () => {
    const headers = [
      'ID Ruta',
      'Cliente / Entidad',
      'Comuna',
      'Camión',
      'Distancia (km)',
      'Costo Flota (CLP)',
      'Kilos Gestionados',
      'Valorización Bruta (CLP)',
      'Margen Neto (CLP)',
      'Margen %',
      'Tipo Operación'
    ];

    const rows = rutasDetalle.map(r => [
      r.id,
      `"${r.cliente}"`,
      r.comuna,
      r.patente,
      r.distanciaKm,
      r.costoFlota,
      r.kilos,
      r.valorMaterial,
      r.valorMaterial - r.costoFlota,
      `${r.margenPorcentaje}%`,
      r.tipo.toUpperCase()
    ]);

    const csvContent = '\uFEFFsep=;\r\n' + [
      headers.join(';'),
      ...rows.map(r => r.join(';'))
    ].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `BraxRecicla_Reporte_Financiero_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setExportNotice('Reporte CSV descargado con éxito.');
    setTimeout(() => setExportNotice(null), 5000);
  };

  // BLOQUEO ESTRICTO DE SEGURIDAD (CWE-200 / OWASP A01):
  // Impide cualquier renderizado de finanzas hasta que la sesión y el rol 'dueno' estén 100% verificados
  if (checkingAuth || !isAuthorized || userRole !== 'dueno') {
    return (
      <div className="min-h-screen bg-[#0b0f19] flex flex-col items-center justify-center font-sans text-slate-100">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          <div className="flex items-center gap-2 text-xs text-amber-400 font-mono tracking-wider">
            <Lock size={14} />
            <span>Verificando autorización y credenciales de Gerencia...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#0b0f19] text-slate-50 font-sans overflow-hidden">
      <BraxSidebar currentPath="/finanzas" />

      <main className="flex-1 flex flex-col h-screen overflow-y-auto bg-[#0b0f19]">
        {/* HEADER CON CONTROLES DE PERIODO Y EXPORTACIÓN */}
        <header className="h-16 flex items-center justify-between px-8 border-b border-slate-800 bg-[#0f172a]/90 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <DollarSign size={20} />
            </div>
            <div>
              <h1 className="text-base font-bold text-white flex items-center gap-2">
                Panel Financiero y Auditoría de Costos
              </h1>
              <p className="text-xs text-slate-400">
                Valorización de Materiales vs Costo Logístico de Flota
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* SELECTOR DE PERÍODO */}
            <div className="flex items-center gap-1 bg-[#0b0f19] p-1 rounded-xl border border-slate-800 text-xs font-semibold">
              <button
                onClick={() => setPeriodo('mes')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${periodo === 'mes' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                Mes Actual
              </button>
              <button
                onClick={() => setPeriodo('trimestre')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${periodo === 'trimestre' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                Trimestre Q2
              </button>
              <button
                onClick={() => setPeriodo('anual')}
                className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${periodo === 'anual' ? 'bg-amber-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}
              >
                Año 2026
              </button>
            </div>

            {/* BOTONES DE EXPORTACIÓN */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportExcel}
                title="Exportar a Microsoft Excel con columnas y formatos numéricos"
                className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-md shadow-emerald-900/30 cursor-pointer"
              >
                <FileSpreadsheet size={15} />
                <span>Exportar Excel (.xls)</span>
              </button>

              <button
                onClick={handleExportCSV}
                title="Descargar archivo CSV"
                className="inline-flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold px-3 py-2 rounded-xl transition-all border border-slate-700 cursor-pointer"
              >
                <Download size={13} />
                <span>CSV</span>
              </button>
            </div>
          </div>
        </header>

        {/* CONTENEDOR CENTRAL */}
        <div className="p-8 max-w-7xl mx-auto w-full space-y-8">
          {/* TOAST DE EXPORTACIÓN */}
          {exportNotice && (
            <div className="p-4 bg-emerald-950/90 border border-emerald-500/40 rounded-xl text-emerald-300 text-sm flex items-center gap-3 shadow-lg animate-in fade-in slide-in-from-top-2">
              <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
              <p className="font-medium">{exportNotice}</p>
            </div>
          )}

          {/* GOBERNANZA RBAC: PARÁMETROS MAESTROS DE PRECIOS (CONTROL EXCLUSIVO ROL DUEÑO) */}
          <div className="bg-[#1e293b] p-5 rounded-2xl border border-amber-500/30 shadow-xl flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 shrink-0">
                <ShieldCheck size={24} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    Parámetros Oficiales de Mercado
                  </h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold uppercase tracking-wider">
                    Control Exclusivo: Rol Dueño
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Precios base que gobiernan la valorización en báscula romana, facturación de retiros y costo logístico de la flota.
                </p>
                <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-1 font-mono">
                  <span>Última fijación: <strong className="text-slate-300">{masterPrices.fechaActualizacion}</strong></span>
                  <span>·</span>
                  <span>Por: <strong className="text-amber-400">{masterPrices.actualizadoPor}</strong></span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 self-start lg:self-auto">
              {/* Tarjeta rápida Metal */}
              <div className="flex items-center gap-2.5 bg-[#0b0f19] px-3.5 py-2 rounded-xl border border-slate-800 text-xs font-mono">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <div>
                  <span className="text-[10px] text-slate-400 block font-sans">Metal Oficial:</span>
                  <span className="font-bold text-emerald-400 text-sm">${masterPrices.precioMetal} CLP/kg</span>
                </div>
              </div>

              {/* Tarjeta rápida Diésel */}
              <div className="flex items-center gap-2.5 bg-[#0b0f19] px-3.5 py-2 rounded-xl border border-slate-800 text-xs font-mono">
                <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
                <div>
                  <span className="text-[10px] text-slate-400 block font-sans">Diésel ENAP:</span>
                  <span className="font-bold text-red-400 text-sm">${masterPrices.precioDiesel} CLP/L</span>
                </div>
              </div>

              {/* Botón de Edición (Solo para Rol Dueño) */}
              {userRole === 'dueno' ? (
                <button
                  onClick={() => {
                    setTempPrecioMetal(masterPrices.precioMetal);
                    setTempPrecioDiesel(masterPrices.precioDiesel);
                    setModalEditarPrecios(true);
                  }}
                  className="flex items-center gap-1.5 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-500 hover:to-amber-600 active:scale-95 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-md shadow-amber-950/40 cursor-pointer border border-amber-400/30"
                  title="Fijar nuevos precios oficiales del mercado para todo el ERP"
                >
                  <Sliders size={14} />
                  <span>Fijar Precios Oficiales</span>
                </button>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-900/60 px-3 py-2 rounded-xl border border-slate-800" title="Solo el Dueño puede modificar estos parámetros">
                  <Lock size={13} />
                  <span>Solo Lectura (Operador)</span>
                </div>
              )}
            </div>
          </div>

          {/* TARJETAS EJECUTIVAS SUPERIORES */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Facturación Bruta */}
            <div className="bg-[#1e293b] p-6 rounded-2xl border border-slate-700/60 shadow-xl relative overflow-hidden group hover:border-slate-600 transition-all">
              <div className="flex justify-between items-start mb-3">
                <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                  Facturación Bruta Acumulada
                </span>
                <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <DollarSign size={20} />
                </div>
              </div>
              <h2 className="text-3xl font-extrabold text-white font-mono tracking-tight">
                ${facturacionTotal.toLocaleString('es-CL')}
                <span className="text-xs font-normal text-slate-400 ml-1.5">CLP</span>
              </h2>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-emerald-400 font-semibold flex items-center gap-1 font-mono">
                  <TrendingUp size={14} /> +14.2% vs mes anterior
                </span>
                <span className="text-slate-400 font-mono text-[11px]">{totalKilos.toLocaleString('es-CL')} kg</span>
              </div>
            </div>

            {/* Costo Logístico OPEX */}
            <div className="bg-[#1e293b] p-6 rounded-2xl border border-slate-700/60 shadow-xl relative overflow-hidden group hover:border-slate-600 transition-all">
              <div className="flex justify-between items-start mb-3">
                <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                  Costo Logístico Flota (OPEX)
                </span>
                <div className="p-2.5 rounded-xl bg-red-500/10 text-red-400 border border-red-500/20">
                  <Fuel size={20} />
                </div>
              </div>
              <h2 className="text-3xl font-extrabold text-red-400 font-mono tracking-tight">
                -${costoFlotaTotal.toLocaleString('es-CL')}
                <span className="text-xs font-normal text-slate-400 ml-1.5">CLP</span>
              </h2>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-red-400 font-semibold flex items-center gap-1 font-mono">
                  <TrendingUp size={14} /> Diésel + TAG Autopistas
                </span>
                <span className="text-slate-400 text-[11px]">4 camiones activos</span>
              </div>
            </div>

            {/* Margen Operativo Neto */}
            <div className="bg-[#1e293b] p-6 rounded-2xl border border-emerald-500/30 shadow-xl relative overflow-hidden group hover:border-emerald-500/50 transition-all">
              <div className="flex justify-between items-start mb-3">
                <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                  Margen Operativo Neto
                </span>
                <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                  <TrendingUp size={20} />
                </div>
              </div>
              <h2 className="text-3xl font-extrabold text-emerald-400 font-mono tracking-tight">
                +{margenPorcentaje}%
              </h2>
              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-white font-bold font-mono">
                  +${margenNetoTotal.toLocaleString('es-CL')} CLP
                </span>
                <span className="text-emerald-400 font-semibold text-[11px]">EBITDA Alto</span>
              </div>
            </div>

            {/* Retorno de Inversión (ROI) */}
            <div className="bg-[#1e293b] p-6 rounded-2xl border border-slate-700/60 shadow-xl relative overflow-hidden group hover:border-slate-600 transition-all">
              <div className="flex justify-between items-start mb-3">
                <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
                  Eficiencia de Combustible (ROI)
                </span>
                <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <ArrowUpRight size={20} />
                </div>
              </div>
              <h2 className="text-3xl font-extrabold text-cyan-400 font-mono tracking-tight">
                {roiFlota}x
              </h2>
              <div className="mt-3 text-xs text-slate-400">
                Por cada <strong>$1 CLP</strong> en combustible se recuperan <strong>${roiFlota} CLP</strong>
              </div>
            </div>
          </div>

          {/* =========================================================================
              SIMULADOR INTERACTIVO DE SENSIBILIDAD FINANCIERA
             ========================================================================= */}
          <div className="bg-white rounded-2xl border border-slate-200 dark:bg-[#1e293b] dark:border-amber-500/30 shadow-xl overflow-hidden">
            {/* Cabecera del Simulador */}
            <div className="p-6 bg-slate-50 border-b border-slate-200 dark:bg-gradient-to-r dark:from-slate-900 dark:via-amber-950/40 dark:to-slate-900 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-100 border border-amber-300 text-amber-700 dark:bg-amber-500/20 dark:border-amber-500/40 dark:text-amber-400">
                  <Calculator size={22} />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    Simulador de Sensibilidad Financiera
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                    Modela en tiempo real el impacto de la valorización por material y costo de combustible sobre el margen operativo.
                  </p>
                </div>
              </div>

              {/* Botón Restaurar y Presets Rápidos */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => {
                    setPreciosMateriales({
                      cobre: 4500,
                      aluminio: 1200,
                      chatarra: 145,
                      plasticos: 280,
                      carton: 110,
                      vidrio: 50,
                      raee: 850
                    });
                    setMaterialActivo('todos');
                    setTipoCombustible('petroleo');
                    setPrecioPetroleo(1025);
                    setPrecioBencina(1280);
                    setFiltroCamionSimulado('todos');
                    setOptimizacionRutasActiva(true);
                  }}
                  className="flex items-center gap-1.5 bg-white hover:bg-slate-100 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-white text-xs px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 transition-all cursor-pointer font-medium shadow-xs"
                  title="Restaurar a precios oficiales de Gerencia"
                >
                  <RotateCcw size={13} />
                  <span>Restaurar Base</span>
                </button>
              </div>
            </div>

            {/* Panel de Controles y Resultados en Vivo */}
            <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Controles de Entrada (Inputs Numéricos Libres y Selectores) - 7 Columnas */}
              <div className="lg:col-span-7 space-y-6">
                
                {/* Control 1: Selección y Definición de Precios por Material (Adaptable por el dueño) */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <label className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <DollarSign size={15} className="text-emerald-500" />
                      Valorización Adaptable por Tipo de Material ($/kg)
                    </label>
                    <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      (Configurable a conciencia del dueño)
                    </span>
                  </div>

                  {/* Selector de Enfoque de Material */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-1.5 text-xs">
                    {[
                      { id: 'todos', label: 'Todos Ponderado', sub: 'Canasta Global' },
                      { id: 'cobre', label: 'Cobre / Metales', sub: 'No ferrosos' },
                      { id: 'aluminio', label: 'Aluminio & Latas', sub: 'Perfiles / no ferr.' },
                      { id: 'chatarra', label: 'Chatarra Ferrosa', sub: 'Acero y perfiles' },
                      { id: 'plasticos', label: 'Plásticos Ind.', sub: 'PET / PEAD' },
                      { id: 'carton', label: 'Cartón & Papel', sub: 'OCC / Embalajes' },
                      { id: 'vidrio', label: 'Vidrio Envases', sub: 'Botellas / plano' },
                      { id: 'raee', label: 'RAEE & Baterías', sub: 'Electrónicos y plomo' }
                    ].map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setMaterialActivo(m.id as any)}
                        className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                          materialActivo === m.id
                            ? 'bg-emerald-600 text-white border-emerald-500 shadow-sm font-bold'
                            : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                        }`}
                      >
                        <span className="block font-bold truncate text-[11px]">{m.label}</span>
                        <span className={`text-[9px] block truncate ${materialActivo === m.id ? 'text-emerald-100' : 'text-slate-400'}`}>
                          {m.sub}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Tarjetas Editables de Precios para Cada Material */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {/* Cobre */}
                    <div className={`p-3 rounded-xl border transition-all ${materialActivo === 'cobre' ? 'bg-amber-50/80 border-amber-400 dark:bg-amber-950/30' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800'}`}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                          🪙 Cobre & No Ferrosos
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">25% volumen</span>
                      </div>
                      <div className="relative flex items-center">
                        <span className="absolute left-2.5 text-slate-400 font-mono font-bold text-xs">$</span>
                        <input
                          type="number"
                          min={1}
                          step={10}
                          value={preciosMateriales.cobre}
                          onChange={(e) => setPreciosMateriales({ ...preciosMateriales, cobre: Math.max(1, Number(e.target.value) || 0) })}
                          className="w-full pl-6 pr-16 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold text-slate-900 dark:text-amber-400 text-sm focus:ring-1 focus:ring-amber-500 focus:outline-none"
                        />
                        <span className="absolute right-2.5 text-[10px] font-semibold text-slate-500 font-mono">CLP/kg</span>
                      </div>
                    </div>

                    {/* Aluminio */}
                    <div className={`p-3 rounded-xl border transition-all ${materialActivo === 'aluminio' ? 'bg-sky-50/80 border-sky-400 dark:bg-sky-950/30' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800'}`}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                          🥫 Aluminio & Perfiles
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">12% volumen</span>
                      </div>
                      <div className="relative flex items-center">
                        <span className="absolute left-2.5 text-slate-400 font-mono font-bold text-xs">$</span>
                        <input
                          type="number"
                          min={1}
                          step={10}
                          value={preciosMateriales.aluminio}
                          onChange={(e) => setPreciosMateriales({ ...preciosMateriales, aluminio: Math.max(1, Number(e.target.value) || 0) })}
                          className="w-full pl-6 pr-16 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold text-slate-900 dark:text-sky-400 text-sm focus:ring-1 focus:ring-sky-500 focus:outline-none"
                        />
                        <span className="absolute right-2.5 text-[10px] font-semibold text-slate-500 font-mono">CLP/kg</span>
                      </div>
                    </div>

                    {/* Chatarra Ferrosa */}
                    <div className={`p-3 rounded-xl border transition-all ${materialActivo === 'chatarra' ? 'bg-blue-50/80 border-blue-400 dark:bg-blue-950/30' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800'}`}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                          🔩 Chatarra Ferrosa & Acero
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">28% volumen</span>
                      </div>
                      <div className="relative flex items-center">
                        <span className="absolute left-2.5 text-slate-400 font-mono font-bold text-xs">$</span>
                        <input
                          type="number"
                          min={1}
                          step={5}
                          value={preciosMateriales.chatarra}
                          onChange={(e) => setPreciosMateriales({ ...preciosMateriales, chatarra: Math.max(1, Number(e.target.value) || 0) })}
                          className="w-full pl-6 pr-16 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold text-slate-900 dark:text-blue-400 text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
                        />
                        <span className="absolute right-2.5 text-[10px] font-semibold text-slate-500 font-mono">CLP/kg</span>
                      </div>
                    </div>

                    {/* Plásticos Industriales */}
                    <div className={`p-3 rounded-xl border transition-all ${materialActivo === 'plasticos' ? 'bg-emerald-50/80 border-emerald-400 dark:bg-emerald-950/30' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800'}`}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                          🧴 Plásticos PET / PEAD
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">14% volumen</span>
                      </div>
                      <div className="relative flex items-center">
                        <span className="absolute left-2.5 text-slate-400 font-mono font-bold text-xs">$</span>
                        <input
                          type="number"
                          min={1}
                          step={5}
                          value={preciosMateriales.plasticos}
                          onChange={(e) => setPreciosMateriales({ ...preciosMateriales, plasticos: Math.max(1, Number(e.target.value) || 0) })}
                          className="w-full pl-6 pr-16 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold text-slate-900 dark:text-emerald-400 text-sm focus:ring-1 focus:ring-emerald-500 focus:outline-none"
                        />
                        <span className="absolute right-2.5 text-[10px] font-semibold text-slate-500 font-mono">CLP/kg</span>
                      </div>
                    </div>

                    {/* Cartón & Papel OCC */}
                    <div className={`p-3 rounded-xl border transition-all ${materialActivo === 'carton' ? 'bg-amber-50/90 border-amber-500 dark:bg-amber-950/40' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800'}`}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                          📦 Cartón & Papel (OCC)
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">11% volumen</span>
                      </div>
                      <div className="relative flex items-center">
                        <span className="absolute left-2.5 text-slate-400 font-mono font-bold text-xs">$</span>
                        <input
                          type="number"
                          min={1}
                          step={5}
                          value={preciosMateriales.carton}
                          onChange={(e) => setPreciosMateriales({ ...preciosMateriales, carton: Math.max(1, Number(e.target.value) || 0) })}
                          className="w-full pl-6 pr-16 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold text-slate-900 dark:text-amber-300 text-sm focus:ring-1 focus:ring-amber-500 focus:outline-none"
                        />
                        <span className="absolute right-2.5 text-[10px] font-semibold text-slate-500 font-mono">CLP/kg</span>
                      </div>
                    </div>

                    {/* Vidrio */}
                    <div className={`p-3 rounded-xl border transition-all ${materialActivo === 'vidrio' ? 'bg-teal-50/80 border-teal-400 dark:bg-teal-950/30' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800'}`}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                          🫙 Vidrio Envases & Botellas
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">5% volumen</span>
                      </div>
                      <div className="relative flex items-center">
                        <span className="absolute left-2.5 text-slate-400 font-mono font-bold text-xs">$</span>
                        <input
                          type="number"
                          min={1}
                          step={5}
                          value={preciosMateriales.vidrio}
                          onChange={(e) => setPreciosMateriales({ ...preciosMateriales, vidrio: Math.max(1, Number(e.target.value) || 0) })}
                          className="w-full pl-6 pr-16 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold text-slate-900 dark:text-teal-400 text-sm focus:ring-1 focus:ring-teal-500 focus:outline-none"
                        />
                        <span className="absolute right-2.5 text-[10px] font-semibold text-slate-500 font-mono">CLP/kg</span>
                      </div>
                    </div>

                    {/* RAEE y Baterías */}
                    <div className={`sm:col-span-2 p-3 rounded-xl border transition-all ${materialActivo === 'raee' ? 'bg-purple-50/80 border-purple-400 dark:bg-purple-950/30' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800'}`}>
                      <div className="flex items-center justify-between text-xs mb-1.5">
                        <span className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                          ⚡ RAEE, Motores & Baterías
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">5% volumen</span>
                      </div>
                      <div className="relative flex items-center">
                        <span className="absolute left-2.5 text-slate-400 font-mono font-bold text-xs">$</span>
                        <input
                          type="number"
                          min={1}
                          step={10}
                          value={preciosMateriales.raee}
                          onChange={(e) => setPreciosMateriales({ ...preciosMateriales, raee: Math.max(1, Number(e.target.value) || 0) })}
                          className="w-full pl-6 pr-16 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg font-mono font-bold text-slate-900 dark:text-purple-400 text-sm focus:ring-1 focus:ring-purple-500 focus:outline-none"
                        />
                        <span className="absolute right-2.5 text-[10px] font-semibold text-slate-500 font-mono">CLP/kg</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Control 2: Elección de Combustible (Petróleo vs Bencina) y Precio ($/L) */}
                <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between text-xs">
                    <label className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <Fuel size={15} className="text-red-500" />
                      Combustible de Flota (Petróleo / Bencina)
                    </label>
                    <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      Rendimiento: {tipoCombustible === 'petroleo' ? '3.8 km/L (Camión Pesado)' : '8.5 km/L (Camioneta Utilitaria)'}
                    </span>
                  </div>

                  {/* Selector Toggle Petróleo vs Bencina */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setTipoCombustible('petroleo')}
                      className={`p-2.5 rounded-xl border flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        tipoCombustible === 'petroleo'
                          ? 'bg-red-600 text-white border-red-500 shadow-sm font-bold'
                          : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                      }`}
                    >
                      <Fuel size={16} />
                      <div className="text-left">
                        <span className="block font-bold">⛽ Petróleo / Diésel</span>
                        <span className={`text-[10px] block ${tipoCombustible === 'petroleo' ? 'text-red-100' : 'text-slate-500'}`}>Flota pesada (BRX-12, 14, 08)</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setTipoCombustible('bencina')}
                      className={`p-2.5 rounded-xl border flex items-center justify-center gap-2 transition-all cursor-pointer ${
                        tipoCombustible === 'bencina'
                          ? 'bg-amber-600 text-white border-amber-500 shadow-sm font-bold'
                          : 'bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                      }`}
                    >
                      <Fuel size={16} />
                      <div className="text-left">
                        <span className="block font-bold">⛽ Bencina / Gasolina</span>
                        <span className={`text-[10px] block ${tipoCombustible === 'bencina' ? 'text-amber-100' : 'text-slate-500'}`}>Flota liviana (BRX-05)</span>
                      </div>
                    </button>
                  </div>

                  {/* Input Numérico Libre del Combustible Activo */}
                  <div className="relative flex items-center">
                    <span className="absolute left-3.5 text-slate-400 font-mono font-bold text-sm">$</span>
                    <input
                      type="number"
                      min={1}
                      step={5}
                      value={tipoCombustible === 'petroleo' ? precioPetroleo : precioBencina}
                      onChange={(e) => {
                        const val = Math.max(1, Number(e.target.value) || 0);
                        if (tipoCombustible === 'petroleo') setPrecioPetroleo(val);
                        else setPrecioBencina(val);
                      }}
                      className="w-full pl-8 pr-28 py-2.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl font-mono font-bold text-slate-900 dark:text-red-400 text-base focus:ring-2 focus:ring-red-500 focus:outline-none shadow-xs"
                      placeholder={tipoCombustible === 'petroleo' ? "Ej: 1025" : "Ej: 1280"}
                    />
                    <span className="absolute right-3.5 text-xs font-semibold text-slate-600 dark:text-slate-400 font-mono">
                      CLP / Litro
                    </span>
                  </div>

                  {/* Presets Rápidos según combustible */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-slate-500 font-medium mr-1">Presets ENAP:</span>
                    {tipoCombustible === 'petroleo' ? (
                      [
                        { label: '$980 (Subsidio)', val: 980 },
                        { label: '$1.025 (ENAP Actual)', val: 1025 },
                        { label: '$1.150 (Alza)', val: 1150 },
                        { label: '$1.280 (Shock)', val: 1280 }
                      ].map((btn, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setPrecioPetroleo(btn.val)}
                          className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 transition-all cursor-pointer"
                        >
                          {btn.label}
                        </button>
                      ))
                    ) : (
                      [
                        { label: '$1.240 (93 Octanos)', val: 1240 },
                        { label: '$1.280 (95 Octanos)', val: 1280 },
                        { label: '$1.350 (97 Octanos)', val: 1350 }
                      ].map((btn, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setPrecioBencina(btn.val)}
                          className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-md bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 transition-all cursor-pointer"
                        >
                          {btn.label}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Control 3: Filtro por Camión */}
                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Truck size={14} className="text-cyan-500" />
                    Segmentación de Flota Analizada
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    {[
                      { id: 'todos', label: 'Toda la Flota', sub: '4 camiones' },
                      { id: 'BRX-12', label: 'BRX-12', sub: 'Tolva Pesada' },
                      { id: 'BRX-14', label: 'BRX-14', sub: 'Minería' },
                      { id: 'BRX-08', label: 'BRX-08', sub: 'Industria Sur' },
                      { id: 'BRX-05', label: 'BRX-05', sub: 'Domiciliario' }
                    ].map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setFiltroCamionSimulado(item.id as any)}
                        className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                          filtroCamionSimulado === item.id
                            ? 'bg-cyan-600 text-white border-cyan-400 shadow-md font-bold'
                            : 'bg-slate-100 dark:bg-slate-900/40 border-slate-300 dark:border-slate-800 text-slate-700 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white hover:border-slate-400'
                        }`}
                      >
                        <span className="block font-bold truncate">{item.label}</span>
                        <span className={`text-[10px] block truncate ${filtroCamionSimulado === item.id ? 'text-cyan-100' : 'text-slate-500'}`}>
                          {item.sub}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Control 4: Toggle Optimización TSP */}
                <div className="bg-slate-50 dark:bg-[#0b0f19] p-3.5 rounded-xl border border-slate-300 dark:border-slate-800 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                      <Zap size={16} className={optimizacionRutasActiva ? 'text-amber-500 dark:text-amber-300 fill-amber-500' : 'text-slate-400'} />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white block">
                        Optimización de Rutas TSP + 2-Opt
                      </span>
                      <span className="text-[11px] text-slate-600 dark:text-slate-400">
                        Aplica 18% de reducción en kilometraje y consumo de combustible.
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => setOptimizacionRutasActiva(!optimizacionRutasActiva)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                      optimizacionRutasActiva
                        ? 'bg-emerald-600 text-white border-emerald-400 shadow-md font-bold'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {optimizacionRutasActiva ? '✓ ACTIVADO (-18%)' : 'DESACTIVADO'}
                  </button>
                </div>
              </div>

              {/* Panel de Salida de Resultados Proyectados en Tiempo Real - 5 Columnas */}
              <div className="lg:col-span-5 bg-slate-50 border border-slate-200 dark:bg-gradient-to-b dark:from-[#0f172a] dark:to-[#0b0f19] dark:border-slate-700/80 p-5 rounded-2xl shadow-xl space-y-4 flex flex-col justify-between">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                    <Gauge size={14} /> Proyección Financiera en Vivo
                  </span>
                  <span className="text-[10px] font-mono text-slate-600 dark:text-slate-400 font-bold">
                    {kilosEvaluados.toLocaleString('es-CL')} kg {materialActivo !== 'todos' ? `(${materialActivo.toUpperCase()})` : 'evaluados'}
                  </span>
                </div>

                {/* Tarjetas de Métricas Simuladas */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3.5 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">Facturación Proyectada</span>
                      <span className="text-base font-extrabold text-slate-900 dark:text-white font-mono">
                        ${facturacionSimulada.toLocaleString('es-CL')} CLP
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 font-bold bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/40 px-2 py-0.5 rounded">
                      ${precioMedioEquivalente}/kg
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-3.5 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 shadow-xs">
                    <div>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block font-medium">OPEX Flota Proyectado</span>
                      <span className="text-base font-extrabold text-rose-600 dark:text-red-400 font-mono">
                        -${costoFlotaSimulado.toLocaleString('es-CL')} CLP
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-rose-700 dark:text-red-400 font-bold bg-rose-50 dark:bg-red-950/40 border border-rose-200 dark:border-red-800/40 px-2 py-0.5 rounded">
                      ${precioCombustibleActivo}/L {tipoCombustible === 'petroleo' ? 'Diésel' : 'Bencina'}
                    </span>
                  </div>

                  {/* Tarjeta de Margen Operativo Neto (EBITDA) - Alto Contraste Extremo en Modo Día y Noche */}
                  <div className="p-4 rounded-xl border-2 space-y-2 shadow-xs bg-emerald-50/90 border-emerald-400 dark:bg-slate-900 dark:border-emerald-500/50">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black uppercase tracking-wider text-emerald-950 dark:text-emerald-300">
                        Margen Operativo Neto (EBITDA)
                      </span>
                      <span className="text-xs font-extrabold font-mono px-2.5 py-0.5 rounded-md bg-emerald-700 text-white font-black shadow-xs">
                        {margenPorcentajeSimulado}%
                      </span>
                    </div>
                    <p className="text-2xl font-black font-mono tracking-tight text-emerald-950 dark:text-emerald-200">
                      +${margenNetoSimulado.toLocaleString('es-CL')} <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">CLP</span>
                    </p>
                    <div className="flex items-center justify-between text-[11px] pt-1.5 border-t border-emerald-300 dark:border-emerald-900/40 text-emerald-950 dark:text-slate-300 font-semibold">
                      <span>Retorno Inversión (ROI): <strong className="font-mono font-bold text-teal-900 dark:text-cyan-300">{roiSimulado}x</strong></span>
                      <span className={`font-mono font-bold ${variacionMargen >= 0 ? 'text-emerald-800 dark:text-emerald-400' : 'text-rose-700 dark:text-red-400'}`}>
                        {variacionMargen >= 0 ? `+${variacionMargen.toLocaleString('es-CL')}` : variacionMargen.toLocaleString('es-CL')} CLP vs Base
                      </span>
                    </div>
                  </div>
                </div>

                {/* Banner de Ahorro por Optimización TSP */}
                {optimizacionRutasActiva && ahorroCombustiblePorTSP > 0 && (
                  <div className="p-3 rounded-xl bg-emerald-100/80 border border-emerald-300 dark:bg-emerald-500/10 dark:border-emerald-500/30 text-xs flex items-center gap-2.5 text-emerald-900 dark:text-emerald-300 shadow-xs">
                    <Zap size={16} className="text-amber-600 dark:text-amber-300 fill-amber-500 dark:fill-amber-300 shrink-0" />
                    <div>
                      <span className="font-bold block text-emerald-950 dark:text-emerald-200">Ahorro Logístico por TSP: +${ahorroCombustiblePorTSP.toLocaleString('es-CL')} CLP</span>
                      <span className="text-[10px] text-slate-600 dark:text-slate-400">Combustible retenido gracias a la ruta geodésica más corta.</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* =========================================================================
              GRÁFICOS INDUSTRIALES: EVOLUCIÓN MENSUAL Y DESGLOSE POR MATERIAL
             ========================================================================= */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* GRÁFICO 1: EVOLUCIÓN TEMPORAL DE FLUJOS (SVG CHART) */}
            <div className="lg:col-span-2 bg-white dark:bg-[#1e293b] p-6 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xl space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
                    <BarChart3 size={18} className="text-emerald-500 dark:text-emerald-400" />
                    Evolución Financiera Mensual (Facturación vs Costo Operativo)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Comparativa de ingresos por valorización frente al costo logístico de la flota.
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs font-semibold">
                  <div className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                    <span className="w-3 h-3 rounded bg-emerald-500"></span> Ingresos
                  </div>
                  <div className="flex items-center gap-1.5 text-rose-600 dark:text-red-400">
                    <span className="w-3 h-3 rounded bg-red-500"></span> Costo Flota
                  </div>
                </div>
              </div>

              {/* GRÁFICO SVG INDUSTRIAL */}
              <div className="h-64 w-full flex flex-col justify-end pt-4">
                <svg className="w-full h-full overflow-visible" viewBox="0 0 600 200" preserveAspectRatio="none">
                  {/* Grid Lines */}
                  <line x1="0" y1="40" x2="600" y2="40" stroke="#cbd5e1" className="dark:stroke-slate-700" strokeDasharray="3 3" strokeWidth="1" />
                  <line x1="0" y1="90" x2="600" y2="90" stroke="#cbd5e1" className="dark:stroke-slate-700" strokeDasharray="3 3" strokeWidth="1" />
                  <line x1="0" y1="140" x2="600" y2="140" stroke="#cbd5e1" className="dark:stroke-slate-700" strokeDasharray="3 3" strokeWidth="1" />
                  <line x1="0" y1="180" x2="600" y2="180" stroke="#94a3b8" className="dark:stroke-slate-600" strokeWidth="1" />

                  {/* Barras Ene */}
                  <rect x="50" y="80" width="30" height="100" rx="4" fill="#10b981" fillOpacity="0.85" />
                  <rect x="85" y="145" width="20" height="35" rx="3" fill="#ef4444" fillOpacity="0.75" />

                  {/* Barras Feb */}
                  <rect x="160" y="65" width="30" height="115" rx="4" fill="#10b981" fillOpacity="0.85" />
                  <rect x="195" y="142" width="20" height="38" rx="3" fill="#ef4444" fillOpacity="0.75" />

                  {/* Barras Mar */}
                  <rect x="270" y="55" width="30" height="125" rx="4" fill="#10b981" fillOpacity="0.85" />
                  <rect x="305" y="140" width="20" height="40" rx="3" fill="#ef4444" fillOpacity="0.75" />

                  {/* Barras Abr */}
                  <rect x="380" y="42" width="30" height="138" rx="4" fill="#10b981" fillOpacity="0.85" />
                  <rect x="415" y="138" width="20" height="42" rx="3" fill="#ef4444" fillOpacity="0.75" />

                  {/* Barras May (Actual) */}
                  <rect x="490" y="25" width="30" height="155" rx="4" fill="#059669" className="dark:fill-[#34d399]" />
                  <rect x="525" y="135" width="20" height="45" rx="3" fill="#dc2626" className="dark:fill-[#f87171]" />

                  {/* Trend line for net profit */}
                  <polyline
                    fill="none"
                    stroke="#0284c7"
                    className="dark:stroke-[#38bdf8]"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points="65,115 175,102 285,92 395,78 505,55"
                  />
                  {/* Point circles */}
                  <circle cx="65" cy="115" r="4" fill="#0284c7" className="dark:fill-[#38bdf8]" />
                  <circle cx="175" cy="102" r="4" fill="#0284c7" className="dark:fill-[#38bdf8]" />
                  <circle cx="285" cy="92" r="4" fill="#0284c7" className="dark:fill-[#38bdf8]" />
                  <circle cx="395" cy="78" r="4" fill="#0284c7" className="dark:fill-[#38bdf8]" />
                  <circle cx="505" cy="55" r="5" fill="#0284c7" className="dark:fill-[#38bdf8]" stroke="#ffffff" strokeWidth="2" />
                </svg>

                {/* X Axis Labels */}
                <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 font-mono pt-3 px-6">
                  <span>Ene 2026</span>
                  <span>Feb 2026</span>
                  <span>Mar 2026</span>
                  <span>Abr 2026</span>
                  <span className="text-emerald-700 dark:text-emerald-400 font-bold">May 2026 (En curso)</span>
                </div>
              </div>
            </div>

            {/* GRÁFICO 2: DESGLOSE POR MATERIAL */}
            <div className="bg-white dark:bg-[#1e293b] p-6 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xl space-y-4 flex flex-col justify-between">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
                  <PieChart size={18} className="text-cyan-600 dark:text-cyan-400" />
                  Margen por Material
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Distribución de ingresos según valorización spot en fundición.
                </p>
              </div>

              <div className="space-y-2.5 my-auto">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-200 font-semibold">Cobre & Metales No Ferrosos</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-mono font-bold">$7.762.500 (25%)</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5">
                    <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: '25%' }}></div>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-200 font-semibold">Chatarra Ferrosa & Acero</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-mono font-bold">$8.694.000 (28%)</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5">
                    <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: '28%' }}></div>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-200 font-semibold">Aluminio & Perfiles</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-mono font-bold">$3.726.000 (12%)</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5">
                    <div className="bg-sky-500 h-1.5 rounded-full" style={{ width: '12%' }}></div>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-200 font-semibold">Plásticos Industriales (PET/PEAD)</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-mono font-bold">$4.347.000 (14%)</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5">
                    <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: '14%' }}></div>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-200 font-semibold">Cartón & Papel (OCC / Cajas)</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-mono font-bold">$3.415.500 (11%)</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5">
                    <div className="bg-orange-500 h-1.5 rounded-full" style={{ width: '11%' }}></div>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-200 font-semibold">Vidrio Envases & Botellas</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-mono font-bold">$1.552.500 (5%)</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5">
                    <div className="bg-teal-500 h-1.5 rounded-full" style={{ width: '5%' }}></div>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-200 font-semibold">RAEE (Electrónicos, Motores & Baterías)</span>
                    <span className="text-emerald-700 dark:text-emerald-400 font-mono font-bold">$1.552.500 (5%)</span>
                  </div>
                  <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5">
                    <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: '5%' }}></div>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 flex items-center justify-between font-medium">
                <span>Precio spot de simulación:</span>
                <span className="text-emerald-700 dark:text-emerald-400 font-mono font-bold text-xs">${precioSpot} CLP / kg</span>
              </div>
            </div>
          </div>

          {/* =========================================================================
              MÓDULO DE CONTROL LOGÍSTICO Y RENTABILIDAD DEL DUEÑO
             ========================================================================= */}
          <div className="bg-white dark:bg-[#1e293b] rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xl overflow-hidden">
            {/* Header del Módulo Logístico */}
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0f172a]/70 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white text-base flex items-center gap-2">
                  <Truck size={18} className="text-emerald-500 dark:text-emerald-400" />
                  Módulo de Control Logístico y Rentabilidad por Ruta
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Supervisión directa para Gerencia: Costos operativos de camión, kilometraje, combustible y margen líquido por cliente.
                </p>
              </div>

              {/* Filtros de tabla */}
              <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 dark:bg-[#0b0f19] p-1 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold">
                <button
                  onClick={() => setFilterRuta('todas')}
                  className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${filterRuta === 'todas' ? 'bg-emerald-600 text-white shadow-xs font-bold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                >
                  Todas ({rutasDetalle.length})
                </button>
                <button
                  onClick={() => setFilterRuta('alta')}
                  className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${filterRuta === 'alta' ? 'bg-emerald-600 text-white shadow-xs font-bold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                >
                  Alta Rentabilidad (&gt;80%)
                </button>
                <button
                  onClick={() => setFilterRuta('alerta')}
                  className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${filterRuta === 'alerta' ? 'bg-amber-600 text-white shadow-xs font-bold' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
                >
                  Alerta / Bajo Margen
                </button>
              </div>
            </div>

            {/* KPIs Resumen Logístico del Dueño */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-slate-50/50 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-800/80 text-xs">
              <div className="p-3 bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400 text-[11px] block">Flota en Circuito</span>
                <span className="text-slate-900 dark:text-white font-bold font-mono text-sm">4 Camiones Activos</span>
                <span className="text-[10px] text-slate-500 block">BRX-12, BRX-14, BRX-08, BRX-05</span>
              </div>
              <div className="p-3 bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400 text-[11px] block">Kilómetros Totales</span>
                <span className="text-slate-900 dark:text-white font-bold font-mono text-sm">282 km acumulados</span>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block font-medium">TSP activo (-18% distancia)</span>
              </div>
              <div className="p-3 bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400 text-[11px] block">Combustible Estimado</span>
                <span className="text-slate-900 dark:text-white font-bold font-mono text-sm">~74.2 L Diésel</span>
                <span className="text-[10px] text-slate-500 block">Rendimiento: 3.8 km/L</span>
              </div>
              <div className="p-3 bg-white dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400 text-[11px] block">Retiro Consolidado</span>
                <span className="text-emerald-700 dark:text-emerald-400 font-bold font-mono text-sm">{rutasDetalle.reduce((a, b) => a + b.kilos, 0).toLocaleString('es-CL')} kg</span>
                <span className="text-[10px] text-slate-500 block">Valorizado a tasa spot</span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-700 dark:text-slate-300">
                <thead className="bg-slate-100 dark:bg-[#0f172a] text-slate-700 dark:text-slate-400 text-xs uppercase tracking-wider font-bold border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="px-6 py-4">Ruta / Cliente</th>
                    <th className="px-6 py-4">Camión & Distancia</th>
                    <th className="px-6 py-4 text-right">Costo Operativo</th>
                    <th className="px-6 py-4 text-right">Carga & Valor</th>
                    <th className="px-6 py-4 text-right">Beneficio Neto</th>
                    <th className="px-6 py-4 text-center">Margen Operativo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800/60">
                  {rutasFiltradas.map((ruta) => {
                    const beneficioNeto = ruta.valorMaterial - ruta.costoFlota;
                    const isPositive = ruta.margenPorcentaje > 80;
                    const isLoss = ruta.margenPorcentaje < 0;

                    return (
                      <tr key={ruta.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-slate-900 dark:text-white tracking-wide">{ruta.cliente}</p>
                            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                              ruta.tipo === 'b2b'
                                ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/40'
                                : 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/40'
                            }`}>
                              {ruta.tipo.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {ruta.comuna} · <span className="font-mono text-slate-600 dark:text-slate-300 font-semibold">{ruta.id}</span>
                          </p>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="font-mono text-xs font-bold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200">
                            {ruta.patente}
                          </span>
                          <span className="text-xs text-slate-500 dark:text-slate-400 ml-2 font-mono">{ruta.distanciaKm} km</span>
                        </td>

                        <td className="px-6 py-4 text-right whitespace-nowrap font-mono font-bold text-rose-600 dark:text-red-400">
                          -${ruta.costoFlota.toLocaleString('es-CL')} CLP
                        </td>

                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          <p className="font-mono font-bold text-slate-900 dark:text-white">
                            +${ruta.valorMaterial.toLocaleString('es-CL')} CLP
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                            {ruta.kilos.toLocaleString('es-CL')} kg
                          </p>
                        </td>

                        <td className="px-6 py-4 text-right whitespace-nowrap font-mono font-bold">
                          <span className={beneficioNeto >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-red-400"}>
                            {beneficioNeto >= 0 ? '+' : ''}${beneficioNeto.toLocaleString('es-CL')} CLP
                          </span>
                        </td>

                        <td className="px-6 py-4 text-center whitespace-nowrap">
                          {isPositive ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 border border-emerald-300 text-emerald-800 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400 font-mono">
                              <CheckCircle2 size={12} /> {ruta.margenPorcentaje}%
                            </span>
                          ) : isLoss ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 border border-rose-300 text-rose-800 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 font-mono">
                              <AlertTriangle size={12} /> {ruta.margenPorcentaje}% (Déficit)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 border border-amber-300 text-amber-800 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400 font-mono">
                              <AlertTriangle size={12} /> {ruta.margenPorcentaje}% (Alerta)
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0f172a]/40 flex flex-col sm:flex-row justify-between items-center text-xs text-slate-600 dark:text-slate-400 gap-2">
              <span className="flex items-center gap-1 font-mono">
                <ShieldCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
                Auditoría Contable Interna · Tasa de Valorización Actualizada
              </span>
              <span>
                Mostrando <strong className="text-slate-900 dark:text-white font-bold">{rutasFiltradas.length}</strong> rutas analizadas
              </span>
            </div>
          </div>
        </div>

        {/* MODAL EDITAR PRECIOS OFICIALES (SOLO ROL DUEÑO) */}
        {modalEditarPrecios && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in">
            <div className="bg-[#1e293b] border border-amber-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-6 relative">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400">
                    <Sliders size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base">Fijar Precios Oficiales de Mercado</h3>
                    <p className="text-xs text-slate-400">Gobernanza de Precios · Rol Dueño</p>
                  </div>
                </div>
                <button
                  onClick={() => setModalEditarPrecios(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleGuardarPreciosOficiales} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <DollarSign size={14} className="text-emerald-400" />
                    Precio Oficial Metal / Chatarra ($ CLP / kg)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100000"
                    step="1"
                    value={tempPrecioMetal}
                    onChange={(e) => setTempPrecioMetal(Number(e.target.value))}
                    className="w-full bg-[#0b0f19] border border-slate-700 rounded-xl px-4 py-2.5 text-white font-mono font-bold text-sm focus:outline-none focus:border-amber-500"
                    required
                  />
                  <p className="text-[11px] text-slate-500">
                    Precio medio de tasación spot para valorizar los kilos recibidos en romana (configurable a criterio de Gerencia).
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Fuel size={14} className="text-red-400" />
                    Precio Oficial Diésel ENAP ($ CLP / Litro)
                  </label>
                  <input
                    type="number"
                    min="100"
                    max="10000"
                    step="1"
                    value={tempPrecioDiesel}
                    onChange={(e) => setTempPrecioDiesel(Number(e.target.value))}
                    className="w-full bg-[#0b0f19] border border-slate-700 rounded-xl px-4 py-2.5 text-white font-mono font-bold text-sm focus:outline-none focus:border-amber-500"
                    required
                  />
                  <p className="text-[11px] text-slate-500">
                    Tarifa de combustible oficial para el cálculo del OPEX logístico y ahorro en rutas.
                  </p>
                </div>

                <div className="bg-amber-950/30 border border-amber-800/40 p-3 rounded-xl text-xs text-amber-300 space-y-1">
                  <span className="font-bold flex items-center gap-1">
                    <ShieldCheck size={14} /> Principio de Menor Privilegio (RBAC):
                  </span>
                  <p className="text-[11px] text-amber-200/80 leading-relaxed">
                    Al confirmar, estos dos valores se convertirán en la tasa maestra oficial del ERP. Los operarios de romana y logística no pueden modificarlos sin autorización del Dueño.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalEditarPrecios(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-800 transition-all cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-500 text-white transition-all shadow-md shadow-amber-950/40 cursor-pointer flex items-center gap-1.5"
                  >
                    <Check size={14} />
                    <span>Guardar y Aplicar al Sistema</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
