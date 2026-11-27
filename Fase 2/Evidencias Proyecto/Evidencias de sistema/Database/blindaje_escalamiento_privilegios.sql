-- ====================================================================
-- BRAXRECICLA SpA - PARCHE DE SEGURIDAD CONTRA ESCALAMIENTO DE PRIVILEGIOS
-- Norma: OWASP Top 10 (A01:2021 - Broken Access Control / CWE-269)
-- Estándar: ISO/IEC 27001 & Ley Nº 21.719 (Protección de Datos Personales)
-- ====================================================================

-- 1. BLINDAR LA TABLA perfiles_usuarios (NADIE PUEDE TOCAR SU ROL NI EL DE OTROS)
ALTER TABLE public.perfiles_usuarios ENABLE ROW LEVEL SECURITY;

-- Revocar permisos de modificación a todos los roles de Supabase
REVOKE UPDATE, DELETE, INSERT ON public.perfiles_usuarios FROM anon, authenticated, public;

-- Solo lectura de su propio perfil para usuarios autenticados
DROP POLICY IF EXISTS "perfil_lectura_propia" ON public.perfiles_usuarios;
CREATE POLICY "perfil_lectura_propia" 
ON public.perfiles_usuarios 
FOR SELECT TO authenticated 
USING (auth.uid() = id);

-- 2. FUNCIÓN DE APOYO PARA CONSULTAR ROL EN TIEMPO DE EJECUCIÓN (SECURITY DEFINER)
-- Se ejecuta con privilegios del sistema para validar el rol sin exponer la tabla
CREATE OR REPLACE FUNCTION public.fn_obtener_mi_rol()
RETURNS VARCHAR AS $$
BEGIN
    RETURN (SELECT rol FROM public.perfiles_usuarios WHERE id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. SEGMENTACIÓN DE POLÍTICAS EN SOLICITUDES_B2B POR ROL
DROP POLICY IF EXISTS "b2b_admin_total" ON public.solicitudes_b2b;
DROP POLICY IF EXISTS "b2b_gestion_admin_dueno" ON public.solicitudes_b2b;
DROP POLICY IF EXISTS "b2b_operacion_chofer_operador" ON public.solicitudes_b2b;
DROP POLICY IF EXISTS "b2b_update_pesaje_operador" ON public.solicitudes_b2b;

-- Administradores y Dueños: Control total
CREATE POLICY "b2b_gestion_admin_dueno" 
ON public.solicitudes_b2b 
FOR ALL TO authenticated 
USING (public.fn_obtener_mi_rol() IN ('admin', 'dueno'))
WITH CHECK (public.fn_obtener_mi_rol() IN ('admin', 'dueno'));

-- Choferes y Operadores: Solo lectura restringida y registro de pesajes autorizados
CREATE POLICY "b2b_operacion_chofer_operador" 
ON public.solicitudes_b2b 
FOR SELECT TO authenticated 
USING (public.fn_obtener_mi_rol() IN ('operador', 'chofer'));

CREATE POLICY "b2b_update_pesaje_operador" 
ON public.solicitudes_b2b 
FOR UPDATE TO authenticated 
USING (public.fn_obtener_mi_rol() IN ('operador', 'admin', 'dueno'))
WITH CHECK (public.fn_obtener_mi_rol() IN ('operador', 'admin', 'dueno'));

-- 4. SEGMENTACIÓN EN SOLICITUDES_B2C (PROTECCIÓN ESTRICTA LEY Nº 21.719)
DROP POLICY IF EXISTS "b2c_admin_total" ON public.solicitudes_b2c;
DROP POLICY IF EXISTS "b2c_acceso_restringido_roles" ON public.solicitudes_b2c;
DROP POLICY IF EXISTS "b2c_chofer_solo_lectura_rutas" ON public.solicitudes_b2c;

CREATE POLICY "b2c_acceso_restringido_roles" 
ON public.solicitudes_b2c 
FOR ALL TO authenticated 
USING (public.fn_obtener_mi_rol() IN ('admin', 'dueno'))
WITH CHECK (public.fn_obtener_mi_rol() IN ('admin', 'dueno'));

CREATE POLICY "b2c_chofer_solo_lectura_rutas" 
ON public.solicitudes_b2c 
FOR SELECT TO authenticated 
USING (public.fn_obtener_mi_rol() = 'chofer');
