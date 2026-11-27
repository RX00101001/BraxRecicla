-- Planificación avanzada. Aplicar después de ERP geocodificación y de Driver jornada.
BEGIN;
ALTER TABLE public.flota_camiones ADD COLUMN IF NOT EXISTS patente text;
ALTER TABLE public.flota_camiones ADD COLUMN IF NOT EXISTS tipo_vehiculo text;
ALTER TABLE public.flota_camiones ADD COLUMN IF NOT EXISTS capacidad_kg numeric CHECK(capacidad_kg>0);
ALTER TABLE public.flota_camiones ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
ALTER TABLE public.flota_camiones ADD COLUMN IF NOT EXISTS fuente_gps text CHECK(fuente_gps IN ('phone','esp32'));
ALTER TABLE public.flota_camiones ADD COLUMN IF NOT EXISTS gps_identificador text;
CREATE TABLE IF NOT EXISTS public.flota_conductores (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id),codigo text UNIQUE NOT NULL,telefono text,
 camion_predeterminado text REFERENCES public.flota_camiones(identificador),activo boolean NOT NULL DEFAULT true,
 actualizado_en timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.flota_camiones ADD COLUMN IF NOT EXISTS conductor_predeterminado uuid REFERENCES public.flota_conductores(user_id);
ALTER TABLE public.flota_conductores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flota_conductores FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.flota_conductores TO authenticated;
DROP POLICY IF EXISTS flota_conductores_lectura ON public.flota_conductores;
CREATE POLICY flota_conductores_lectura ON public.flota_conductores FOR SELECT TO authenticated
 USING(NOT public.brax_es_driver() AND public.erp_role() IN ('admin','administrador','dueno','operador') AND auth.jwt()->>'aal'='aal2');
ALTER TABLE public.flota_rutas ADD COLUMN IF NOT EXISTS codigo text;
ALTER TABLE public.flota_rutas ADD COLUMN IF NOT EXISTS hora_salida time;
ALTER TABLE public.flota_rutas ADD COLUMN IF NOT EXISTS eliminada_en timestamptz;
-- No se cambian códigos históricos. Si existen duplicados, la transacción aborta y pide revisión.
UPDATE public.flota_rutas SET codigo=nombre WHERE codigo IS NULL;
ALTER TABLE public.flota_rutas ALTER COLUMN codigo SET NOT NULL;
DO $$ DECLARE duplicados text; BEGIN
 SELECT string_agg(format('%s (%s rutas)',codigo_normalizado,cantidad),', ' ORDER BY codigo_normalizado)
 INTO duplicados FROM (
  SELECT lower(btrim(codigo)) AS codigo_normalizado,count(*) AS cantidad
  FROM public.flota_rutas GROUP BY lower(btrim(codigo)) HAVING count(*)>1
 ) d;
 IF duplicados IS NOT NULL THEN
  RAISE EXCEPTION 'Hay códigos históricos de ruta duplicados: %',duplicados
   USING ERRCODE='23505',HINT='Ejecute Database/setup/diagnosticar_codigos_rutas.sql y asigne un nombre distinto a cada ruta duplicada antes de repetir esta migración. No se han renombrado ni eliminado rutas.';
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS flota_rutas_codigo_unico ON public.flota_rutas(lower(btrim(codigo)));
CREATE SEQUENCE IF NOT EXISTS public.flota_ruta_codigo_seq AS bigint START WITH 1;
DO $$ DECLARE maximo bigint; actual bigint; usado boolean; BEGIN
 SELECT coalesce(max(substring(codigo FROM 2)::bigint),0) INTO maximo FROM public.flota_rutas WHERE codigo~'^R[0-9]{1,18}$';
 SELECT last_value,is_called INTO actual,usado FROM public.flota_ruta_codigo_seq;
 IF maximo>=actual AND maximo>0 THEN PERFORM setval('public.flota_ruta_codigo_seq',maximo,true); END IF;
END $$;
REVOKE ALL ON SEQUENCE public.flota_ruta_codigo_seq FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.flota_ruta_proponer()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE numero text;
BEGIN
 PERFORM public.flota_despacho_autorizar();PERFORM pg_advisory_xact_lock(761113,1);
 numero:=nextval('public.flota_ruta_codigo_seq')::text;
 RETURN 'R'||lpad(numero,greatest(6,length(numero)),'0');
