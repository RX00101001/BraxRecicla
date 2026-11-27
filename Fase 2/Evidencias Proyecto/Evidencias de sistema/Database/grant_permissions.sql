-- ==========================================
-- SCRIPT DEFINITIVO DE PERMISOS SUPABASE
-- ==========================================

-- 1. Desactivar el Firewall (RLS) en todas las tablas para la Demo
ALTER TABLE solicitudes_b2c DISABLE ROW LEVEL SECURITY;
ALTER TABLE solicitudes_b2b DISABLE ROW LEVEL SECURITY;
ALTER TABLE telemetria_flota DISABLE ROW LEVEL SECURITY;

-- 2. Otorgar permisos a nivel de base de datos al rol 'anon' (El error que te salía)
GRANT ALL ON public.solicitudes_b2c TO anon;
GRANT ALL ON public.solicitudes_b2b TO anon;
GRANT ALL ON public.telemetria_flota TO anon;
GRANT ALL ON public.solicitudes_b2c TO authenticated;
GRANT ALL ON public.solicitudes_b2b TO authenticated;
GRANT ALL ON public.telemetria_flota TO authenticated;

-- 3. Asegurar el uso de las secuencias UUID
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
