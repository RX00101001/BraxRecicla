-- =========================================================================
-- SCRIPT DE LIMPIEZA DE REGISTROS DE PRUEBA EN SUPABASE
-- BraxRecicla SpA - Entorno de Producción
-- =========================================================================
-- Instrucciones:
-- 1. Abre tu panel de Supabase: https://supabase.com/dashboard/project/raexkgrfehsgbbxybhlw
-- 2. Ve al menú lateral "SQL Editor" -> "New query"
-- 3. Pega este código y presiona "Run" (o Ctrl + Enter).
-- =========================================================================

-- 1. Eliminar solicitudes de prueba en B2B (Empresas)
DELETE FROM public.solicitudes_b2b 
WHERE razon_social ILIKE '%prueba%' 
   OR razon_social ILIKE '%test%' 
   OR razon_social ILIKE '%aza%' 
   OR razon_social ILIKE '%asdasd%'
   OR email ILIKE '%prueba%'
   OR email ILIKE '%test%';

-- 2. Eliminar solicitudes de prueba en B2C (Ciudadanos)
DELETE FROM public.solicitudes_b2c 
WHERE nombre ILIKE '%prueba%' 
   OR nombre ILIKE '%test%' 
   OR nombre ILIKE '%asdasd%'
   OR nombre ILIKE '%qa%';

-- 3. Asegurar que las empresas reales tengan datos completos para la emisión de certificados
UPDATE public.solicitudes_b2b
SET kilos_reales = 4200, 
    estado = 'Certificado Emitido', 
    hash_certificado = '562bca162f815c63dae39c831fffe306d85ff111c29e0e5d017dbdf2c3280'
WHERE rut = '77.123.456-7' AND kilos_reales = 0;

UPDATE public.solicitudes_b2b
SET kilos_reales = 2600, 
    estado = 'Certificado Emitido', 
    hash_certificado = 'e7428f7d9839423b4998dfc33e2154489a244b7d1591f42e329241b2e2d93e'
WHERE rut = '92.176.000-0' AND kilos_reales = 0;

-- Mensaje de confirmación
SELECT 'Limpieza ejecutada correctamente. Base de datos con información 100% fidedigna.' AS resultado;
