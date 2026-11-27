-- Jornada móvil: aplicar después de 20261119_brax_driver.sql y 20261120_brax_driver_acceso.sql.
-- Si se usa despacho de escritorio, aplicar su migración ANTES de esta.
-- Aditiva, transaccional; no altera estados canónicos ni pesos de báscula.
BEGIN;
ALTER TABLE public.flota_rutas ADD COLUMN IF NOT EXISTS iniciado_en timestamptz;
ALTER TABLE public.flota_rutas ADD COLUMN IF NOT EXISTS finalizado_en timestamptz;
ALTER TABLE public.flota_paradas ADD COLUMN IF NOT EXISTS fase_conductor text CHECK (fase_conductor IN ('en_camino','llegada','retiro'));
ALTER TABLE public.flota_paradas ADD COLUMN IF NOT EXISTS en_camino_en timestamptz;
ALTER TABLE public.flota_paradas ADD COLUMN IF NOT EXISTS llegada_en timestamptz;
ALTER TABLE public.flota_paradas ADD COLUMN IF NOT EXISTS retiro_iniciado_en timestamptz;
ALTER TABLE public.flota_paradas ADD COLUMN IF NOT EXISTS resuelto_en timestamptz;
ALTER TABLE public.flota_resultados_conductor ADD COLUMN IF NOT EXISTS firma_archivo text;
ALTER TABLE public.flota_resultados_conductor ADD COLUMN IF NOT EXISTS firma_confirmada_en timestamptz;
ALTER TABLE public.flota_resultados_conductor ADD COLUMN IF NOT EXISTS tipo_peso text CHECK (tipo_peso IN ('estimado','medido'));

UPDATE storage.buckets SET public=false WHERE id='brax-driver-evidencias';

-- Firma vectorial JSON privada: conserva los trazos históricos y evita SVG ejecutable.
UPDATE storage.buckets SET allowed_mime_types=ARRAY(
 SELECT DISTINCT tipo FROM unnest(coalesce(allowed_mime_types,ARRAY['image/jpeg','image/png'])||ARRAY['application/json']) AS tipo
) WHERE id='brax-driver-evidencias' AND allowed_mime_types IS NOT NULL;

CREATE OR REPLACE FUNCTION public.brax_driver_ruta(p_ruta uuid,p_version timestamptz,p_accion text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.flota_rutas; destino text;
BEGIN
 IF NOT public.brax_driver_autorizado() THEN RAISE EXCEPTION 'Acceso restringido a conductores.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(761113,1);
 SELECT * INTO r FROM public.flota_rutas WHERE id=p_ruta AND conductor_id=auth.uid() FOR UPDATE;
 IF NOT FOUND OR coalesce((to_jsonb(r)->>'borrador')::boolean,false) THEN
  RAISE EXCEPTION 'La ruta no está asignada a tu cuenta o aún es un borrador.' USING ERRCODE='42501';
 END IF;
 IF p_accion IS NULL OR p_accion NOT IN ('iniciar','finalizar') THEN RAISE EXCEPTION 'Acción de jornada inválida.'; END IF;
 destino:=CASE WHEN p_accion='iniciar' THEN 'En ruta' ELSE 'Finalizada' END;
 IF r.estado=destino AND EXISTS(SELECT 1 FROM public.flota_eventos WHERE actor=auth.uid() AND accion='driver_ruta_'||p_accion
   AND detalle->>'ruta'=r.id::text AND (detalle->>'version')::timestamptz=p_version) THEN RETURN; END IF;
 IF p_version IS NULL OR r.actualizado_en IS DISTINCT FROM p_version THEN
  RAISE EXCEPTION 'La ruta cambió. Actualiza la jornada y vuelve a intentarlo.' USING ERRCODE='40001';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.flota_paradas WHERE ruta_id=r.id AND activa) THEN RAISE EXCEPTION 'La ruta no tiene paradas asignadas.'; END IF;
 IF p_accion='iniciar' THEN
  IF r.estado<>'Programada' THEN RAISE EXCEPTION 'Solo puedes iniciar una ruta programada.'; END IF;
  IF EXISTS(SELECT 1 FROM public.flota_rutas WHERE conductor_id=auth.uid() AND estado='En ruta' AND id<>r.id) THEN
   RAISE EXCEPTION 'Finaliza tu otra ruta activa antes de iniciar esta.';
  END IF;
  UPDATE public.flota_rutas SET estado='En ruta',iniciado_en=clock_timestamp(),actualizado_en=clock_timestamp() WHERE id=r.id;
 ELSE
  IF r.estado<>'En ruta' THEN RAISE EXCEPTION 'Solo puedes finalizar una ruta en curso.'; END IF;
  IF EXISTS(SELECT 1 FROM public.flota_paradas WHERE ruta_id=r.id AND activa AND estado NOT IN ('realizado','no realizado')) THEN
   RAISE EXCEPTION 'Resuelve las paradas pendientes antes de finalizar la ruta.';
  END IF;
  UPDATE public.flota_rutas SET estado='Finalizada',finalizado_en=clock_timestamp(),actualizado_en=clock_timestamp() WHERE id=r.id;
 END IF;
 INSERT INTO public.flota_eventos(actor,accion,detalle) VALUES(auth.uid(),'driver_ruta_'||p_accion,jsonb_build_object('ruta',r.id,'version',p_version));