END $$;
CREATE OR REPLACE FUNCTION public.flota_ruta_codigo_guardar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actual bigint; numero bigint;
BEGIN
 IF TG_OP='INSERT' THEN NEW.codigo:=coalesce(nullif(btrim(NEW.codigo),''),nullif(btrim(NEW.nombre),''),public.flota_ruta_proponer());
 ELSIF NEW.nombre IS DISTINCT FROM OLD.nombre AND NEW.codigo IS NOT DISTINCT FROM OLD.codigo THEN NEW.codigo:=btrim(NEW.nombre);
 END IF;
 IF nullif(btrim(NEW.codigo),'') IS NULL OR length(NEW.codigo)>120 THEN RAISE EXCEPTION 'El número de ruta es obligatorio y admite hasta 120 caracteres.'; END IF;
 NEW.codigo:=btrim(NEW.codigo);NEW.nombre:=NEW.codigo;
 IF NEW.codigo~'^R[0-9]{1,18}$' THEN
  PERFORM pg_advisory_xact_lock(761113,1);numero:=substring(NEW.codigo FROM 2)::bigint;
  SELECT last_value INTO actual FROM public.flota_ruta_codigo_seq;
  IF numero>actual THEN PERFORM setval('public.flota_ruta_codigo_seq',numero,true); END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS flota_codigo_guardar ON public.flota_rutas;
CREATE TRIGGER flota_codigo_guardar BEFORE INSERT OR UPDATE OF nombre,codigo ON public.flota_rutas FOR EACH ROW EXECUTE FUNCTION public.flota_ruta_codigo_guardar();

CREATE OR REPLACE FUNCTION public.flota_conductor_disponible(p_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE valido boolean;
BEGIN
 SELECT coalesce((u.raw_app_meta_data->>'role')='driver',false) AND coalesce(c.activo,true) INTO valido FROM auth.users u
 LEFT JOIN public.flota_conductores c ON c.user_id=u.id WHERE u.id=p_id;
 IF NOT coalesce(valido,false) THEN RETURN false;END IF;
 IF to_regclass('public.erp_roles') IS NOT NULL THEN
  RETURN NOT EXISTS(SELECT 1 FROM public.erp_roles WHERE user_id=p_id AND lower(btrim(role::text)) IN ('admin','administrador','dueno','operador'));
 END IF;
 RETURN NOT EXISTS(SELECT 1 FROM public.perfiles_usuarios WHERE id=p_id AND lower(btrim(rol::text)) IN ('admin','administrador','dueno','operador'));
END $$;
CREATE OR REPLACE FUNCTION public.flota_despacho_catalogo()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE conductores jsonb; consulta text; perfil text:='';
BEGIN
 PERFORM public.flota_despacho_autorizar();
 IF to_regclass('public.erp_profiles') IS NOT NULL THEN perfil:='(SELECT nullif(btrim(p.display_name),'''') FROM public.erp_profiles p WHERE p.user_id=u.id),';END IF;
 consulta:='SELECT coalesce(jsonb_agg(jsonb_build_object(''id'',u.id,''codigo'',coalesce(c.codigo,''DRV-''||left(u.id::text,8)),''nombre'',coalesce('||perfil||
  'nullif(u.raw_user_meta_data->>''display_name'',''''),''Conductor ''||left(u.id::text,8)),''email'',to_jsonb(u)->>''email'',''telefono'',coalesce(c.telefono,to_jsonb(u)->>''phone''),''camion_predeterminado'',c.camion_predeterminado,''activo'',coalesce(c.activo,true),''habilitado'',public.flota_conductor_disponible(u.id)) ORDER BY u.id),''[]''::jsonb) FROM auth.users u LEFT JOIN public.flota_conductores c ON c.user_id=u.id WHERE u.raw_app_meta_data->>''role''=''driver''';
 EXECUTE consulta INTO conductores;
 RETURN jsonb_build_object('version',2,'conductores',conductores,'camiones',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.identificador),'[]') FROM public.flota_camiones c));
