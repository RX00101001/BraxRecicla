BEGIN;

ALTER TABLE public.flota_rutas ADD COLUMN IF NOT EXISTS conductor_id uuid REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS flota_rutas_conductor ON public.flota_rutas(conductor_id, fecha);

-- The driver claim is provisioned by an administrator through Auth app_metadata.
CREATE OR REPLACE FUNCTION public.brax_es_driver()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(auth.jwt()->'app_metadata'->>'role'='driver', false)
    OR EXISTS (SELECT 1 FROM auth.users WHERE id=auth.uid() AND raw_app_meta_data->>'role'='driver')
$$;

CREATE OR REPLACE FUNCTION public.brax_driver_autorizado()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (SELECT 1 FROM auth.users WHERE id=auth.uid() AND raw_app_meta_data->>'role'='driver')
   AND coalesce(auth.jwt()->'app_metadata'->>'role'='driver', false)
$$;
REVOKE ALL ON FUNCTION public.brax_es_driver(),public.brax_driver_autorizado() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brax_es_driver(),public.brax_driver_autorizado() TO authenticated;

CREATE OR REPLACE FUNCTION public.flota_plan_autorizar(escritura boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rol text := public.erp_role();
BEGIN
 IF auth.uid() IS NULL OR public.brax_es_driver() OR coalesce(auth.jwt()->>'aal','') <> 'aal2'
 OR coalesce(rol,'') NOT IN ('administrador','admin','operador','dueno')
 OR (escritura AND rol NOT IN ('administrador','admin','dueno')) THEN
  RAISE EXCEPTION 'No tienes permiso para esta operación de flota.' USING ERRCODE='42501';
 END IF;
END $$;

-- Legacy permissive policies may still exist. Driver access goes through the scoped RPCs.
DO $$
DECLARE tabla text;
BEGIN
 FOREACH tabla IN ARRAY ARRAY['solicitudes_b2b','solicitudes_b2c','telemetria_flota',
     'flota_rutas','flota_paradas','flota_ubicaciones','flota_camiones','flota_eventos'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tabla);
  EXECUTE format('DROP POLICY IF EXISTS brax_driver_rpc_only ON public.%I', tabla);
  EXECUTE format('CREATE POLICY brax_driver_rpc_only ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.brax_es_driver()) WITH CHECK (NOT public.brax_es_driver())', tabla);
 END LOOP;
END $$;

DO $$ BEGIN
 IF to_regclass('public.perfiles_usuarios') IS NOT NULL THEN
  ALTER TABLE public.perfiles_usuarios ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS brax_driver_perfil_propio ON public.perfiles_usuarios;
  CREATE POLICY brax_driver_perfil_propio ON public.perfiles_usuarios AS RESTRICTIVE FOR ALL TO authenticated
   USING (NOT public.brax_es_driver() OR id=auth.uid()) WITH CHECK (NOT public.brax_es_driver());
  DROP POLICY IF EXISTS brax_driver_perfil_no_delete ON public.perfiles_usuarios;
  CREATE POLICY brax_driver_perfil_no_delete ON public.perfiles_usuarios AS RESTRICTIVE FOR DELETE TO authenticated
   USING (NOT public.brax_es_driver());
 END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.flota_resultados_conductor (
 parada_id uuid PRIMARY KEY REFERENCES public.flota_paradas(id),
 conductor_id uuid NOT NULL REFERENCES auth.users(id),
 material text,
 kilos_declarados numeric(12,3) CHECK (kilos_declarados > 0),
 observaciones text,
 fotos text[] NOT NULL,
 firma jsonb,
 registrado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.flota_gps_conductor (
 ruta_id uuid PRIMARY KEY REFERENCES public.flota_rutas(id),
 conductor_id uuid NOT NULL REFERENCES auth.users(id),
 latitud double precision NOT NULL CHECK (latitud BETWEEN -90 AND 90),
 longitud double precision NOT NULL CHECK (longitud BETWEEN -180 AND 180),
 actualizado_en timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.flota_resultados_conductor ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flota_gps_conductor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flota_resultados_conductor,public.flota_gps_conductor FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.flota_resultados_conductor,public.flota_gps_conductor TO authenticated;
DROP POLICY IF EXISTS brax_operacion_lectura ON public.flota_resultados_conductor;
CREATE POLICY brax_operacion_lectura ON public.flota_resultados_conductor FOR SELECT TO authenticated
 USING (NOT public.brax_es_driver() AND public.erp_role() IN ('admin','administrador','operador','dueno') AND auth.jwt()->>'aal'='aal2');
DROP POLICY IF EXISTS brax_operacion_lectura ON public.flota_gps_conductor;
CREATE POLICY brax_operacion_lectura ON public.flota_gps_conductor FOR SELECT TO authenticated
 USING (NOT public.brax_es_driver() AND public.erp_role() IN ('admin','administrador','operador','dueno') AND auth.jwt()->>'aal'='aal2');

CREATE OR REPLACE FUNCTION public.brax_driver_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.brax_driver_autorizado() THEN
  RAISE EXCEPTION 'La cuenta no está autorizada como conductor.' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object(
  'nombre', auth.jwt()->'user_metadata'->>'display_name',
  'rutas', (SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',r.id,'nombre',r.nombre,'camion',r.camion,'fecha',r.fecha,'estado',r.estado,
   'paradas',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'solicitud',coalesce(p.solicitud_b2b,p.solicitud_b2c),'orden',p.orden,
    'estado',p.estado,'motivo',p.motivo,'actualizado_en',p.actualizado_en,
    'cliente',coalesce(s.d->>'razon_social',s.d->>'nombre'),
    'direccion',s.d->>'direccion','comuna',s.d->>'comuna',
    'telefono',coalesce(s.d->>'telefono',s.d->>'celular'),
    'material',s.d->>'material','fecha_retiro',s.d->>'fecha_retiro',
    'observaciones',s.d->>'observaciones','latitud',u.latitud,'longitud',u.longitud,
    'material_declarado',e.material,'kilos',e.kilos_declarados,
    'nota_conductor',e.observaciones) ORDER BY p.orden),'[]')
   FROM public.flota_paradas p
   LEFT JOIN public.solicitudes_b2b b ON b.id=p.solicitud_b2b
   LEFT JOIN public.solicitudes_b2c c ON c.id=p.solicitud_b2c
   CROSS JOIN LATERAL (SELECT coalesce(to_jsonb(b),to_jsonb(c)) AS d) s
   LEFT JOIN public.flota_ubicaciones u ON u.solicitud_b2b=p.solicitud_b2b OR u.solicitud_b2c=p.solicitud_b2c
   LEFT JOIN public.flota_resultados_conductor e ON e.parada_id=p.id AND e.conductor_id=auth.uid()
   WHERE p.ruta_id=r.id AND p.activa)
   ) ORDER BY r.fecha,r.nombre),'[]') FROM public.flota_rutas r WHERE r.conductor_id=auth.uid())
 );
