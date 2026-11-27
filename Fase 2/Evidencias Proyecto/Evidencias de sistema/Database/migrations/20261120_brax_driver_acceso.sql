BEGIN;

-- Staff authorization is resolved from the current user's persisted ERP role.
CREATE OR REPLACE FUNCTION public.brax_driver_rol_erp()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rol text;
BEGIN
 IF to_regclass('public.erp_roles') IS NOT NULL THEN
  SELECT lower(btrim(r.role::text)) INTO rol FROM public.erp_roles r
   WHERE r.user_id=auth.uid()
   ORDER BY CASE lower(btrim(r.role::text))
    WHEN 'admin' THEN 0 WHEN 'administrador' THEN 0 WHEN 'dueno' THEN 0
    WHEN 'operador' THEN 1 ELSE 2 END, r.role::text
   LIMIT 1;
 ELSIF to_regclass('public.perfiles_usuarios') IS NOT NULL THEN
  SELECT lower(btrim(p.rol::text)) INTO rol FROM public.perfiles_usuarios p WHERE p.id=auth.uid();
 END IF;
 RETURN rol;
END $$;
REVOKE ALL ON FUNCTION public.brax_driver_rol_erp() FROM PUBLIC,anon,authenticated;

DO $$ BEGIN
 IF to_regclass('public.erp_profiles') IS NOT NULL THEN
  ALTER TABLE public.erp_profiles ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS brax_movil_lee_perfil_propio ON public.erp_profiles;
  CREATE POLICY brax_movil_lee_perfil_propio ON public.erp_profiles FOR SELECT TO authenticated
   USING (user_id=(SELECT auth.uid()));
  GRANT SELECT (user_id,display_name) ON public.erp_profiles TO authenticated;
 END IF;
 IF to_regclass('public.erp_roles') IS NOT NULL THEN
  REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.erp_roles FROM PUBLIC,anon,authenticated;
  REVOKE INSERT (user_id,role),UPDATE (user_id,role) ON public.erp_roles FROM PUBLIC,anon,authenticated;
 ELSIF to_regclass('public.perfiles_usuarios') IS NOT NULL THEN
  REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.perfiles_usuarios FROM PUBLIC,anon,authenticated;
  REVOKE INSERT (id,rol),UPDATE (id,rol) ON public.perfiles_usuarios FROM PUBLIC,anon,authenticated;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.brax_driver_autorizado()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (SELECT 1 FROM auth.users WHERE id=auth.uid() AND raw_app_meta_data->>'role'='driver')
   AND coalesce(auth.jwt()->'app_metadata'->>'role'='driver',false)
   AND coalesce(public.brax_driver_rol_erp(),'') NOT IN ('admin','administrador','dueno','operador')
$$;
REVOKE ALL ON FUNCTION public.brax_driver_autorizado() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brax_driver_autorizado() TO authenticated;

-- This RPC returns only the caller's account. ERP administrative privileges and MFA stay in the ERP.
CREATE OR REPLACE FUNCTION public.brax_driver_cuenta()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
 uid uuid := auth.uid();
 rol text;
 nombre text;
 tiene_perfil boolean := false;
 rol_auth text;
 modo text;
BEGIN
 IF uid IS NULL THEN
  RAISE EXCEPTION 'Se necesita una sesión válida.' USING ERRCODE='BR001';
 END IF;
 SELECT raw_app_meta_data->>'role' INTO rol_auth FROM auth.users WHERE id=uid;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'Se necesita una sesión válida.' USING ERRCODE='BR001';
 END IF;

 rol := public.brax_driver_rol_erp();
 IF rol='operador' THEN
  RAISE EXCEPTION 'El rol de operador no tiene acceso a Driver.' USING ERRCODE='BR003';
 END IF;

 IF to_regclass('public.erp_profiles') IS NOT NULL THEN
  SELECT p.display_name INTO nombre FROM public.erp_profiles p WHERE p.user_id=uid;
  tiene_perfil := FOUND;
 ELSIF to_regclass('public.perfiles_usuarios') IS NOT NULL THEN
  SELECT coalesce(to_jsonb(p)->>'nombre_completo',to_jsonb(p)->>'nombre')
   INTO nombre FROM public.perfiles_usuarios p WHERE p.id=uid;
  tiene_perfil := FOUND;
 END IF;

 IF rol IN ('admin','administrador','dueno') THEN
  IF NOT tiene_perfil THEN
   RAISE EXCEPTION 'Falta el perfil de esta cuenta.' USING ERRCODE='BR002';
  END IF;
  modo := 'administrador';
 ELSIF public.brax_driver_autorizado() THEN
  modo := 'conductor';
 ELSIF rol_auth='driver' THEN
  RAISE EXCEPTION 'La sesión no tiene el rol actualizado.' USING ERRCODE='BR004';
 ELSIF NOT tiene_perfil THEN
  RAISE EXCEPTION 'Falta el perfil de esta cuenta.' USING ERRCODE='BR002';
 ELSE
  RAISE EXCEPTION 'La cuenta no tiene un rol autorizado para Driver.' USING ERRCODE='BR003';
 END IF;

 RETURN jsonb_build_object('modo',modo,'nombre',nullif(btrim(nombre),''));
END $$;
REVOKE ALL ON FUNCTION public.brax_driver_cuenta() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brax_driver_cuenta() TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