END $$;
CREATE OR REPLACE FUNCTION public.flota_catalogo_guardar(p_tipo text,p_datos jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; camion text; codigo_elegido text; nombre_elegido text;
BEGIN
 PERFORM public.flota_despacho_autorizar(true);PERFORM pg_advisory_xact_lock(761113,1);
 IF p_tipo='conductor' THEN
  uid:=(p_datos->>'user_id')::uuid;camion:=nullif(p_datos->>'camion_predeterminado','');codigo_elegido:=nullif(btrim(p_datos->>'codigo'),'');nombre_elegido:=nullif(btrim(p_datos->>'nombre'),'');
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=uid AND raw_app_meta_data->>'role'='driver') OR codigo_elegido IS NULL OR nombre_elegido IS NULL THEN RAISE EXCEPTION 'Selecciona un usuario conductor existente y completa código y nombre.';END IF;
  IF camion IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM public.flota_camiones WHERE identificador=camion AND activo) OR EXISTS(SELECT 1 FROM public.flota_camiones WHERE identificador=camion AND conductor_predeterminado IS NOT NULL AND conductor_predeterminado<>uid)) THEN RAISE EXCEPTION 'El camión no está activo o tiene otro conductor predeterminado.';END IF;
  INSERT INTO public.flota_conductores(user_id,codigo,telefono,camion_predeterminado,activo) VALUES(uid,codigo_elegido,nullif(btrim(p_datos->>'telefono'),''),camion,coalesce((p_datos->>'activo')::boolean,true))
   ON CONFLICT(user_id) DO UPDATE SET codigo=excluded.codigo,telefono=excluded.telefono,camion_predeterminado=excluded.camion_predeterminado,activo=excluded.activo,actualizado_en=clock_timestamp();
  UPDATE public.flota_camiones SET conductor_predeterminado=null WHERE conductor_predeterminado=uid AND identificador IS DISTINCT FROM camion;
  IF camion IS NOT NULL THEN UPDATE public.flota_camiones SET conductor_predeterminado=uid WHERE identificador=camion;END IF;
  IF to_regclass('public.erp_profiles') IS NOT NULL THEN
   INSERT INTO public.erp_profiles(user_id,display_name) VALUES(uid,nombre_elegido) ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name;
  ELSE
   RAISE EXCEPTION 'Esta instalación requiere completar el perfil del conductor desde la administración existente.';
  END IF;
 ELSIF p_tipo='camion' THEN
  camion:=nullif(btrim(p_datos->>'identificador'),'');uid:=nullif(p_datos->>'conductor_predeterminado','')::uuid;
  IF camion IS NULL THEN RAISE EXCEPTION 'El código del camión es obligatorio.';END IF;
  IF uid IS NOT NULL AND (NOT public.flota_conductor_disponible(uid) OR NOT EXISTS(SELECT 1 FROM public.flota_conductores WHERE user_id=uid) OR EXISTS(SELECT 1 FROM public.flota_conductores WHERE user_id=uid AND camion_predeterminado IS NOT NULL AND camion_predeterminado<>camion)) THEN RAISE EXCEPTION 'Registra el conductor y libera su camión predeterminado anterior antes de cambiar la asociación.';END IF;
  INSERT INTO public.flota_camiones(identificador,patente,tipo_vehiculo,capacidad_kg,conductor_predeterminado,activo,fuente_gps,gps_identificador)
  VALUES(camion,nullif(btrim(p_datos->>'patente'),''),nullif(btrim(p_datos->>'tipo_vehiculo'),''),nullif(p_datos->>'capacidad_kg','')::numeric,uid,coalesce((p_datos->>'activo')::boolean,true),nullif(p_datos->>'fuente_gps',''),nullif(btrim(p_datos->>'gps_identificador'),''))
  ON CONFLICT(identificador) DO UPDATE SET patente=excluded.patente,tipo_vehiculo=excluded.tipo_vehiculo,capacidad_kg=excluded.capacidad_kg,conductor_predeterminado=excluded.conductor_predeterminado,activo=excluded.activo,fuente_gps=excluded.fuente_gps,gps_identificador=excluded.gps_identificador,actualizado_en=clock_timestamp();
  UPDATE public.flota_conductores SET camion_predeterminado=null WHERE camion_predeterminado=camion AND user_id IS DISTINCT FROM uid;
  IF uid IS NOT NULL THEN UPDATE public.flota_conductores SET camion_predeterminado=camion WHERE user_id=uid;END IF;
 ELSE RAISE EXCEPTION 'Catálogo inválido.';END IF;
 INSERT INTO public.flota_eventos(actor,accion,detalle) VALUES(auth.uid(),'catalogo_'||p_tipo,jsonb_build_object('user_id',uid,'camion',camion));
END $$;

