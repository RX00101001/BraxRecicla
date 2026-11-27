-- Ejecuta esto en el SQL Editor de Supabase para arreglar los permisos

-- 1. Eliminar las políticas restrictivas anteriores (si se crearon)
DROP POLICY IF EXISTS "Permitir inserts publicos b2c" ON solicitudes_b2c;
DROP POLICY IF EXISTS "Permitir inserts publicos b2b" ON solicitudes_b2b;
DROP POLICY IF EXISTS "Permitir select admin b2c" ON solicitudes_b2c;
DROP POLICY IF EXISTS "Permitir update admin b2c" ON solicitudes_b2c;
DROP POLICY IF EXISTS "Permitir select admin b2b" ON solicitudes_b2b;
DROP POLICY IF EXISTS "Permitir update admin b2b" ON solicitudes_b2b;

-- 2. Crear nuevas políticas que permiten el acceso anónimo (anon key)
-- (Ideal para la etapa de desarrollo y la presentación del Capstone)

CREATE POLICY "Enable all operations for anon on b2c" 
ON solicitudes_b2c FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Enable all operations for anon on b2b" 
ON solicitudes_b2b FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Enable all operations for anon on telemetria" 
ON telemetria_flota FOR ALL TO anon USING (true) WITH CHECK (true);
