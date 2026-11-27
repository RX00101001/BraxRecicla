-- Configuración operativa, NO ejecutar antes de desplegar la función y configurar OpenCage.
-- Requiere pg_cron, pg_net y Vault habilitados en Supabase.
-- Crear en Vault (desde administración, sin incluir claves en Git):
--   brax_geo_project_url: URL HTTPS del proyecto
--   brax_geo_service_role_jwt: JWT service_role del proyecto, exclusivamente backend
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='brax_geo_project_url') OR
    NOT EXISTS(SELECT 1 FROM vault.decrypted_secrets WHERE name='brax_geo_service_role_jwt') THEN
  RAISE EXCEPTION 'Configura las dos entradas de Vault antes de programar el worker.';
 END IF;
END $$;
SELECT cron.schedule('brax-geocode-pickups','* * * * *',$worker$
 SELECT net.http_post(
  url:=(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='brax_geo_project_url')||'/functions/v1/geocode-pickups',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='brax_geo_service_role_jwt')),
  body:='{"limite":5}'::jsonb,timeout_milliseconds:=55000
 );
$worker$);
