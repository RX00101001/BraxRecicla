-- Ampliación del modelo 20261029_camiones_rutas, sin copiar solicitudes.
-- Ejecutar con propietario de las tablas. Toda la migración es transaccional.
BEGIN;
ALTER TABLE public.telemetria_flota ADD COLUMN IF NOT EXISTS fuente_ubicacion text NOT NULL DEFAULT 'desconocida';
CREATE TABLE IF NOT EXISTS public.flota_camiones (
 identificador text PRIMARY KEY CHECK (btrim(identificador) <> ''), actualizado_en timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.flota_rutas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text NOT NULL CHECK (btrim(nombre) <> ''),
 camion text NOT NULL REFERENCES public.flota_camiones(identificador), conductor text,
 fecha date NOT NULL, estado text NOT NULL CHECK (estado IN ('Programada','En ruta','Finalizada','Cancelada')),
 actualizado_en timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.flota_paradas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ruta_id uuid NOT NULL REFERENCES public.flota_rutas(id),
 orden integer NOT NULL CHECK (orden > 0), solicitud_b2b uuid REFERENCES public.solicitudes_b2b(id),
 solicitud_b2c uuid REFERENCES public.solicitudes_b2c(id), CHECK (num_nonnulls(solicitud_b2b,solicitud_b2c)=1));
ALTER TABLE public.flota_paradas ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'asignado'
 CHECK (estado IN ('asignado','en curso','realizado','no realizado','liberado'));
ALTER TABLE public.flota_paradas ADD COLUMN IF NOT EXISTS activa boolean NOT NULL DEFAULT true;
ALTER TABLE public.flota_paradas ADD COLUMN IF NOT EXISTS motivo text;
ALTER TABLE public.flota_paradas ADD COLUMN IF NOT EXISTS actualizado_en timestamptz NOT NULL DEFAULT now();
-- No se deduce el resultado individual de rutas históricas finalizadas.
-- Se mantienen bloqueadas; las canceladas liberan solo las no realizadas.
UPDATE public.flota_paradas p SET activa=false, estado='liberado'
 FROM public.flota_rutas r WHERE r.id=p.ruta_id AND r.estado='Cancelada' AND p.estado<>'realizado';
-- Unicidad global, también al competir dos sesiones. Si hay duplicados históricos,
-- aborta SIN borrar datos: deben resolverse explícitamente antes de desplegar.
CREATE UNIQUE INDEX IF NOT EXISTS flota_b2b_activa ON public.flota_paradas(solicitud_b2b) WHERE activa;
CREATE UNIQUE INDEX IF NOT EXISTS flota_b2c_activa ON public.flota_paradas(solicitud_b2c) WHERE activa;
-- Sustituye solo restricciones únicas antiguas por orden diferible e historial.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='public.flota_paradas'::regclass AND contype='u'
  AND (pg_get_constraintdef(oid) LIKE 'UNIQUE (ruta_id, orden)%'
   OR pg_get_constraintdef(oid) LIKE 'UNIQUE (ruta_id, solicitud_b2b)%'
   OR pg_get_constraintdef(oid) LIKE 'UNIQUE (ruta_id, solicitud_b2c)%')
 LOOP EXECUTE format('ALTER TABLE public.flota_paradas DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
ALTER TABLE public.flota_paradas ADD CONSTRAINT flota_orden_unico UNIQUE(ruta_id,orden) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE IF NOT EXISTS public.flota_ubicaciones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), solicitud_b2b uuid UNIQUE REFERENCES public.solicitudes_b2b(id),
 solicitud_b2c uuid UNIQUE REFERENCES public.solicitudes_b2c(id),
 latitud double precision NOT NULL CHECK(latitud BETWEEN -90 AND 90),
 longitud double precision NOT NULL CHECK(longitud BETWEEN -180 AND 180),
 actualizado_en timestamptz NOT NULL DEFAULT now(), actualizado_por uuid NOT NULL REFERENCES auth.users(id),
 CHECK(num_nonnulls(solicitud_b2b,solicitud_b2c)=1));
CREATE TABLE IF NOT EXISTS public.flota_eventos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fecha timestamptz NOT NULL DEFAULT now(),
 actor uuid NOT NULL REFERENCES auth.users(id), accion text NOT NULL, detalle jsonb NOT NULL);