END $$;

CREATE OR REPLACE FUNCTION public.brax_driver_puede_subir(ruta text, parada text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.brax_driver_autorizado() AND EXISTS (
  SELECT 1 FROM public.flota_rutas r JOIN public.flota_paradas p ON p.ruta_id=r.id
  WHERE r.id::text=ruta AND p.id::text=parada AND r.conductor_id=auth.uid()
    AND r.estado='En ruta' AND p.activa AND p.estado IN ('asignado','en curso')
 )
$$;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('brax-driver-evidencias','brax-driver-evidencias',false,8388608,ARRAY['image/jpeg','image/png'])
ON CONFLICT(id) DO NOTHING;
DROP POLICY IF EXISTS brax_driver_storage_insert ON storage.objects;
CREATE POLICY brax_driver_storage_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (bucket_id='brax-driver-evidencias' AND (storage.foldername(name))[1]=auth.uid()::text
   AND public.brax_driver_puede_subir((storage.foldername(name))[2],(storage.foldername(name))[3]));
DROP POLICY IF EXISTS brax_driver_storage_gate ON storage.objects;
CREATE POLICY brax_driver_storage_gate ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
 USING (NOT public.brax_es_driver())
 WITH CHECK (NOT public.brax_es_driver() OR (bucket_id='brax-driver-evidencias'
   AND (storage.foldername(name))[1]=auth.uid()::text
   AND public.brax_driver_puede_subir((storage.foldername(name))[2],(storage.foldername(name))[3])));
DROP POLICY IF EXISTS brax_driver_storage_staff ON storage.objects;
CREATE POLICY brax_driver_storage_staff ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id='brax-driver-evidencias' AND public.erp_role() IN ('admin','administrador','operador','dueno')
   AND auth.jwt()->>'aal'='aal2');

