-- Requiere las migraciones de planificación y Driver anteriores. No borra datos.
BEGIN;
ALTER TABLE public.flota_rutas ADD COLUMN IF NOT EXISTS borrador boolean NOT NULL DEFAULT false;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.flota_rutas'::regclass AND conname='flota_borrador_programada') THEN
  ALTER TABLE public.flota_rutas ADD CONSTRAINT flota_borrador_programada CHECK (NOT borrador OR estado='Programada');
 END IF;
END $$;
ALTER TABLE public.solicitudes_b2b ADD COLUMN IF NOT EXISTS direccion text;
ALTER TABLE public.solicitudes_b2b ADD COLUMN IF NOT EXISTS comuna text;
ALTER TABLE public.solicitudes_b2b ADD COLUMN IF NOT EXISTS prioridad text;
ALTER TABLE public.solicitudes_b2c ADD COLUMN IF NOT EXISTS comuna text;
ALTER TABLE public.solicitudes_b2c ADD COLUMN IF NOT EXISTS prioridad text;

-- Catálogo mínimo: nunca expone credenciales ni el listado general de Auth al cliente.
CREATE OR REPLACE FUNCTION public.flota_despacho_catalogo()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE conductores jsonb; consulta text; exclusion text := ''; perfil text := '';
BEGIN
 PERFORM public.flota_plan_autorizar(false);
 IF to_regclass('public.erp_roles') IS NOT NULL THEN
  exclusion := ' AND NOT EXISTS (SELECT 1 FROM public.erp_roles r WHERE r.user_id=u.id AND lower(btrim(r.role::text)) IN (''admin'',''administrador'',''dueno'',''operador''))';
 ELSIF to_regclass('public.perfiles_usuarios') IS NOT NULL THEN
  exclusion := ' AND NOT EXISTS (SELECT 1 FROM public.perfiles_usuarios p WHERE p.id=u.id AND lower(btrim(p.rol::text)) IN (''admin'',''administrador'',''dueno'',''operador''))';
 END IF;
 IF to_regclass('public.erp_profiles') IS NOT NULL THEN
  perfil := '(SELECT nullif(btrim(p.display_name),'''') FROM public.erp_profiles p WHERE p.user_id=u.id),';
 END IF;
 consulta := 'SELECT coalesce(jsonb_agg(jsonb_build_object(''id'',u.id,''nombre'',coalesce(' || perfil ||
  'nullif(u.raw_user_meta_data->>''display_name'',''''),''Conductor ''||left(u.id::text,8))) ORDER BY u.id),''[]''::jsonb) FROM auth.users u WHERE u.raw_app_meta_data->>''role''=''driver''' || exclusion;
 EXECUTE consulta INTO conductores;
 RETURN jsonb_build_object('version',1,'conductores',conductores);
END $$;