CREATE OR REPLACE FUNCTION public.flota_plan_autorizar(escritura boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE rol text := public.erp_role(); BEGIN
 IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'aal','') <> 'aal2'
 OR coalesce(rol,'') NOT IN ('administrador','admin','operador','dueno')
 OR (escritura AND rol NOT IN ('administrador','admin','dueno')) THEN
 RAISE EXCEPTION 'No tienes permiso para esta operación de flota.' USING ERRCODE='42501'; END IF;
END $$;

-- Los clientes solo leen. Todas las escrituras pasan por la RPC validada.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['flota_camiones','flota_rutas','flota_paradas','flota_ubicaciones','flota_eventos'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('DROP POLICY IF EXISTS plan_lectura ON public.%I',t);
 EXECUTE format('CREATE POLICY plan_lectura ON public.%I FOR SELECT TO authenticated USING (public.erp_role() IN (''administrador'',''admin'',''operador'',''dueno'') AND auth.jwt()->>''aal''=''aal2'')',t);
 EXECUTE format('DROP POLICY IF EXISTS plan_lectura_gate ON public.%I',t);
 EXECUTE format('CREATE POLICY plan_lectura_gate ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.erp_role() IN (''administrador'',''admin'',''operador'',''dueno'') AND auth.jwt()->>''aal''=''aal2'')',t);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.flota_plan_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.flota_plan_autorizar(false);
 RETURN jsonb_build_object(
 'rutas',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.fecha,r.nombre),'[]') FROM public.flota_rutas r),
 'paradas',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.orden),'[]') FROM public.flota_paradas p),
 'camiones',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.identificador),'[]') FROM public.flota_camiones c),
 'ubicaciones',(SELECT coalesce(jsonb_agg(to_jsonb(u)),'[]') FROM public.flota_ubicaciones u),
 'solicitudes',(SELECT coalesce(jsonb_agg(s.d),'[]') FROM (
   SELECT to_jsonb(b)||jsonb_build_object('origen','B2B') d FROM public.solicitudes_b2b b
   UNION ALL SELECT to_jsonb(c)||jsonb_build_object('origen','B2C') FROM public.solicitudes_b2c c) s),
 'telemetria',(SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM (
   SELECT DISTINCT ON(patente_camion) * FROM public.telemetria_flota ORDER BY patente_camion,(fuente_ubicacion='gps') DESC NULLS LAST,timestamp DESC,id DESC) t));
END $$;

CREATE OR REPLACE FUNCTION public.flota_plan_mutar(p_accion text,p_datos jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.flota_rutas; destino public.flota_rutas; p public.flota_paradas;
 item jsonb; sid uuid; origen text; situacion text; nuevo text; rid uuid; n integer; ids uuid[];
BEGIN
 PERFORM public.flota_plan_autorizar(true);
 -- Serializa operaciones breves de planificación; no depende del cliente.
 PERFORM pg_advisory_xact_lock(761113,1);
 IF p_accion='crear' THEN
  INSERT INTO public.flota_rutas(nombre,camion,conductor,fecha,estado)
  VALUES(btrim(p_datos->>'nombre'),p_datos->>'camion',nullif(btrim(p_datos->>'conductor'),''),(p_datos->>'fecha')::date,'Programada') RETURNING id INTO rid;
 ELSE
  SELECT * INTO r FROM public.flota_rutas WHERE id=(p_datos->>'ruta')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La ruta ya no existe.'; END IF;
  rid:=r.id;
  IF r.estado IN ('Finalizada','Cancelada') THEN RAISE EXCEPTION 'La ruta está cerrada y no permite cambios.'; END IF;
  IF p_datos->>'version' IS NULL OR r.actualizado_en<>(p_datos->>'version')::timestamptz THEN
   RAISE EXCEPTION 'La ruta cambió en otra sesión. Actualiza e inténtalo nuevamente.'; END IF;
 END IF;
 IF p_accion='editar' THEN
  IF r.estado<>'Programada' THEN RAISE EXCEPTION 'Solo se edita la cabecera de una ruta planificada.'; END IF;
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
    IF NOT FOUND OR destino.id=rid OR destino.estado NOT IN ('Programada','En ruta') THEN RAISE EXCEPTION 'La ruta de destino no está disponible.'; END IF;
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
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'Uno de los retiros ya está asignado. Actualiza las rutas.' USING ERRCODE='23505';
END $$;
REVOKE ALL ON FUNCTION public.flota_plan_autorizar(boolean),public.flota_plan_snapshot(),public.flota_plan_mutar(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.flota_plan_snapshot(),public.flota_plan_mutar(text,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