END $$;

CREATE OR REPLACE FUNCTION public.brax_driver_parada(p_ruta uuid,p_parada uuid,p_version timestamptz,p_accion text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.flota_rutas; p public.flota_paradas;
BEGIN
 IF NOT public.brax_driver_autorizado() THEN RAISE EXCEPTION 'Acceso restringido a conductores.' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(761113,1);
 SELECT * INTO r FROM public.flota_rutas WHERE id=p_ruta AND conductor_id=auth.uid() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La ruta no está asignada a tu cuenta.' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM public.flota_paradas WHERE id=p_parada AND ruta_id=r.id AND activa FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'La parada ya no está asignada.' USING ERRCODE='42501'; END IF;
 IF p_accion IS NULL OR p_accion NOT IN ('en_camino','llegada','retiro') THEN RAISE EXCEPTION 'Fase de retiro inválida.'; END IF;
 IF p.fase_conductor=p_accion AND EXISTS(SELECT 1 FROM public.flota_eventos WHERE actor=auth.uid() AND accion='driver_fase_parada'
  AND detalle->>'parada'=p.id::text AND detalle->>'fase'=p_accion AND (detalle->>'version')::timestamptz=p_version) THEN RETURN; END IF;
 IF r.estado<>'En ruta' OR p.estado NOT IN ('asignado','en curso') OR p_version IS NULL OR p.actualizado_en IS DISTINCT FROM p_version THEN
  RAISE EXCEPTION 'La parada cambió o la jornada no está activa. Actualiza para continuar.' USING ERRCODE='40001';
 END IF;
 IF EXISTS(SELECT 1 FROM public.flota_paradas WHERE ruta_id=r.id AND activa AND orden<p.orden AND estado NOT IN ('realizado','no realizado')) THEN
  RAISE EXCEPTION 'Primero resuelve las paradas anteriores.';
 END IF;
 IF NOT coalesce(((p.fase_conductor IS NULL AND p_accion='en_camino') OR (p.fase_conductor='en_camino' AND p_accion='llegada')
  OR (p.fase_conductor='llegada' AND p_accion='retiro')),false) THEN RAISE EXCEPTION 'Transición de parada inválida.'; END IF;
 UPDATE public.flota_paradas SET estado='en curso',fase_conductor=p_accion,
  en_camino_en=CASE WHEN p_accion='en_camino' THEN clock_timestamp() ELSE en_camino_en END,
  llegada_en=CASE WHEN p_accion='llegada' THEN clock_timestamp() ELSE llegada_en END,
  retiro_iniciado_en=CASE WHEN p_accion='retiro' THEN clock_timestamp() ELSE retiro_iniciado_en END,
  actualizado_en=clock_timestamp() WHERE id=p.id;
 UPDATE public.flota_rutas SET actualizado_en=clock_timestamp() WHERE id=r.id;
 INSERT INTO public.flota_eventos(actor,accion,detalle) VALUES(auth.uid(),'driver_fase_parada',jsonb_build_object('ruta',r.id,'parada',p.id,'fase',p_accion,'version',p_version));
END $$;

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
  RAISE EXCEPTION 'Registra material, kilos, fotografía y firma de quien entrega los materiales.';
 END IF;
 IF p_estado='no realizado' AND coalesce(length(btrim(p_motivo)),0) NOT BETWEEN 1 AND 200 THEN
  RAISE EXCEPTION 'Indica el motivo del retiro no realizado.';
 END IF;
 IF coalesce(cardinality(p_fotos),0)>4 OR coalesce(length(p_nota),0)>2000
    OR coalesce(pg_column_size(p_firma),0)>100000 THEN RAISE EXCEPTION 'La evidencia supera el límite permitido.'; END IF;
 IF p_estado='realizado' THEN
  IF p.estado<>'en curso' OR (p.fase_conductor IS NOT NULL AND p.fase_conductor<>'retiro') THEN
   RAISE EXCEPTION 'Inicia el retiro antes de completarlo.';
  END IF;
  IF p_firma->>'archivo' IS NULL OR split_part(p_firma->>'archivo','/',1)<>auth.uid()::text
   OR split_part(p_firma->>'archivo','/',2)<>r.id::text OR split_part(p_firma->>'archivo','/',3)<>p.id::text
   OR split_part(p_firma->>'archivo','/',4) !~ '^firma-[a-fA-F0-9-]+[.]json$'
   OR array_length(string_to_array(p_firma->>'archivo','/'),1)<>4
   OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='brax-driver-evidencias' AND name=p_firma->>'archivo')
   OR p_firma->>'solicitud' IS DISTINCT FROM coalesce(p.solicitud_b2b,p.solicitud_b2c)::text
   OR p_firma->>'parada' IS DISTINCT FROM p.id::text OR p_firma->>'ruta' IS DISTINCT FROM r.id::text
   OR coalesce(p_firma->>'tipo_peso','') NOT IN ('estimado','medido')
   OR p_firma->>'confirmada_en' IS NULL THEN
   RAISE EXCEPTION 'Confirma y guarda la firma de quien entrega para este retiro.';
  END IF;
  IF NOT isfinite((p_firma->>'confirmada_en')::timestamptz) OR (p_firma->>'confirmada_en')::timestamptz > clock_timestamp()+interval '5 minutes' THEN
   RAISE EXCEPTION 'Revisa la fecha y hora del dispositivo antes de confirmar la firma.';
  END IF;
  IF p_firma->>'material' IS DISTINCT FROM btrim(p_material) OR (p_firma->>'kilos')::numeric IS DISTINCT FROM p_kilos THEN
   RAISE EXCEPTION 'El material o los kilos cambiaron después de confirmar la firma.';
  END IF;
  IF jsonb_array_length(p_firma->'trazos') NOT BETWEEN 1 AND 30 THEN
   RAISE EXCEPTION 'Registra la firma de quien entrega los materiales.';
  END IF;
  FOR trazo IN SELECT value FROM jsonb_array_elements(p_firma->'trazos') LOOP
   IF jsonb_typeof(trazo) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Firma de entrega inválida.'; END IF;
   IF jsonb_array_length(trazo) NOT BETWEEN 2 AND 120 THEN RAISE EXCEPTION 'Firma de entrega inválida.'; END IF;
   FOR punto IN SELECT value FROM jsonb_array_elements(trazo) LOOP
    IF jsonb_typeof(punto->'x') IS DISTINCT FROM 'number' OR jsonb_typeof(punto->'y') IS DISTINCT FROM 'number'
       THEN RAISE EXCEPTION 'Firma de entrega inválida.'; END IF;
    IF (punto->>'x')::numeric NOT BETWEEN 0 AND 1000 OR (punto->>'y')::numeric NOT BETWEEN 0 AND 1000
       THEN RAISE EXCEPTION 'Firma de entrega inválida.'; END IF;
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
  INSERT INTO public.flota_resultados_conductor(parada_id,conductor_id,material,kilos_declarados,observaciones,fotos,firma,firma_archivo,firma_confirmada_en,tipo_peso)
  VALUES(p.id,auth.uid(),CASE WHEN p_estado='realizado' THEN btrim(p_material) END,
   CASE WHEN p_estado='realizado' THEN p_kilos END,nullif(btrim(p_nota),''),coalesce(p_fotos,'{}'),
   CASE WHEN p_estado='realizado' THEN p_firma END,
   CASE WHEN p_estado='realizado' THEN p_firma->>'archivo' END,
   CASE WHEN p_estado='realizado' THEN (p_firma->>'confirmada_en')::timestamptz END,
   CASE WHEN p_estado='realizado' THEN p_firma->>'tipo_peso' END);
 END IF;
 UPDATE public.flota_paradas SET estado=p_estado, actualizado_en=clock_timestamp(),
   fase_conductor=CASE WHEN p_estado='en curso' THEN 'retiro' ELSE fase_conductor END,
   retiro_iniciado_en=CASE WHEN p_estado='en curso' THEN coalesce(retiro_iniciado_en,clock_timestamp()) ELSE retiro_iniciado_en END,
   resuelto_en=CASE WHEN p_estado IN ('realizado','no realizado') THEN clock_timestamp() ELSE resuelto_en END,
   motivo=CASE WHEN p_estado='no realizado' THEN btrim(p_motivo) END WHERE id=p.id;
 UPDATE public.flota_rutas SET actualizado_en=clock_timestamp() WHERE id=r.id;
 INSERT INTO public.flota_eventos(actor,accion,detalle) VALUES(auth.uid(),'driver_estado_parada',
  jsonb_build_object('ruta',r.id,'parada',p.id,'estado',p_estado,'version',p_version,'huella',huella));
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
   LEFT JOIN public.flota_ubicaciones u ON u.solicitud_b2b=p.solicitud_b2b OR u.solicitud_b2c=p.solicitud_b2c
   LEFT JOIN public.flota_resultados_conductor e ON e.parada_id=p.id AND e.conductor_id=auth.uid()
   WHERE p.ruta_id=r.id AND p.activa)
   ) ORDER BY r.fecha,r.nombre),'[]') FROM public.flota_rutas r WHERE r.conductor_id=auth.uid() AND NOT coalesce((to_jsonb(r)->>'borrador')::boolean,false))
 );
