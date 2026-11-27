-- =========================================================================
-- BRAXRECICLA SpA - REGLAS DE ACCESO PARA FORMULARIOS WEB Y OPERADOR
-- =========================================================================
-- Instrucciones:
-- 1. Abre Supabase: https://supabase.com/dashboard/project/raexkgrfehsgbbxybhlw/sql
-- 2. Pega este script completo y haz clic en "Run" (o presiona Ctrl + Enter).
-- =========================================================================

-- 1. Permisos de base de datos a nivel de esquema y tablas
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON public.solicitudes_b2b TO anon, authenticated;
GRANT ALL ON public.solicitudes_b2c TO anon, authenticated;
GRANT ALL ON public.telemetria_flota TO anon, authenticated;

-- 2. Asegurar que RLS esté activo
ALTER TABLE public.solicitudes_b2b ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.solicitudes_b2c ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetria_flota ENABLE ROW LEVEL SECURITY;

-- 3. Políticas para solicitudes_b2b (Empresas / Pesaje en Romana)
DROP POLICY IF EXISTS "b2b_insert_publico" ON public.solicitudes_b2b;
CREATE POLICY "b2b_insert_publico" 
ON public.solicitudes_b2b 
FOR INSERT TO anon 
WITH CHECK (true);

DROP POLICY IF EXISTS "b2b_insert_authenticated" ON public.solicitudes_b2b;
CREATE POLICY "b2b_insert_authenticated" 
ON public.solicitudes_b2b 
FOR INSERT TO authenticated 
WITH CHECK (true);

DROP POLICY IF EXISTS "b2b_select_authenticated" ON public.solicitudes_b2b;
CREATE POLICY "b2b_select_authenticated" 
ON public.solicitudes_b2b 
FOR SELECT TO authenticated 
USING (true);

DROP POLICY IF EXISTS "b2b_update_authenticated" ON public.solicitudes_b2b;
CREATE POLICY "b2b_update_authenticated" 
ON public.solicitudes_b2b 
FOR UPDATE TO authenticated 
USING (true) 
WITH CHECK (true);

DROP POLICY IF EXISTS "b2b_verificar_publico" ON public.solicitudes_b2b;
CREATE POLICY "b2b_verificar_publico" 
ON public.solicitudes_b2b 
FOR SELECT TO anon 
USING (hash_certificado IS NOT NULL OR kilos_reales > 0 OR estado IN ('Certificado Emitido', 'Completado', 'Aprobado', 'Pesado'));

-- 4. Políticas para solicitudes_b2c (Ciudadanos / Retiros Domiciliarios)
DROP POLICY IF EXISTS "b2c_insert_publico" ON public.solicitudes_b2c;
CREATE POLICY "b2c_insert_publico" 
ON public.solicitudes_b2c 
FOR INSERT TO anon 
WITH CHECK (true);

DROP POLICY IF EXISTS "b2c_insert_authenticated" ON public.solicitudes_b2c;
CREATE POLICY "b2c_insert_authenticated" 
ON public.solicitudes_b2c 
FOR INSERT TO authenticated 
WITH CHECK (true);

-- Permitir a todo el personal autenticado (Admin, Dueño, Operador, Chofer)
-- leer solicitudes B2C para alimentar los contadores del panel y planificar rutas
DROP POLICY IF EXISTS "b2c_select_authenticated" ON public.solicitudes_b2c;
CREATE POLICY "b2c_select_authenticated" 
ON public.solicitudes_b2c 
FOR SELECT TO authenticated 
USING (true);

DROP POLICY IF EXISTS "b2c_update_authenticated" ON public.solicitudes_b2c;
CREATE POLICY "b2c_update_authenticated" 
ON public.solicitudes_b2c 
FOR UPDATE TO authenticated 
USING (true) 
WITH CHECK (true);

-- 5. Políticas para telemetria_flota (IoT LilyGO T-A7670G)
DROP POLICY IF EXISTS "telemetria_insert_iot" ON public.telemetria_flota;
CREATE POLICY "telemetria_insert_iot" 
ON public.telemetria_flota 
FOR INSERT TO anon, authenticated 
WITH CHECK (true);

DROP POLICY IF EXISTS "telemetria_select_all" ON public.telemetria_flota;
CREATE POLICY "telemetria_select_all" 
ON public.telemetria_flota 
FOR SELECT TO anon, authenticated 
USING (true);

-- 6. Tabla y Políticas para Sincronización de Rutas del Chofer en Terreno
CREATE TABLE IF NOT EXISTS public.rutas_activas_flota (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    patente_camion TEXT NOT NULL,
    conductor TEXT NOT NULL,
    fecha TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'Planificada',
    paradas JSONB NOT NULL DEFAULT '[]'::jsonb,
    actualizado_en TIMESTAMPTZ DEFAULT timezone('utc', now())
);

ALTER TABLE public.rutas_activas_flota ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.rutas_activas_flota TO anon, authenticated;

DROP POLICY IF EXISTS "rutas_all_authenticated" ON public.rutas_activas_flota;
CREATE POLICY "rutas_all_authenticated" 
ON public.rutas_activas_flota 
FOR ALL TO authenticated 
USING (true) 
WITH CHECK (true);

DROP POLICY IF EXISTS "rutas_select_anon" ON public.rutas_activas_flota;
CREATE POLICY "rutas_select_anon" 
ON public.rutas_activas_flota 
FOR SELECT TO anon 
USING (true);
