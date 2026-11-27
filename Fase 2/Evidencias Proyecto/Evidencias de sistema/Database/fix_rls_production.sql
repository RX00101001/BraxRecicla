-- ====================================================================
-- BRAXRECICLA SpA - BLINDAJE DE PRODUCCIÓN SUPABASE (IDEMPOTENTE)
-- Puedes copiar todo este bloque, pegarlo en SQL Editor y presionar RUN.
-- ====================================================================

-- 1. ACTIVAR ROW LEVEL SECURITY (RLS)
ALTER TABLE public.solicitudes_b2c ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitudes_b2b ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetria_flota ENABLE ROW LEVEL SECURITY;

-- 2. REVOCAR PERMISOS DESTRUCTIVOS AL ROL PÚBLICO
REVOKE ALL ON public.solicitudes_b2c FROM anon;
REVOKE ALL ON public.solicitudes_b2b FROM anon;
REVOKE ALL ON public.telemetria_flota FROM anon;

GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Permisos mínimos para anon (Formularios web, verificador e IoT)
GRANT INSERT ON public.solicitudes_b2c TO anon;
GRANT INSERT, SELECT ON public.solicitudes_b2b TO anon;
GRANT INSERT ON public.telemetria_flota TO anon;

-- Permisos completos para el personal autenticado del ERP
GRANT ALL ON public.solicitudes_b2c TO authenticated;
GRANT ALL ON public.solicitudes_b2b TO authenticated;
GRANT ALL ON public.telemetria_flota TO authenticated;

-- 3. POLÍTICAS TABLA B2C (CIUDADANOS)
DROP POLICY IF EXISTS "Enable all operations for anon on b2c" ON public.solicitudes_b2c;
DROP POLICY IF EXISTS "Permitir inserts publicos b2c" ON public.solicitudes_b2c;
DROP POLICY IF EXISTS "Permitir select admin b2c" ON public.solicitudes_b2c;
DROP POLICY IF EXISTS "Permitir update admin b2c" ON public.solicitudes_b2c;
DROP POLICY IF EXISTS "b2c_insert_publico" ON public.solicitudes_b2c;
DROP POLICY IF EXISTS "b2c_admin_total" ON public.solicitudes_b2c;

CREATE POLICY "b2c_insert_publico" 
ON public.solicitudes_b2c 
FOR INSERT TO anon 
WITH CHECK (true);

CREATE POLICY "b2c_admin_total" 
ON public.solicitudes_b2c 
FOR ALL TO authenticated 
USING (true) 
WITH CHECK (true);

-- 4. POLÍTICAS TABLA B2B (EMPRESAS)
DROP POLICY IF EXISTS "Enable all operations for anon on b2b" ON public.solicitudes_b2b;
DROP POLICY IF EXISTS "Permitir inserts publicos b2b" ON public.solicitudes_b2b;
DROP POLICY IF EXISTS "Permitir select admin b2b" ON public.solicitudes_b2b;
DROP POLICY IF EXISTS "Permitir update admin b2b" ON public.solicitudes_b2b;
DROP POLICY IF EXISTS "b2b_insert_publico" ON public.solicitudes_b2b;
DROP POLICY IF EXISTS "b2b_verificar_publico" ON public.solicitudes_b2b;
DROP POLICY IF EXISTS "b2b_admin_total" ON public.solicitudes_b2b;

CREATE POLICY "b2b_insert_publico" 
ON public.solicitudes_b2b 
FOR INSERT TO anon 
WITH CHECK (true);

CREATE POLICY "b2b_verificar_publico" 
ON public.solicitudes_b2b 
FOR SELECT TO anon 
USING (hash_certificado IS NOT NULL OR kilos_reales > 0 OR estado IN ('Certificado Emitido', 'Completado', 'Aprobado', 'Pesado'));

CREATE POLICY "b2b_admin_total" 
ON public.solicitudes_b2b 
FOR ALL TO authenticated 
USING (true) 
WITH CHECK (true);

-- 5. POLÍTICAS TELEMETRÍA FLOTA (IoT)
DROP POLICY IF EXISTS "Enable all operations for anon on telemetria" ON public.telemetria_flota;
DROP POLICY IF EXISTS "telemetria_insert_iot" ON public.telemetria_flota;
DROP POLICY IF EXISTS "telemetria_admin_all" ON public.telemetria_flota;

CREATE POLICY "telemetria_insert_iot" 
ON public.telemetria_flota 
FOR INSERT TO anon 
WITH CHECK (true);

CREATE POLICY "telemetria_admin_all" 
ON public.telemetria_flota 
FOR ALL TO authenticated 
USING (true) 
WITH CHECK (true);

-- 6. ASIGNAR HASH CRIPTOGRÁFICO SHA-256 A TODOS LOS REGISTROS PESADOS PENDIENTES
UPDATE public.solicitudes_b2b
SET 
  estado = 'Certificado Emitido',
  hash_certificado = encode(digest(id::text || rut || kilos_reales::text || COALESCE(fecha_solicitud::text, '2026-11-17'), 'sha256'), 'hex')
WHERE (kilos_reales > 0 OR estado = 'Pesado') AND (hash_certificado IS NULL OR hash_certificado = '');