END $$;



-- SELECT limitado a la propia ruta para Realtime; las escrituras siguen pasando por RPC.
CREATE OR REPLACE FUNCTION public.brax_driver_lee_ruta(p_ruta uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.brax_driver_autorizado() AND EXISTS(SELECT 1 FROM public.flota_rutas r WHERE r.id=p_ruta AND r.conductor_id=auth.uid()
  AND NOT coalesce((to_jsonb(r)->>'borrador')::boolean,false))
$$;
ALTER TABLE public.flota_rutas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS brax_driver_rpc_only ON public.flota_rutas;
CREATE POLICY brax_driver_rpc_only ON public.flota_rutas AS RESTRICTIVE FOR ALL TO authenticated
 USING (NOT public.brax_es_driver() OR public.brax_driver_lee_ruta(id)) WITH CHECK (NOT public.brax_es_driver());
DROP POLICY IF EXISTS plan_lectura_gate ON public.flota_rutas;
CREATE POLICY plan_lectura_gate ON public.flota_rutas AS RESTRICTIVE FOR SELECT TO authenticated
 USING ((NOT public.brax_es_driver() AND public.erp_role() IN ('admin','administrador','operador','dueno') AND auth.jwt()->>'aal'='aal2') OR public.brax_driver_lee_ruta(id));
DROP POLICY IF EXISTS brax_driver_ruta_propia ON public.flota_rutas;
CREATE POLICY brax_driver_ruta_propia ON public.flota_rutas FOR SELECT TO authenticated USING (public.brax_driver_lee_ruta(id));
DROP POLICY IF EXISTS brax_driver_no_borra_ruta ON public.flota_rutas;
CREATE POLICY brax_driver_no_borra_ruta ON public.flota_rutas AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.brax_es_driver());
REVOKE INSERT,UPDATE,DELETE ON public.flota_rutas FROM authenticated;
GRANT SELECT ON public.flota_rutas TO authenticated;
REVOKE ALL ON FUNCTION public.brax_driver_ruta(uuid,timestamptz,text),public.brax_driver_parada(uuid,uuid,timestamptz,text),public.brax_driver_lee_ruta(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.brax_driver_ruta(uuid,timestamptz,text),public.brax_driver_parada(uuid,uuid,timestamptz,text),public.brax_driver_lee_ruta(uuid) TO authenticated;
DO $$ DECLARE tabla text; BEGIN
 IF EXISTS(SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
  FOREACH tabla IN ARRAY ARRAY['flota_rutas','flota_paradas','flota_resultados_conductor','flota_gps_conductor'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=tabla) THEN
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',tabla);
   END IF;
  END LOOP;
 END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