CREATE OR REPLACE FUNCTION public.flota_despacho_mutar(p_accion text,p_datos jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.flota_rutas; rid uuid; version_actual timestamptz;
BEGIN
 PERFORM public.flota_plan_autorizar(true);
 PERFORM pg_advisory_xact_lock(761113,1);
 IF p_accion='crear' THEN
  rid := public.flota_plan_mutar('crear',p_datos);
  UPDATE public.flota_rutas SET borrador=coalesce((p_datos->>'borrador')::boolean,false),actualizado_en=clock_timestamp() WHERE id=rid;
 ELSE
  SELECT * INTO r FROM public.flota_rutas WHERE id=(p_datos->>'ruta')::uuid FOR UPDATE;
  IF NOT FOUND OR p_datos->>'version' IS NULL OR r.actualizado_en<>(p_datos->>'version')::timestamptz THEN
   RAISE EXCEPTION 'La ruta cambió. Actualiza antes de continuar.' USING ERRCODE='40001';
  END IF;
  IF r.estado NOT IN ('Programada','En ruta') THEN RAISE EXCEPTION 'La ruta está cerrada.'; END IF;
  rid := r.id;
  IF p_accion='publicar' THEN
   IF NOT r.borrador THEN RAISE EXCEPTION 'La ruta ya está programada.'; END IF;
   UPDATE public.flota_rutas SET borrador=false,actualizado_en=clock_timestamp() WHERE id=rid;
  ELSIF p_accion='eliminar_borrador' THEN
   IF NOT r.borrador THEN RAISE EXCEPTION 'Solo se elimina un borrador.'; END IF;
   -- Baja lógica: conserva auditoría y relaciones, libera los retiros.
   UPDATE public.flota_paradas SET activa=false,estado='liberado',actualizado_en=clock_timestamp() WHERE ruta_id=rid AND activa;
   UPDATE public.flota_rutas SET borrador=false,estado='Cancelada',actualizado_en=clock_timestamp() WHERE id=rid;
  ELSIF p_accion='cabecera' THEN
   IF r.estado<>'Programada' THEN RAISE EXCEPTION 'Solo se edita una ruta sin iniciar.'; END IF;
   PERFORM public.flota_plan_mutar('editar',p_datos);
  ELSIF p_accion IN ('asignar','quitar','ordenar','ubicacion','reasignar','estado_ruta') THEN
   IF p_accion='estado_ruta' AND p_datos->>'estado'='En ruta' AND (r.borrador OR r.conductor_id IS NULL) THEN
    RAISE EXCEPTION 'Programa la ruta y asigna un conductor antes de iniciarla.';
   END IF;
   PERFORM public.flota_plan_mutar(p_accion,p_datos);
  ELSE RAISE EXCEPTION 'Acción de despacho desconocida.';
  END IF;
 END IF;
 IF p_accion IN ('crear','cabecera') AND p_datos ? 'conductor_id' THEN
  IF nullif(p_datos->>'conductor_id','') IS NOT NULL THEN
   SELECT actualizado_en INTO version_actual FROM public.flota_rutas WHERE id=rid;
   PERFORM public.brax_driver_asignar(rid,version_actual,(p_datos->>'conductor_id')::uuid);
  ELSE
   UPDATE public.flota_rutas SET conductor_id=null,conductor=null,actualizado_en=clock_timestamp() WHERE id=rid;
  END IF;
 END IF;
 INSERT INTO public.flota_eventos(actor,accion,detalle) VALUES(auth.uid(),'despacho_'||p_accion,p_datos||jsonb_build_object('ruta',rid));
 RETURN rid;
END $$;

CREATE OR REPLACE FUNCTION public.flota_despacho_solicitud(p_origen text,p_id uuid,p_datos jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prioridad_elegida text := nullif(btrim(p_datos->>'prioridad'),'');
BEGIN
 PERFORM public.flota_plan_autorizar(true);
 PERFORM pg_advisory_xact_lock(761113,1);
 IF prioridad_elegida IS NOT NULL AND prioridad_elegida NOT IN ('baja','normal','alta','urgente') THEN RAISE EXCEPTION 'Prioridad inválida.'; END IF;
 IF p_origen='B2B' THEN
  UPDATE public.solicitudes_b2b SET direccion=nullif(btrim(p_datos->>'direccion'),''),comuna=nullif(btrim(p_datos->>'comuna'),''),prioridad=prioridad_elegida WHERE id=p_id;
 ELSIF p_origen='B2C' THEN
  UPDATE public.solicitudes_b2c SET direccion=nullif(btrim(p_datos->>'direccion'),''),comuna=nullif(btrim(p_datos->>'comuna'),''),prioridad=prioridad_elegida WHERE id=p_id;
 ELSE RAISE EXCEPTION 'Origen inválido.'; END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'La solicitud ya no existe.'; END IF;
 IF (p_datos->>'latitud' IS NULL) <> (p_datos->>'longitud' IS NULL) THEN RAISE EXCEPTION 'Indica ambas coordenadas.'; END IF;
 IF p_datos->>'latitud' IS NOT NULL THEN
  IF p_origen='B2B' THEN
   INSERT INTO public.flota_ubicaciones(solicitud_b2b,latitud,longitud,actualizado_por)
    VALUES(p_id,(p_datos->>'latitud')::float8,(p_datos->>'longitud')::float8,auth.uid())
    ON CONFLICT(solicitud_b2b) DO UPDATE SET latitud=excluded.latitud,longitud=excluded.longitud,actualizado_por=excluded.actualizado_por,actualizado_en=clock_timestamp();
  ELSE
   INSERT INTO public.flota_ubicaciones(solicitud_b2c,latitud,longitud,actualizado_por)
    VALUES(p_id,(p_datos->>'latitud')::float8,(p_datos->>'longitud')::float8,auth.uid())
    ON CONFLICT(solicitud_b2c) DO UPDATE SET latitud=excluded.latitud,longitud=excluded.longitud,actualizado_por=excluded.actualizado_por,actualizado_en=clock_timestamp();
  END IF;
 END IF;
 INSERT INTO public.flota_eventos(actor,accion,detalle) VALUES(auth.uid(),'despacho_datos_retiro',jsonb_build_object('origen',p_origen,'solicitud',p_id));
END $$;

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
   ) ORDER BY r.fecha,r.nombre),'[]') FROM public.flota_rutas r WHERE r.conductor_id=auth.uid() AND NOT r.borrador)
 );
END $$;



REVOKE ALL ON FUNCTION public.flota_despacho_catalogo(),public.flota_despacho_mutar(text,jsonb),public.flota_despacho_solicitud(text,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.flota_despacho_catalogo(),public.flota_despacho_mutar(text,jsonb),public.flota_despacho_solicitud(text,uuid,jsonb) TO authenticated;
DO $$ DECLARE tabla text; BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  FOREACH tabla IN ARRAY ARRAY['flota_camiones','flota_rutas','flota_paradas','flota_ubicaciones','flota_gps_conductor','flota_resultados_conductor','telemetria_flota','solicitudes_b2b','solicitudes_b2c'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=tabla) THEN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',tabla);
   END IF;
  END LOOP;
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