CREATE OR REPLACE FUNCTION public.brax_driver_estado(
 p_ruta uuid,p_parada uuid,p_version timestamptz,p_estado text,p_motivo text DEFAULT NULL,
 p_material text DEFAULT NULL,p_kilos numeric DEFAULT NULL,p_nota text DEFAULT NULL,
 p_fotos text[] DEFAULT '{}',p_firma jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.flota_rutas; p public.flota_paradas; foto text; trazo jsonb; punto jsonb;
 huella text := md5(jsonb_build_array(p_estado,p_motivo,p_material,p_kilos,p_nota,p_fotos,p_firma)::text);
BEGIN
 IF NOT public.brax_driver_autorizado() THEN
  RAISE EXCEPTION 'Acceso restringido a conductores.' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(761113,1);
 SELECT * INTO r FROM public.flota_rutas WHERE id=p_ruta AND conductor_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La ruta no está asignada a tu cuenta.' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.flota_paradas WHERE id=p_parada AND ruta_id=r.id AND activa FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La parada ya no está asignada.' USING ERRCODE='42501'; END IF;
 IF p.estado=p_estado AND EXISTS(SELECT 1 FROM public.flota_eventos e
   WHERE e.actor=auth.uid() AND e.accion='driver_estado_parada' AND e.detalle->>'parada'=p_parada::text
     AND (e.detalle->>'version')::timestamptz=p_version AND e.detalle->>'huella'=huella) THEN RETURN; END IF;
 IF r.estado<>'En ruta' OR p.actualizado_en IS DISTINCT FROM p_version
    OR p_estado IS NULL OR p_estado NOT IN ('en curso','realizado','no realizado')
    OR p.estado NOT IN ('asignado','en curso') OR (p_estado='en curso' AND p.estado<>'asignado') THEN
  RAISE EXCEPTION 'La parada cambió o la ruta no está activa. Actualiza la jornada.';
 END IF;
 IF EXISTS (SELECT 1 FROM public.flota_paradas
  WHERE ruta_id=r.id AND activa AND orden<p.orden AND estado IN ('asignado','en curso')) THEN
  RAISE EXCEPTION 'Primero registra el resultado de las paradas anteriores.';
 END IF;
 IF p_estado='realizado' AND (coalesce(length(btrim(p_material)),0) NOT BETWEEN 1 AND 150
    OR p_kilos IS NULL OR p_kilos NOT BETWEEN 0.001 AND 999999999.999
    OR coalesce(cardinality(p_fotos),0)=0 OR p_firma IS NULL
    OR jsonb_typeof(p_firma) IS DISTINCT FROM 'object'
    OR coalesce(length(btrim(p_firma->>'nombre')),0) NOT BETWEEN 1 AND 150
    OR jsonb_typeof(p_firma->'trazos') IS DISTINCT FROM 'array') THEN
  RAISE EXCEPTION 'Registra material, kilos, fotografía y firma del receptor.';
 END IF;
 IF p_estado='no realizado' AND coalesce(length(btrim(p_motivo)),0) NOT BETWEEN 1 AND 200 THEN
  RAISE EXCEPTION 'Indica el motivo del retiro no realizado.';
 END IF;
 IF coalesce(cardinality(p_fotos),0)>4 OR coalesce(length(p_nota),0)>2000
    OR coalesce(pg_column_size(p_firma),0)>100000 THEN RAISE EXCEPTION 'La evidencia supera el límite permitido.'; END IF;
 IF p_estado='realizado' THEN
  IF jsonb_array_length(p_firma->'trazos') NOT BETWEEN 1 AND 30 THEN
   RAISE EXCEPTION 'Registra la firma del receptor.';
  END IF;
  FOR trazo IN SELECT value FROM jsonb_array_elements(p_firma->'trazos') LOOP
   IF jsonb_typeof(trazo) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Firma inválida.'; END IF;
   IF jsonb_array_length(trazo) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'Firma inválida.'; END IF;
   FOR punto IN SELECT value FROM jsonb_array_elements(trazo) LOOP
    IF jsonb_typeof(punto->'x') IS DISTINCT FROM 'number' OR jsonb_typeof(punto->'y') IS DISTINCT FROM 'number'
       THEN RAISE EXCEPTION 'Firma inválida.'; END IF;
    IF (punto->>'x')::numeric NOT BETWEEN 0 AND 1000 OR (punto->>'y')::numeric NOT BETWEEN 0 AND 1000
       THEN RAISE EXCEPTION 'Firma inválida.'; END IF;
   END LOOP;
  END LOOP;
 END IF;
 FOREACH foto IN ARRAY coalesce(p_fotos,'{}') LOOP
  IF foto IS NULL OR split_part(foto,'/',1)<>auth.uid()::text OR split_part(foto,'/',2)<>r.id::text
     OR split_part(foto,'/',3)<>p.id::text OR NOT EXISTS(
      SELECT 1 FROM storage.objects WHERE bucket_id='brax-driver-evidencias' AND name=foto
     ) THEN RAISE EXCEPTION 'Fotografía inválida.'; END IF;
 END LOOP;
 IF p_estado IN ('realizado','no realizado') THEN
  INSERT INTO public.flota_resultados_conductor(parada_id,conductor_id,material,kilos_declarados,observaciones,fotos,firma)
  VALUES(p.id,auth.uid(),CASE WHEN p_estado='realizado' THEN btrim(p_material) END,
   CASE WHEN p_estado='realizado' THEN p_kilos END,nullif(btrim(p_nota),''),coalesce(p_fotos,'{}'),
   CASE WHEN p_estado='realizado' THEN p_firma END);
 END IF;
 UPDATE public.flota_paradas SET estado=p_estado, actualizado_en=clock_timestamp(),
   motivo=CASE WHEN p_estado='no realizado' THEN btrim(p_motivo) END WHERE id=p.id;
 UPDATE public.flota_rutas SET actualizado_en=clock_timestamp() WHERE id=r.id;
 INSERT INTO public.flota_eventos(actor,accion,detalle) VALUES(auth.uid(),'driver_estado_parada',
  jsonb_build_object('ruta',r.id,'parada',p.id,'estado',p_estado,'version',p_version,'huella',huella));
END $$;

CREATE OR REPLACE FUNCTION public.brax_driver_gps(p_ruta uuid,p_lat double precision,p_lon double precision)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.brax_driver_autorizado() THEN
  RAISE EXCEPTION 'Acceso restringido a conductores.' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.flota_rutas WHERE id=p_ruta AND conductor_id=auth.uid() AND estado='En ruta' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La jornada ya no está activa.' USING ERRCODE='42501'; END IF;
 INSERT INTO public.flota_gps_conductor(ruta_id,conductor_id,latitud,longitud)
 VALUES(p_ruta,auth.uid(),p_lat,p_lon)
 ON CONFLICT(ruta_id) DO UPDATE SET conductor_id=excluded.conductor_id,latitud=excluded.latitud,
  longitud=excluded.longitud,actualizado_en=clock_timestamp();
END $$;

REVOKE ALL ON FUNCTION public.brax_driver_snapshot(),public.brax_driver_puede_subir(text,text),
 public.brax_driver_estado(uuid,uuid,timestamptz,text,text,text,numeric,text,text[],jsonb),
 public.brax_driver_gps(uuid,double precision,double precision) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brax_driver_snapshot(),public.brax_driver_puede_subir(text,text),
 public.brax_driver_estado(uuid,uuid,timestamptz,text,text,text,numeric,text,text[],jsonb),
 public.brax_driver_gps(uuid,double precision,double precision) TO authenticated;
CREATE OR REPLACE FUNCTION public.brax_driver_asignar(p_ruta uuid,p_version timestamptz,p_conductor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.flota_plan_autorizar(true);
 PERFORM pg_advisory_xact_lock(761113,1);
 IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=p_conductor AND raw_app_meta_data->>'role'='driver') THEN
  RAISE EXCEPTION 'El usuario debe tener el rol driver en Supabase Auth.';
 END IF;
 UPDATE public.flota_rutas SET conductor_id=p_conductor,actualizado_en=clock_timestamp()
  WHERE id=p_ruta AND estado='Programada' AND actualizado_en=p_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'La ruta cambió o ya fue iniciada. Actualiza el despacho.'; END IF;
 INSERT INTO public.flota_eventos(actor,accion,detalle) VALUES(auth.uid(),'driver_asignar',
  jsonb_build_object('ruta',p_ruta,'conductor',p_conductor));
END $$;
REVOKE ALL ON FUNCTION public.brax_driver_asignar(uuid,timestamptz,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brax_driver_asignar(uuid,timestamptz,uuid) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
