-- Geocodificación backend. Requiere despacho de escritorio y jornada móvil.
BEGIN;
CREATE OR REPLACE FUNCTION public.flota_despacho_autorizar(p_catalogos boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR public.brax_es_driver() OR auth.jwt()->>'aal' IS DISTINCT FROM 'aal2'
  OR coalesce(public.erp_role(),'') NOT IN ('admin','administrador','dueno','operador')
  OR (p_catalogos AND public.erp_role() NOT IN ('admin','administrador','dueno')) THEN
  RAISE EXCEPTION 'No tienes permiso para esta operación de despacho.' USING ERRCODE='42501';
 END IF;
END $$;
ALTER TABLE public.solicitudes_b2b ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE public.solicitudes_b2c ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE public.flota_ubicaciones ALTER COLUMN actualizado_por DROP NOT NULL;
ALTER TABLE public.flota_ubicaciones ADD COLUMN IF NOT EXISTS fuente text NOT NULL DEFAULT 'legacy';
ALTER TABLE public.flota_ubicaciones ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('confirmada','revision'));
ALTER TABLE public.flota_ubicaciones ADD COLUMN IF NOT EXISTS confirmada_manualmente boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS public.flota_geo_trabajos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), origen text NOT NULL CHECK(origen IN ('B2B','B2C')), solicitud uuid NOT NULL,
 direccion text NOT NULL, comuna text, region text, clave text NOT NULL,
 estado text NOT NULL CHECK(estado IN ('sin_direccion','pendiente','procesando','no_encontrada','ambigua','confirmada','error')),
 intentos int NOT NULL DEFAULT 0, proximo_en timestamptz NOT NULL DEFAULT now(),
 token uuid, bloqueado_hasta timestamptz, resultado jsonb, error text, actualizado_en timestamptz NOT NULL DEFAULT now(),
 UNIQUE(origen,solicitud));