CREATE OR REPLACE FUNCTION public.flota_ruta_vacia(p_ruta uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.flota_rutas r WHERE r.id=p_ruta AND r.estado='Programada' AND r.iniciado_en IS NULL AND r.finalizado_en IS NULL AND r.eliminada_en IS NULL
  AND NOT EXISTS(SELECT 1 FROM public.flota_paradas p WHERE p.ruta_id=r.id)
  AND NOT EXISTS(SELECT 1 FROM public.flota_gps_conductor g WHERE g.ruta_id=r.id)
  AND NOT EXISTS(SELECT 1 FROM public.flota_eventos e WHERE e.detalle->>'ruta'=r.id::text AND e.accion NOT IN ('crear','despacho_crear','editar','despacho_cabecera','driver_asignar')))
$$;
CREATE OR REPLACE FUNCTION public.flota_plan_mutar(p_accion text,p_datos jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.flota_rutas; destino public.flota_rutas; p public.flota_paradas;
 item jsonb; sid uuid; origen text; situacion text; nuevo text; rid uuid; n integer; ids uuid[]; restriccion text;
BEGIN
 PERFORM public.flota_despacho_autorizar();
 IF public.erp_role()='operador' AND p_accion NOT IN ('crear','editar','asignar','quitar','ordenar','ubicacion','reasignar') THEN RAISE EXCEPTION 'El operador puede planificar, no ejecutar la jornada.' USING ERRCODE='42501';END IF;
 -- Serializa operaciones breves de planificación; no depende del cliente.
 PERFORM pg_advisory_xact_lock(761113,1);
 IF p_accion='crear' THEN
  IF NOT EXISTS(SELECT 1 FROM public.flota_camiones WHERE identificador=p_datos->>'camion' AND activo) THEN RAISE EXCEPTION 'Selecciona un camión activo.';END IF;
  INSERT INTO public.flota_rutas(nombre,camion,conductor,fecha,estado)
  VALUES(btrim(p_datos->>'nombre'),p_datos->>'camion',nullif(btrim(p_datos->>'conductor'),''),(p_datos->>'fecha')::date,'Programada') RETURNING id INTO rid;
 ELSE
  SELECT * INTO r FROM public.flota_rutas WHERE id=(p_datos->>'ruta')::uuid FOR UPDATE;
  IF NOT FOUND OR r.eliminada_en IS NOT NULL THEN RAISE EXCEPTION 'La ruta ya no existe.'; END IF;
  IF public.erp_role()='operador' AND r.estado<>'Programada' THEN RAISE EXCEPTION 'El operador solo modifica rutas sin iniciar.' USING ERRCODE='42501';END IF;
  rid:=r.id;
  IF r.estado IN ('Finalizada','Cancelada') THEN RAISE EXCEPTION 'La ruta está cerrada y no permite cambios.'; END IF;
  IF p_datos->>'version' IS NULL OR r.actualizado_en<>(p_datos->>'version')::timestamptz THEN
   RAISE EXCEPTION 'La ruta cambió en otra sesión. Actualiza e inténtalo nuevamente.'; END IF;
 END IF;
 IF p_accion='editar' THEN
  IF r.estado<>'Programada' THEN RAISE EXCEPTION 'Solo se edita la cabecera de una ruta planificada.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.flota_camiones WHERE identificador=p_datos->>'camion' AND activo) THEN RAISE EXCEPTION 'Selecciona un camión activo.';END IF;
  UPDATE public.flota_rutas SET nombre=btrim(p_datos->>'nombre'),camion=p_datos->>'camion',
   conductor=nullif(btrim(p_datos->>'conductor'),''),fecha=(p_datos->>'fecha')::date WHERE id=rid;
 ELSIF p_accion IN ('asignar','crear') THEN
  FOR item IN SELECT value FROM jsonb_array_elements(coalesce(p_datos->'retiros','[]')) LOOP
   sid:=(item->>'id')::uuid; origen:=item->>'origen';
   IF origen='B2B' THEN SELECT estado INTO situacion FROM public.solicitudes_b2b WHERE id=sid FOR UPDATE;
   ELSIF origen='B2C' THEN SELECT estado INTO situacion FROM public.solicitudes_b2c WHERE id=sid FOR UPDATE;
   ELSE RAISE EXCEPTION 'Origen de solicitud inválido.'; END IF;
   IF NOT FOUND OR situacion IS NULL THEN RAISE EXCEPTION 'La solicitud ya no existe.'; END IF;
   IF lower(situacion) NOT IN ('pendiente','aprobado','aprobada','en ruta') THEN RAISE EXCEPTION 'La solicitud no está disponible para retiro.'; END IF;
   SELECT coalesce(max(orden),0)+1 INTO n FROM public.flota_paradas WHERE ruta_id=rid;
   INSERT INTO public.flota_paradas(ruta_id,orden,solicitud_b2b,solicitud_b2c)
   VALUES(rid,n,CASE WHEN origen='B2B' THEN sid END,CASE WHEN origen='B2C' THEN sid END);
  END LOOP;
 ELSIF p_accion IN ('quitar','reasignar','estado_parada','ubicacion') THEN
  SELECT * INTO p FROM public.flota_paradas WHERE id=(p_datos->>'parada')::uuid AND ruta_id=rid AND activa FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La parada ya no pertenece a esta ruta.'; END IF;
  IF p.estado='realizado' THEN RAISE EXCEPTION 'Un retiro realizado no se puede modificar.'; END IF;
  IF p_accion='estado_parada' THEN
   nuevo:=p_datos->>'estado';
   IF nuevo NOT IN ('en curso','realizado','no realizado') OR r.estado<>'En ruta' OR p.estado='no realizado' THEN
    RAISE EXCEPTION 'Transición inválida: inicia la ruta antes de registrar el retiro.'; END IF;
   IF nuevo='no realizado' AND coalesce(btrim(p_datos->>'motivo'),'')='' THEN RAISE EXCEPTION 'Indica el motivo del retiro no realizado.'; END IF;
   UPDATE public.flota_paradas SET estado=nuevo,motivo=CASE WHEN nuevo='no realizado' THEN btrim(p_datos->>'motivo') END,actualizado_en=clock_timestamp() WHERE id=p.id;
   -- No cambia kilos, certificados ni estado de pesaje de la solicitud original.
  ELSIF p_accion='ubicacion' THEN
   IF p.solicitud_b2b IS NOT NULL THEN
    INSERT INTO public.flota_ubicaciones(solicitud_b2b,latitud,longitud,actualizado_por)
    VALUES(p.solicitud_b2b,(p_datos->>'latitud')::float8,(p_datos->>'longitud')::float8,auth.uid())
    ON CONFLICT(solicitud_b2b) DO UPDATE SET latitud=excluded.latitud,longitud=excluded.longitud,actualizado_por=excluded.actualizado_por,actualizado_en=clock_timestamp();
   ELSE
    INSERT INTO public.flota_ubicaciones(solicitud_b2c,latitud,longitud,actualizado_por)
    VALUES(p.solicitud_b2c,(p_datos->>'latitud')::float8,(p_datos->>'longitud')::float8,auth.uid())
    ON CONFLICT(solicitud_b2c) DO UPDATE SET latitud=excluded.latitud,longitud=excluded.longitud,actualizado_por=excluded.actualizado_por,actualizado_en=clock_timestamp();
   END IF;
  ELSE
   IF p_accion='reasignar' THEN
    IF p.solicitud_b2b IS NOT NULL THEN
     SELECT estado INTO situacion FROM public.solicitudes_b2b WHERE id=p.solicitud_b2b FOR UPDATE;
    ELSE SELECT estado INTO situacion FROM public.solicitudes_b2c WHERE id=p.solicitud_b2c FOR UPDATE; END IF;
    IF coalesce(lower(situacion),'') NOT IN ('pendiente','aprobado','aprobada','en ruta') THEN RAISE EXCEPTION 'La solicitud no está disponible para retiro.'; END IF;
    SELECT * INTO destino FROM public.flota_rutas WHERE id=(p_datos->>'destino')::uuid FOR UPDATE;
    IF NOT FOUND OR destino.eliminada_en IS NOT NULL OR (public.erp_role()='operador' AND destino.estado<>'Programada') OR destino.id=rid OR destino.estado NOT IN ('Programada','En ruta') THEN RAISE EXCEPTION 'La ruta de destino no está disponible.'; END IF;
   END IF;
   UPDATE public.flota_paradas SET activa=false,estado='liberado',actualizado_en=clock_timestamp() WHERE id=p.id;
   IF p_accion='reasignar' THEN
    SELECT coalesce(max(orden),0)+1 INTO n FROM public.flota_paradas WHERE ruta_id=destino.id;
    INSERT INTO public.flota_paradas(ruta_id,orden,solicitud_b2b,solicitud_b2c) VALUES(destino.id,n,p.solicitud_b2b,p.solicitud_b2c);
    UPDATE public.flota_rutas SET actualizado_en=clock_timestamp() WHERE id=destino.id;
   END IF;
  END IF;
 ELSIF p_accion='ordenar' THEN
  SELECT array_agg(value::uuid) INTO ids FROM jsonb_array_elements_text(p_datos->'orden');
  IF cardinality(ids)<>(SELECT count(*) FROM public.flota_paradas WHERE ruta_id=rid AND activa)
   OR (SELECT count(DISTINCT x) FROM unnest(ids) x)<>cardinality(ids)
   OR EXISTS(SELECT 1 FROM unnest(ids) x WHERE NOT EXISTS(SELECT 1 FROM public.flota_paradas WHERE id=x AND ruta_id=rid AND activa)) THEN
   RAISE EXCEPTION 'Las paradas cambiaron. Actualiza antes de ordenar.'; END IF;
  IF EXISTS(SELECT 1 FROM public.flota_paradas WHERE ruta_id=rid AND activa AND estado IN ('realizado','no realizado')) THEN RAISE EXCEPTION 'No se reordena una ruta con resultados registrados.'; END IF;
  UPDATE public.flota_paradas historica SET orden=h.pos+cardinality(ids) FROM (
   SELECT id,(row_number() OVER(ORDER BY orden,id))::integer pos FROM public.flota_paradas WHERE ruta_id=rid AND NOT activa
  ) h WHERE historica.id=h.id;
  UPDATE public.flota_paradas SET orden=array_position(ids,id) WHERE ruta_id=rid AND activa;
 ELSIF p_accion='estado_ruta' THEN
  nuevo:=p_datos->>'estado';
  IF NOT ((r.estado='Programada' AND nuevo IN ('En ruta','Cancelada')) OR (r.estado='En ruta' AND nuevo IN ('Finalizada','Cancelada'))) THEN RAISE EXCEPTION 'Transición de ruta inválida.'; END IF;
  IF nuevo IN ('En ruta','Finalizada') AND NOT EXISTS(SELECT 1 FROM public.flota_paradas WHERE ruta_id=rid AND activa) THEN RAISE EXCEPTION 'La ruta no tiene retiros.'; END IF;
  IF nuevo='Finalizada' AND EXISTS(SELECT 1 FROM public.flota_paradas WHERE ruta_id=rid AND activa AND estado NOT IN ('realizado','no realizado')) THEN RAISE EXCEPTION 'Registra el resultado de todos los retiros antes de finalizar.'; END IF;
  IF nuevo='Cancelada' THEN UPDATE public.flota_paradas SET activa=false,estado='liberado',actualizado_en=clock_timestamp() WHERE ruta_id=rid AND activa AND estado<>'realizado'; END IF;
  UPDATE public.flota_rutas SET estado=nuevo WHERE id=rid;
 ELSE RAISE EXCEPTION 'Operación de planificación desconocida.';
 END IF;
 UPDATE public.flota_rutas SET actualizado_en=clock_timestamp() WHERE id=rid;
 INSERT INTO public.flota_eventos(actor,accion,detalle) VALUES(auth.uid(),p_accion,p_datos||jsonb_build_object('ruta',rid));
 RETURN rid;
EXCEPTION WHEN unique_violation THEN
 GET STACKED DIAGNOSTICS restriccion=CONSTRAINT_NAME;
 IF restriccion='flota_rutas_codigo_unico' THEN RAISE EXCEPTION 'El número de ruta ya existe. Solicita otro consecutivo o usa un código diferente.' USING ERRCODE='23505';END IF;
 RAISE EXCEPTION 'Uno de los retiros ya está asignado. Actualiza las rutas.' USING ERRCODE='23505';
END $$;

CREATE OR REPLACE FUNCTION public.brax_driver_asignar(p_ruta uuid,p_version timestamptz,p_conductor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.flota_despacho_autorizar();
 PERFORM pg_advisory_xact_lock(761113,1);
 IF NOT public.flota_conductor_disponible(p_conductor) THEN
  RAISE EXCEPTION 'El usuario debe tener el rol driver en Supabase Auth.';
 END IF;
 UPDATE public.flota_rutas SET conductor_id=p_conductor,actualizado_en=clock_timestamp()
  WHERE id=p_ruta AND estado='Programada' AND eliminada_en IS NULL AND actualizado_en=p_version;
 IF NOT FOUND THEN RAISE EXCEPTION 'La ruta cambió o ya fue iniciada. Actualiza el despacho.'; END IF;
 INSERT INTO public.flota_eventos(actor,accion,detalle) VALUES(auth.uid(),'driver_asignar',
  jsonb_build_object('ruta',p_ruta,'conductor',p_conductor));
END $$;

CREATE OR REPLACE FUNCTION public.flota_despacho_mutar(p_accion text,p_datos jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.flota_rutas; rid uuid; version_actual timestamptz;
BEGIN
 PERFORM public.flota_despacho_autorizar();
 PERFORM pg_advisory_xact_lock(761113,1);
 IF p_accion='crear' THEN
  p_datos:=p_datos||jsonb_build_object('nombre',coalesce(nullif(btrim(p_datos->>'codigo'),''),nullif(btrim(p_datos->>'nombre'),''),public.flota_ruta_proponer()));
  rid := public.flota_plan_mutar('crear',p_datos);
  UPDATE public.flota_rutas SET borrador=coalesce((p_datos->>'borrador')::boolean,false),actualizado_en=clock_timestamp() WHERE id=rid;
 ELSE
  SELECT * INTO r FROM public.flota_rutas WHERE id=(p_datos->>'ruta')::uuid FOR UPDATE;
  IF NOT FOUND OR r.eliminada_en IS NOT NULL OR p_datos->>'version' IS NULL OR r.actualizado_en<>(p_datos->>'version')::timestamptz THEN
   RAISE EXCEPTION 'La ruta cambió. Actualiza antes de continuar.' USING ERRCODE='40001';
  END IF;
  IF r.estado NOT IN ('Programada','En ruta') THEN RAISE EXCEPTION 'La ruta está cerrada.'; END IF;
  rid := r.id;
  IF public.erp_role()='operador' AND (r.estado<>'Programada' OR p_accion='estado_ruta') THEN RAISE EXCEPTION 'El operador solo planifica rutas sin iniciar.' USING ERRCODE='42501';END IF;
  IF p_accion='cabecera' THEN p_datos:=p_datos||jsonb_build_object('nombre',coalesce(nullif(btrim(p_datos->>'codigo'),''),p_datos->>'nombre'));END IF;
  IF p_accion='publicar' THEN
   IF NOT r.borrador THEN RAISE EXCEPTION 'La ruta ya está programada.'; END IF;
   UPDATE public.flota_rutas SET borrador=false,actualizado_en=clock_timestamp() WHERE id=rid;
  ELSIF p_accion IN ('eliminar_vacia','eliminar_borrador') THEN
   IF NOT public.flota_ruta_vacia(r.id) THEN RAISE EXCEPTION 'Solo se elimina una ruta vacía, sin inicio, paradas ni actividad histórica.';END IF;
   UPDATE public.flota_rutas SET eliminada_en=clock_timestamp(),actualizado_en=clock_timestamp() WHERE id=r.id;
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
 IF p_accion IN ('crear','cabecera') THEN
  UPDATE public.flota_rutas SET hora_salida=nullif(p_datos->>'hora_salida','')::time WHERE id=rid;
  SELECT * INTO r FROM public.flota_rutas WHERE id=rid;
  IF EXISTS(SELECT 1 FROM public.flota_rutas otra WHERE otra.id<>rid AND otra.eliminada_en IS NULL AND otra.camion=r.camion AND otra.fecha=r.fecha AND otra.estado='En ruta') THEN
   RAISE EXCEPTION 'El camión está ocupado en otra ruta activa. Selecciona otro camión o resuelve el conflicto.';
  END IF;
 END IF;
 INSERT INTO public.flota_eventos(actor,accion,detalle) VALUES(auth.uid(),'despacho_'||p_accion,p_datos||jsonb_build_object('ruta',rid));
 RETURN rid;
END $$;


CREATE OR REPLACE FUNCTION public.flota_plan_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.flota_plan_autorizar(false);
 RETURN jsonb_build_object(
 'capacidades',jsonb_build_object('planificacion',2),
 'geocodificacion',(SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]') FROM public.flota_geo_trabajos g),
 'rutas',(SELECT coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('puede_eliminar',public.flota_ruta_vacia(r.id)) ORDER BY r.fecha,r.nombre),'[]') FROM public.flota_rutas r WHERE r.eliminada_en IS NULL),
 'paradas',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.orden),'[]') FROM public.flota_paradas p),
 'camiones',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.identificador),'[]') FROM public.flota_camiones c),
 'ubicaciones',(SELECT coalesce(jsonb_agg(to_jsonb(u)),'[]') FROM public.flota_ubicaciones u WHERE u.estado='confirmada'),
 'solicitudes',(SELECT coalesce(jsonb_agg(s.d),'[]') FROM (
   SELECT to_jsonb(b)||jsonb_build_object('origen','B2B') d FROM public.solicitudes_b2b b
   UNION ALL SELECT to_jsonb(c)||jsonb_build_object('origen','B2C') FROM public.solicitudes_b2c c) s),
 'telemetria',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM (
   SELECT DISTINCT ON(patente_camion) * FROM public.telemetria_flota ORDER BY patente_camion,(fuente_ubicacion='gps') DESC NULLS LAST,timestamp DESC,id DESC) t));
