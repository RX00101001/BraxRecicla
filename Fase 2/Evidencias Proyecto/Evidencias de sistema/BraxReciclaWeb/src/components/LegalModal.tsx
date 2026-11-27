'use client';

import React, { useEffect, useState } from 'react';
import { 
  X, 
  ShieldCheck, 
  FileText, 
  Lock, 
  Scale, 
  CheckCircle2, 
  Leaf, 
  ExternalLink,
  Building,
  Mail,
  Calendar,
  AlertCircle
} from 'lucide-react';

export type LegalTab = 'terms' | 'privacy' | 'rep';

interface LegalModalProps {
  isOpen: boolean;
  initialTab?: LegalTab;
  onClose: () => void;
}

export default function LegalModal({ isOpen, initialTab = 'terms', onClose }: LegalModalProps) {
  const [activeTab, setActiveTab] = useState<LegalTab>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      
      {/* Backdrop click to dismiss */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Modal Card */}
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col z-10 text-slate-200">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Scale size={20} />
            </div>
            <div>
              <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight flex items-center gap-2">
                Marco Legal & Regulatorio
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-medium">
                  Chile
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                BraxRecicla SpA · Operaciones bajo normativa de la República de Chile
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Cerrar ventana"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 px-6 gap-2 sm:gap-4 overflow-x-auto">
          <button
            onClick={() => setActiveTab('terms')}
            className={`py-3.5 px-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'terms'
                ? 'border-emerald-400 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText size={16} />
            <span>Términos del Servicio</span>
          </button>

          <button
            onClick={() => setActiveTab('privacy')}
            className={`py-3.5 px-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'privacy'
                ? 'border-emerald-400 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Lock size={16} />
            <span>Seguridad & Privacidad (Ley N° 21.719)</span>
          </button>

          <button
            onClick={() => setActiveTab('rep')}
            className={`py-3.5 px-3 text-xs sm:text-sm font-semibold border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
              activeTab === 'rep'
                ? 'border-emerald-400 text-emerald-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Leaf size={16} />
            <span>Ley REP & SINADER</span>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 sm:p-8 space-y-6 text-sm text-slate-300 leading-relaxed font-sans">
          
          {/* TAB 1: TÉRMINOS DEL SERVICIO */}
          {activeTab === 'terms' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-2xl p-4 flex items-start gap-3">
                <ShieldCheck size={20} className="text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-300">
                  <p className="font-bold text-white mb-1">Validez y Jurisdicción</p>
                  Los presentes Términos y Condiciones regulan la prestación de servicios de retiro, pesaje y valorización de residuos no peligrosos por parte de BraxRecicla SpA, con domicilio en la Región Metropolitana de Santiago, Chile.
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-base font-bold text-white border-b border-slate-800 pb-2">
                  1. Objeto y Alcance del Servicio
                </h4>
                <p>
                  BraxRecicla SpA ofrece servicios de logística inversa, recolección programada, transporte y valorización de residuos sólidos no peligrosos (metales ferrosos y no ferrosos, plásticos PET y PEAD, cartón, papel y RAEE) para personas naturales, comunidades residenciales e industrias dentro del territorio nacional.
                </p>

                <h4 className="text-base font-bold text-white border-b border-slate-800 pb-2 pt-2">
                  2. Procedimiento de Pesaje y Calibración
                </h4>
                <p>
                  Para retiros industriales y corporativos B2B, el pesaje se efectúa directamente en el punto de carga mediante báscula romana con protocolo de comunicación serial RS-232, garantizando la captura electrónica del peso bruto y tara en tiempo real sin intervención manual, con un margen de tolerancia metrológica de hasta 0.02%.
                </p>

                <h4 className="text-base font-bold text-white border-b border-slate-800 pb-2 pt-2">
                  3. Certificados de Trazabilidad y Sello Digital
                </h4>
                <p>
                  Cada operación completada da origen a un Acta y Certificado Electrónico de Valorización, dotado de un código identificador único y hash criptográfico SHA-256. Dicho documento es válido para ser presentado en auditorías ambientales, memorias de sostenibilidad y declaraciones periódicas obligatorias ante el Ministerio del Medio Ambiente (MMA).
                </p>

                <h4 className="text-base font-bold text-white border-b border-slate-800 pb-2 pt-2">
                  4. Obligaciones y Declaración del Usuario
                </h4>
                <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-300">
                  <li>Garantizar que los residuos entregados no contengan materiales peligrosos según la clasificación del D.S. N° 148 del Ministerio de Salud.</li>
                  <li>Proveer acceso seguro y expedito para los vehículos y personal técnico de recolección en la dirección informada.</li>
                  <li>Verificar la exactitud del RUT o razón social informada para la correcta emisión de los certificados tributarios y ambientales.</li>
                </ul>

                <h4 className="text-base font-bold text-white border-b border-slate-800 pb-2 pt-2">
                  5. Destino de los Residuos
                </h4>
                <p>
                  BraxRecicla SpA declara que el 100% de los residuos aptos son derivados exclusivamente a plantas de fundición, trituración y reciclaje formalmente autorizadas por la SEREMI de Salud y registradas ante la Ventanilla Única del RETC / SINADER, garantizando la política de Cero Vertedero.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: POLÍTICA DE PRIVACIDAD & LEY 21.719 */}
          {activeTab === 'privacy' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="bg-teal-950/30 border border-teal-500/30 rounded-2xl p-4 flex items-start gap-3">
                <Lock size={20} className="text-teal-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-300">
                  <p className="font-bold text-white mb-1">Protección de Datos conforme a la Ley N° 21.719 y Ley N° 19.628</p>
                  En BraxRecicla SpA tratamos sus datos personales con los más altos estándares de seguridad digital, garantizando la confidencialidad, integridad y respeto a sus derechos fundamentales.
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-base font-bold text-white border-b border-slate-800 pb-2">
                  1. Base de Licitud y Finalidad del Tratamiento
                </h4>
                <p>
                  Los datos personales recabados a través de nuestros formularios (nombre, RUT, correo electrónico, dirección y comuna) son tratados en virtud de su consentimiento libre, informado e inequívoco, con las siguientes finalidades exclusivas:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-xs text-slate-300">
                  <li>Coordinación logística y programación del retiro de materiales reciclables.</li>
                  <li>Emisión y despacho de certificados oficiales de pesaje y valorización.</li>
                  <li>Validación de personería jurídica o residencial para trazabilidad ambiental.</li>
                </ul>

                <h4 className="text-base font-bold text-white border-b border-slate-800 pb-2 pt-2">
                  2. No Comercialización ni Cesión a Terceros
                </h4>
                <p>
                  BraxRecicla SpA no vende, cede, arrienda ni transfiere bajo ninguna circunstancia los datos personales de sus usuarios o clientes a empresas de publicidad, bases comerciales ni intermediarios. La información solo podrá ser comunicada a la autoridad fiscalizadora (Superintendencia del Medio Ambiente o Ministerio del Medio Ambiente) cuando exista requerimiento legal explícito en el marco del SINADER.
                </p>

                <h4 className="text-base font-bold text-white border-b border-slate-800 pb-2 pt-2">
                  3. Derechos de los Titulares (Derechos ARCO)
                </h4>
                <p>
                  De conformidad con la Ley N° 21.719 sobre Protección de Datos Personales, usted puede ejercer en cualquier momento sus derechos de:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                    <span className="font-bold text-white text-xs block">Acceso & Rectificación</span>
                    <span className="text-[11px] text-slate-400">Consultar los datos almacenados y solicitar la corrección de datos desactualizados o inexactos.</span>
                  </div>
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                    <span className="font-bold text-white text-xs block">Cancelación (Supresión)</span>
                    <span className="text-[11px] text-slate-400">Solicitar la eliminación total de sus datos de nuestros registros de contacto.</span>
                  </div>
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                    <span className="font-bold text-white text-xs block">Oposición & Bloqueo</span>
                    <span className="text-[11px] text-slate-400">Oponerse al tratamiento para comunicaciones no operativas.</span>
                  </div>
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                    <span className="font-bold text-white text-xs block">Portabilidad</span>
                    <span className="text-[11px] text-slate-400">Obtener una copia digital de su historial de certificados en formato interoperable.</span>
                  </div>
                </div>

                <p className="text-xs pt-2">
                  Para ejercer estos derechos, basta enviar un correo electrónico con su solicitud a <strong className="text-emerald-400">contacto@braxrecicla.cl</strong> indicando su nombre completo y RUT de respaldo.
                </p>

                <h4 className="text-base font-bold text-white border-b border-slate-800 pb-2 pt-2">
                  4. Medidas de Seguridad Digital
                </h4>
                <p>
                  Toda la comunicación entre su navegador y nuestros servidores viaja cifrada mediante protocolo SSL/TLS con certificados de 256 bits. Los registros de pesaje e informes cuentan con función resumen (Hash SHA-256) para prevenir cualquier alteración posterior.
                </p>
              </div>
            </div>
          )}

          {/* TAB 3: LEY REP & SINADER */}
          {activeTab === 'rep' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="bg-blue-950/30 border border-blue-500/30 rounded-2xl p-4 flex items-start gap-3">
                <Leaf size={20} className="text-blue-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-300">
                  <p className="font-bold text-white mb-1">Responsabilidad Extendida del Productor (Ley N° 20.920)</p>
                  Marco legal que obliga a los generadores, importadores y productores a valorizar sus residuos prioritarios y reportar sus metas periódicas ante el Estado de Chile.
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="text-base font-bold text-white border-b border-slate-800 pb-2">
                  1. Marco Regulatorio Nacional
                </h4>
                <p>
                  La Ley N° 20.920 establece un régimen especial de gestión de residuos y fomento al reciclaje con el objetivo de disminuir la generación de residuos y fomentar su reutilización, reciclaje y otro tipo de valorización, a través de la instauración de la responsabilidad extendida del productor y otros instrumentos de gestión de residuos.
                </p>

                <h4 className="text-base font-bold text-white border-b border-slate-800 pb-2 pt-2">
                  2. Declaración en Ventanilla Única SINADER / RETC
                </h4>
                <p>
                  En cumplimiento del Decreto Supremo N° 1/2013 del Ministerio del Medio Ambiente, todas las operaciones de retiro gestionadas por BraxRecicla SpA se encuentran estructuradas con los parámetros requeridos para la declaración en el Sistema Nacional de Declaración de Residuos (SINADER):
                </p>
                <ul className="list-disc pl-5 space-y-1 text-xs text-slate-300">
                  <li>Código LER / Clasificación estandarizada del residuo.</li>
                  <li>Toneladas netas verificadas con sistema de pesaje calibrado.</li>
                  <li>RUT del transportista debidamente autorizado por la SEREMI de Salud.</li>
                  <li>RUT y código de instalación de la planta de destino final para valorización.</li>
                </ul>

                <h4 className="text-base font-bold text-white border-b border-slate-800 pb-2 pt-2">
                  3. Productos Prioritarios Atendidos
                </h4>
                <p>
                  Prestamos servicios directos de recolección y trazabilidad para los siguientes productos prioritarios contemplados en la Ley REP:
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs pt-1">
                  <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-center font-medium">Envases y Embalajes (Cartón y Plásticos)</div>
                  <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-center font-medium">Aparatos Eléctricos y Electrónicos (RAEE)</div>
                  <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800 text-center font-medium">Metales Ferrosos y No Ferrosos</div>
                </div>

                <h4 className="text-base font-bold text-white border-b border-slate-800 pb-2 pt-2">
                  4. Auditoría y Fiscalización
                </h4>
                <p>
                  La fiscalización del cumplimiento de las metas y obligaciones asociadas a la Ley REP recae en la Superintendencia del Medio Ambiente (SMA). Los certificados emitidos por BraxRecicla SpA constituyen documento fehaciente de respaldo en auditorías y fiscalizaciones técnicas.
                </p>
              </div>
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <Calendar size={14} className="text-emerald-400" />
            <span>Última actualización legal: Octubre 2026 · Versión 2.4</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-6 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold transition-all shadow-lg shadow-emerald-500/20 active:scale-95 cursor-pointer"
            >
              Entendido y Cerrar
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