CREATE TABLE IF NOT EXISTS public.flota_geo_cache (
 clave text PRIMARY KEY, resultado jsonb NOT NULL, vence_en timestamptz NOT NULL, creado_en timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.flota_geo_control (
 id boolean PRIMARY KEY DEFAULT true CHECK(id), token uuid, bloqueado_hasta timestamptz,
 proxima_consulta timestamptz NOT NULL DEFAULT now(), dia date NOT NULL DEFAULT CURRENT_DATE, consultas int NOT NULL DEFAULT 0);
INSERT INTO public.flota_geo_control(id) VALUES(true) ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS flota_geo_pendientes ON public.flota_geo_trabajos(proximo_en) WHERE estado IN ('pendiente','procesando');
ALTER TABLE public.flota_geo_trabajos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flota_geo_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flota_geo_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.flota_geo_trabajos,public.flota_geo_cache,public.flota_geo_control FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.flota_geo_trabajos TO authenticated;
DROP POLICY IF EXISTS geo_erp_lectura ON public.flota_geo_trabajos;
CREATE POLICY geo_erp_lectura ON public.flota_geo_trabajos FOR SELECT TO authenticated
 USING(NOT public.brax_es_driver() AND public.erp_role() IN ('admin','administrador','dueno','operador') AND auth.jwt()->>'aal'='aal2');

CREATE OR REPLACE FUNCTION public.flota_geo_limpiar(p_texto text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT btrim(regexp_replace(regexp_replace(coalesce(p_texto,''),'[ ·]*Contacto:.*$','','i'),'[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}','','g'))
$$;
CREATE OR REPLACE FUNCTION public.flota_geo_encolar(p_origen text,p_id uuid,p_direccion text,p_comuna text,p_region text,p_cambio boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE direccion text:=public.flota_geo_limpiar(p_direccion); ubicacion public.flota_ubicaciones; situacion text;
BEGIN
 PERFORM pg_advisory_xact_lock(761113,2);
 SELECT * INTO ubicacion FROM public.flota_ubicaciones WHERE (p_origen='B2B' AND solicitud_b2b=p_id) OR (p_origen='B2C' AND solicitud_b2c=p_id) FOR UPDATE;
 IF FOUND AND ubicacion.latitud BETWEEN -90 AND 90 AND ubicacion.longitud BETWEEN -180 AND 180 AND NOT(ubicacion.latitud=0 AND ubicacion.longitud=0) THEN
  IF NOT p_cambio AND ubicacion.estado='confirmada' THEN RETURN; END IF;
  IF p_cambio AND ubicacion.confirmada_manualmente THEN
   UPDATE public.flota_ubicaciones SET estado='revision' WHERE id=ubicacion.id;
   situacion:='ambigua';
  ELSIF NOT p_cambio AND ubicacion.confirmada_manualmente THEN RETURN;
  ELSE
   UPDATE public.flota_ubicaciones SET estado='revision' WHERE id=ubicacion.id;
  END IF;
 END IF;
 situacion:=CASE WHEN direccion='' THEN 'sin_direccion' ELSE coalesce(situacion,'pendiente') END;
 INSERT INTO public.flota_geo_trabajos(origen,solicitud,direccion,comuna,region,clave,estado)
 VALUES(p_origen,p_id,direccion,nullif(btrim(p_comuna),''),nullif(btrim(p_region),''),md5(lower(translate(regexp_replace(direccion||'|'||coalesce(p_comuna,'')||'|'||coalesce(p_region,''),'\s+',' ','g'),'ÁÉÍÓÚÜÑáéíóúüñ','AEIOUUNaeiouun'))),situacion)
 ON CONFLICT(origen,solicitud) DO UPDATE SET direccion=excluded.direccion,comuna=excluded.comuna,region=excluded.region,clave=excluded.clave,
  estado=excluded.estado,intentos=0,proximo_en=now(),token=null,bloqueado_hasta=null,resultado=null,
  error=CASE WHEN excluded.estado='ambigua' THEN 'La dirección cambió. Confirma nuevamente la ubicación manual.' END,actualizado_en=clock_timestamp();
END $$;
CREATE OR REPLACE FUNCTION public.flota_geo_nueva_solicitud()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' OR (lower(regexp_replace(public.flota_geo_limpiar(NEW.direccion),'\s+',' ','g')),lower(btrim(NEW.comuna)),lower(btrim(NEW.region))) IS DISTINCT FROM
  (lower(regexp_replace(public.flota_geo_limpiar(OLD.direccion),'\s+',' ','g')),lower(btrim(OLD.comuna)),lower(btrim(OLD.region))) THEN
  PERFORM public.flota_geo_encolar(CASE WHEN TG_TABLE_NAME='solicitudes_b2b' THEN 'B2B' ELSE 'B2C' END,NEW.id,NEW.direccion,NEW.comuna,NEW.region,TG_OP='UPDATE');
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS flota_geo_insertar ON public.solicitudes_b2b;
CREATE TRIGGER flota_geo_insertar AFTER INSERT OR UPDATE OF direccion,comuna,region ON public.solicitudes_b2b FOR EACH ROW EXECUTE FUNCTION public.flota_geo_nueva_solicitud();
DROP TRIGGER IF EXISTS flota_geo_insertar ON public.solicitudes_b2c;
CREATE TRIGGER flota_geo_insertar AFTER INSERT OR UPDATE OF direccion,comuna,region ON public.solicitudes_b2c FOR EACH ROW EXECUTE FUNCTION public.flota_geo_nueva_solicitud();

CREATE OR REPLACE FUNCTION public.flota_geo_pendientes(p_limite int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE solicitud record; total int:=0;
BEGIN
 PERFORM public.flota_despacho_autorizar(true);
 FOR solicitud IN SELECT * FROM (
  SELECT 'B2B'::text origen,id,direccion,comuna,region,estado FROM public.solicitudes_b2b
  UNION ALL SELECT 'B2C',id,direccion,comuna,region,estado FROM public.solicitudes_b2c) s
  WHERE lower(coalesce(s.estado,'')) IN ('pendiente','aprobado','aprobada','en ruta')
   AND NOT EXISTS(SELECT 1 FROM public.flota_ubicaciones u WHERE ((s.origen='B2B' AND u.solicitud_b2b=s.id) OR (s.origen='B2C' AND u.solicitud_b2c=s.id))
    AND u.estado='confirmada' AND u.latitud BETWEEN -90 AND 90 AND u.longitud BETWEEN -180 AND 180 AND NOT(u.latitud=0 AND u.longitud=0))
   AND NOT EXISTS(SELECT 1 FROM public.flota_geo_trabajos t WHERE t.origen=s.origen AND t.solicitud=s.id AND NOT(t.estado='error' AND t.actualizado_en<now()-interval '5 minutes'))
  ORDER BY s.origen,s.id LIMIT least(greatest(p_limite,1),100)
 LOOP
  PERFORM public.flota_geo_encolar(solicitud.origen,solicitud.id,solicitud.direccion,solicitud.comuna,solicitud.region);total:=total+1;
 END LOOP;
 RETURN jsonb_build_object('encoladas',total);
END $$;

-- Estas RPC están reservadas a la Edge Function (service_role).
CREATE OR REPLACE FUNCTION public.flota_geo_reclamar(p_token uuid,p_cupo int DEFAULT 1000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE control public.flota_geo_control; tarea public.flota_geo_trabajos; cache public.flota_geo_cache;
BEGIN
 SELECT * INTO control FROM public.flota_geo_control WHERE id=true FOR UPDATE;
 IF control.bloqueado_hasta>now() AND control.token IS DISTINCT FROM p_token THEN RETURN jsonb_build_object('ocupado',true); END IF;
 UPDATE public.flota_geo_control SET token=p_token,bloqueado_hasta=clock_timestamp()+interval '60 seconds' WHERE id=true;
 UPDATE public.flota_geo_trabajos SET estado=CASE WHEN intentos>=3 THEN 'error' ELSE 'pendiente' END,token=null
  WHERE estado='procesando' AND bloqueado_hasta<now();
 SELECT * INTO tarea FROM public.flota_geo_trabajos WHERE estado='pendiente' AND proximo_en<=now() AND intentos<3 ORDER BY proximo_en,id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('vacio',true); END IF;
 SELECT * INTO cache FROM public.flota_geo_cache WHERE clave=tarea.clave AND vence_en>now();
 IF NOT FOUND THEN
  IF control.dia=(now() AT TIME ZONE 'UTC')::date AND control.consultas>=least(greatest(p_cupo,1),2500) THEN RETURN jsonb_build_object('cuota',true); END IF;
  IF control.proxima_consulta>clock_timestamp() THEN RETURN jsonb_build_object('esperar_ms',ceil(extract(epoch FROM control.proxima_consulta-clock_timestamp())*1000)); END IF;
  UPDATE public.flota_geo_control SET consultas=CASE WHEN dia=(now() AT TIME ZONE 'UTC')::date THEN consultas+1 ELSE 1 END,dia=(now() AT TIME ZONE 'UTC')::date,
   proxima_consulta=clock_timestamp()+interval '1100 milliseconds' WHERE id=true;
 END IF;
 UPDATE public.flota_geo_trabajos SET estado='procesando',intentos=intentos+1,token=p_token,bloqueado_hasta=clock_timestamp()+interval '60 seconds',actualizado_en=clock_timestamp() WHERE id=tarea.id;
 RETURN jsonb_build_object('id',tarea.id,'origen',tarea.origen,'solicitud',tarea.solicitud,'direccion',tarea.direccion,'comuna',tarea.comuna,'region',tarea.region,'cache',cache.resultado);
END $$;
CREATE OR REPLACE FUNCTION public.flota_geo_resultado(p_token uuid,p_id uuid,p_resultado jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tarea public.flota_geo_trabajos; situacion text:=p_resultado->>'estado'; lat float8; lng float8;
BEGIN
 PERFORM pg_advisory_xact_lock(761113,2);
 SELECT * INTO tarea FROM public.flota_geo_trabajos WHERE id=p_id AND token=p_token AND estado='procesando' FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF; -- Dirección cambiada, confirmada manualmente o lease sustituido.
 IF situacion NOT IN ('confirmada','ambigua','no_encontrada','error') OR situacion IS NULL THEN RAISE EXCEPTION 'Resultado geográfico inválido.'; END IF;
 IF situacion='confirmada' THEN
  lat:=(p_resultado->>'latitud')::float8;lng:=(p_resultado->>'longitud')::float8;
  IF lat IS NULL OR lng IS NULL OR NOT(lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180) OR (lat=0 AND lng=0) THEN RAISE EXCEPTION 'Coordenadas inválidas.'; END IF;
  IF tarea.origen='B2B' THEN
   INSERT INTO public.flota_ubicaciones(solicitud_b2b,latitud,longitud,actualizado_por,fuente,estado) VALUES(tarea.solicitud,lat,lng,null,'opencage','confirmada')
   ON CONFLICT(solicitud_b2b) DO UPDATE SET latitud=excluded.latitud,longitud=excluded.longitud,fuente='opencage',estado='confirmada',actualizado_por=null,actualizado_en=clock_timestamp()
    WHERE NOT public.flota_ubicaciones.confirmada_manualmente;
  ELSE
   INSERT INTO public.flota_ubicaciones(solicitud_b2c,latitud,longitud,actualizado_por,fuente,estado) VALUES(tarea.solicitud,lat,lng,null,'opencage','confirmada')
   ON CONFLICT(solicitud_b2c) DO UPDATE SET latitud=excluded.latitud,longitud=excluded.longitud,fuente='opencage',estado='confirmada',actualizado_por=null,actualizado_en=clock_timestamp()
    WHERE NOT public.flota_ubicaciones.confirmada_manualmente;
  END IF;
 END IF;
 UPDATE public.flota_geo_trabajos SET estado=CASE WHEN situacion='error' AND coalesce((p_resultado->>'reintentable')::boolean,false) AND intentos<3 THEN 'pendiente' ELSE situacion END,
  resultado=p_resultado,error=left(p_resultado->>'error',250),proximo_en=clock_timestamp()+make_interval(secs=>least(3600,60*intentos*intentos)),token=null,bloqueado_hasta=null,actualizado_en=clock_timestamp() WHERE id=tarea.id;
 IF situacion<>'error' THEN
  INSERT INTO public.flota_geo_cache(clave,resultado,vence_en) VALUES(tarea.clave,p_resultado,clock_timestamp()+CASE WHEN situacion='confirmada' THEN interval '3650 days' ELSE interval '1 day' END)
  ON CONFLICT(clave) DO UPDATE SET resultado=excluded.resultado,vence_en=excluded.vence_en;
 END IF;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION public.flota_geo_liberar(p_token uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ UPDATE public.flota_geo_control SET bloqueado_hasta=null,token=null WHERE token=p_token $$;

CREATE OR REPLACE FUNCTION public.flota_despacho_solicitud(p_origen text,p_id uuid,p_datos jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE prioridad_elegida text:=nullif(btrim(p_datos->>'prioridad'),''); lat float8; lng float8;
BEGIN
 PERFORM public.flota_despacho_autorizar();PERFORM pg_advisory_xact_lock(761113,1);
 IF prioridad_elegida IS NOT NULL AND prioridad_elegida NOT IN ('baja','normal','alta','urgente') THEN RAISE EXCEPTION 'Prioridad inválida.'; END IF;
 IF p_origen='B2B' THEN
  UPDATE public.solicitudes_b2b SET direccion=nullif(btrim(p_datos->>'direccion'),''),comuna=nullif(btrim(p_datos->>'comuna'),''),region=nullif(btrim(p_datos->>'region'),''),prioridad=prioridad_elegida WHERE id=p_id;
 ELSIF p_origen='B2C' THEN
  UPDATE public.solicitudes_b2c SET direccion=nullif(btrim(p_datos->>'direccion'),''),comuna=nullif(btrim(p_datos->>'comuna'),''),region=nullif(btrim(p_datos->>'region'),''),prioridad=prioridad_elegida WHERE id=p_id;
 ELSE RAISE EXCEPTION 'Origen inválido.';END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'La solicitud ya no existe.';END IF;
 IF coalesce((p_datos->>'confirmar_ubicacion')::boolean,NOT(p_datos ? 'confirmar_ubicacion') AND p_datos->>'latitud' IS NOT NULL) THEN
  lat:=(p_datos->>'latitud')::float8;lng:=(p_datos->>'longitud')::float8;
  IF lat IS NULL OR lng IS NULL OR NOT(lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180) OR (lat=0 AND lng=0) THEN RAISE EXCEPTION 'Selecciona coordenadas válidas, distintas de 0,0.';END IF;
  IF p_origen='B2B' THEN
   INSERT INTO public.flota_ubicaciones(solicitud_b2b,latitud,longitud,actualizado_por,fuente,estado,confirmada_manualmente) VALUES(p_id,lat,lng,auth.uid(),'manual','confirmada',true)
   ON CONFLICT(solicitud_b2b) DO UPDATE SET latitud=excluded.latitud,longitud=excluded.longitud,fuente='manual',estado='confirmada',confirmada_manualmente=true,actualizado_por=auth.uid(),actualizado_en=clock_timestamp();
  ELSE
   INSERT INTO public.flota_ubicaciones(solicitud_b2c,latitud,longitud,actualizado_por,fuente,estado,confirmada_manualmente) VALUES(p_id,lat,lng,auth.uid(),'manual','confirmada',true)
   ON CONFLICT(solicitud_b2c) DO UPDATE SET latitud=excluded.latitud,longitud=excluded.longitud,fuente='manual',estado='confirmada',confirmada_manualmente=true,actualizado_por=auth.uid(),actualizado_en=clock_timestamp();
  END IF;
  UPDATE public.flota_geo_trabajos SET estado='confirmada',token=null,resultado=jsonb_build_object('fuente','manual'),error=null,actualizado_en=clock_timestamp() WHERE origen=p_origen AND solicitud=p_id;
 END IF;
 INSERT INTO public.flota_eventos(actor,accion,detalle) VALUES(auth.uid(),'despacho_datos_retiro',jsonb_build_object('origen',p_origen,'solicitud',p_id));
END $$;

REVOKE ALL ON FUNCTION public.flota_despacho_autorizar(boolean),public.flota_geo_limpiar(text),public.flota_geo_encolar(text,uuid,text,text,text,boolean),public.flota_geo_nueva_solicitud() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.flota_geo_pendientes(int) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.flota_geo_pendientes(int) TO authenticated;
REVOKE ALL ON FUNCTION public.flota_geo_reclamar(uuid,int),public.flota_geo_resultado(uuid,uuid,jsonb),public.flota_geo_liberar(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.flota_geo_reclamar(uuid,int),public.flota_geo_resultado(uuid,uuid,jsonb),public.flota_geo_liberar(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
