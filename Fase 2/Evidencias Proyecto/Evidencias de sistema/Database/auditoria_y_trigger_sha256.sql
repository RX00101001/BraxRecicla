-- ====================================================================
-- BRAXRECICLA SpA - BLINDAJE DE INTEGRIDAD CRIPTOGRÁFICA Y AUDITORÍA
-- Trigger SHA-256 en Base de Datos + Registro de Auditoría Inmutable (ISO 27001)
-- ====================================================================

-- 1. EXTENSIÓN CRIPTOGRÁFICA
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. FUNCIÓN DE TRIGGER: CÁLCULO CRIPTOGRÁFICO FORZOSO EN POSTGRESQL (ACID)
CREATE OR REPLACE FUNCTION fn_blindar_certificado_sha256()
RETURNS TRIGGER AS $$
BEGIN
    -- Si el cargamento tiene peso verificado en romana (> 0 kg)
    IF NEW.kilos_reales > 0 THEN
        NEW.estado := 'Certificado Emitido';

        -- Si el hash es nulo, vacío o se alteraron los kilos, se recalcula forzosamente en el motor
        IF NEW.hash_certificado IS NULL 
           OR NEW.hash_certificado = '' 
           OR (TG_OP = 'UPDATE' AND OLD.kilos_reales IS DISTINCT FROM NEW.kilos_reales) THEN
            NEW.hash_certificado := encode(
                digest(
                    NEW.id::text || NEW.rut || NEW.kilos_reales::text || COALESCE(NEW.fecha_solicitud::text, now()::text), 
                    'sha256'
                ), 
                'hex'
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. ASOCIAR TRIGGER A SOLICITUDES_B2B
DROP TRIGGER IF EXISTS trg_blindar_certificado_sha256 ON public.solicitudes_b2b;
CREATE TRIGGER trg_blindar_certificado_sha256
BEFORE INSERT OR UPDATE ON public.solicitudes_b2b
FOR EACH ROW
EXECUTE FUNCTION fn_blindar_certificado_sha256();

-- 4. TABLA DE AUDITORÍA FORENSE INMUTABLE (ISO/IEC 27001 / LEY Nº 21.719)
CREATE TABLE IF NOT EXISTS public.logs_auditoria_sistema (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID,
    usuario_email VARCHAR(150),
    rol VARCHAR(50),
    accion VARCHAR(100) NOT NULL, -- PESAJE_REGISTRADO, CERTIFICADO_EMITIDO, etc.
    tabla_afectada VARCHAR(100),
    registro_id UUID,
    detalle JSONB,
    ip_origen VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- 5. BLINDAJE RLS APPEND-ONLY (ESTRICTAMENTE PROHIBIDO UPDATE Y DELETE)
ALTER TABLE public.logs_auditoria_sistema ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.logs_auditoria_sistema FROM anon, public;
REVOKE UPDATE, DELETE ON public.logs_auditoria_sistema FROM authenticated;
GRANT INSERT, SELECT ON public.logs_auditoria_sistema TO authenticated;
GRANT INSERT ON public.logs_auditoria_sistema TO anon;

DROP POLICY IF EXISTS "logs_insert_all" ON public.logs_auditoria_sistema;
CREATE POLICY "logs_insert_all" 
ON public.logs_auditoria_sistema 
FOR INSERT TO public 
WITH CHECK (true);

DROP POLICY IF EXISTS "logs_select_authenticated" ON public.logs_auditoria_sistema;
CREATE POLICY "logs_select_authenticated" 
ON public.logs_auditoria_sistema 
FOR SELECT TO authenticated 
USING (true);

-- 6. TRIGGER AUTOMÁTICO DE AUDITORÍA ANTE CUALQUIER CAMBIO EN PESAJE O ESTADO
CREATE OR REPLACE FUNCTION fn_auditar_solicitudes_b2b()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'UPDATE' AND (OLD.kilos_reales IS DISTINCT FROM NEW.kilos_reales OR OLD.estado IS DISTINCT FROM NEW.estado)) THEN
        INSERT INTO public.logs_auditoria_sistema (
            usuario_id,
            accion,
            tabla_afectada,
            registro_id,
            detalle
        ) VALUES (
            auth.uid(),
            CASE 
                WHEN COALESCE(OLD.kilos_reales, 0) = 0 AND NEW.kilos_reales > 0 THEN 'PESAJE_INICIAL_REGISTRADO'
                ELSE 'MODIFICACION_PESAJE_O_ESTADO'
            END,
            'solicitudes_b2b',
            NEW.id,
            jsonb_build_object(
                'razon_social', NEW.razon_social,
                'rut', NEW.rut,
                'kilos_anteriores', OLD.kilos_reales,
                'kilos_nuevos', NEW.kilos_reales,
                'estado_anterior', OLD.estado,
                'estado_nuevo', NEW.estado,
                'hash_certificado', NEW.hash_certificado
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auditar_solicitudes_b2b ON public.solicitudes_b2b;
CREATE TRIGGER trg_auditar_solicitudes_b2b
AFTER UPDATE ON public.solicitudes_b2b
FOR EACH ROW
EXECUTE FUNCTION fn_auditar_solicitudes_b2b();