END $$;


CREATE OR REPLACE FUNCTION public.brax_driver_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.brax_driver_autorizado() THEN
  RAISE EXCEPTION 'La cuenta no está autorizada como conductor.' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object(
  'nombre', auth.jwt()->'user_metadata'->>'display_name',
  'capacidades',jsonb_build_object('jornada',1,'firma_storage',true),
  'rutas', (SELECT coalesce(jsonb_agg(jsonb_build_object(
   'id',r.id,'nombre',r.nombre,'camion',r.camion,'fecha',r.fecha,'estado',r.estado,'actualizado_en',r.actualizado_en,'iniciado_en',r.iniciado_en,'finalizado_en',r.finalizado_en,
   'paradas',(SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'solicitud',coalesce(p.solicitud_b2b,p.solicitud_b2c),'orden',p.orden,
    'estado',p.estado,'motivo',p.motivo,'actualizado_en',p.actualizado_en,
    'fase_conductor',p.fase_conductor,'en_camino_en',p.en_camino_en,'llegada_en',p.llegada_en,'retiro_iniciado_en',p.retiro_iniciado_en,'resuelto_en',p.resuelto_en,
    'cliente',coalesce(s.d->>'razon_social',s.d->>'nombre'),
    'direccion',s.d->>'direccion','comuna',s.d->>'comuna',
    'telefono',coalesce(s.d->>'telefono',s.d->>'celular'),
    'material',s.d->>'material','fecha_retiro',s.d->>'fecha_retiro',
    'observaciones',s.d->>'observaciones','latitud',u.latitud,'longitud',u.longitud,
    'material_declarado',e.material,'kilos',e.kilos_declarados,
    'nota_conductor',e.observaciones,'tipo_peso',e.tipo_peso,'firma_nombre',e.firma->>'nombre','firma_archivo',e.firma_archivo,'firma_confirmada_en',e.firma_confirmada_en,'registrado_en',e.registrado_en) ORDER BY p.orden),'[]')
   FROM public.flota_paradas p
   LEFT JOIN public.solicitudes_b2b b ON b.id=p.solicitud_b2b
   LEFT JOIN public.solicitudes_b2c c ON c.id=p.solicitud_b2c
   CROSS JOIN LATERAL (SELECT coalesce(to_jsonb(b),to_jsonb(c)) AS d) s
   LEFT JOIN public.flota_ubicaciones u ON (u.solicitud_b2b=p.solicitud_b2b OR u.solicitud_b2c=p.solicitud_b2c) AND u.estado='confirmada' AND NOT(u.latitud=0 AND u.longitud=0)
   LEFT JOIN public.flota_resultados_conductor e ON e.parada_id=p.id AND e.conductor_id=auth.uid()
   WHERE p.ruta_id=r.id AND p.activa)
   ) ORDER BY r.fecha,r.nombre),'[]') FROM public.flota_rutas r WHERE r.conductor_id=auth.uid() AND r.eliminada_en IS NULL AND NOT coalesce((to_jsonb(r)->>'borrador')::boolean,false))
 );
END $$;





CREATE OR REPLACE FUNCTION public.brax_driver_lee_ruta(p_ruta uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.brax_driver_autorizado() AND EXISTS(SELECT 1 FROM public.flota_rutas r WHERE r.id=p_ruta AND r.conductor_id=auth.uid() AND NOT r.borrador AND r.eliminada_en IS NULL)
$$;
REVOKE ALL ON FUNCTION public.flota_ruta_proponer(),public.flota_catalogo_guardar(text,jsonb),public.flota_ruta_vacia(uuid),public.flota_conductor_disponible(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.flota_ruta_proponer(),public.flota_catalogo_guardar(text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.flota_ruta_codigo_guardar() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.flota_ruta_vacia(uuid),public.flota_conductor_disponible(uuid) FROM authenticated;
DO $$ DECLARE tabla text;BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  FOREACH tabla IN ARRAY ARRAY['flota_conductores','flota_geo_trabajos'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=tabla) THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',tabla);END IF;
  END LOOP;
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
