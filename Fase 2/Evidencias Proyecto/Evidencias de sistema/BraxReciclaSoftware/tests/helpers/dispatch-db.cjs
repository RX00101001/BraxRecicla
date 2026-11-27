/* eslint-disable @typescript-eslint/no-require-imports -- Node integration harness. */
// Isolated PostgreSQL with synthetic QA fixtures. Never connects to Supabase.
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const migration = name => readFileSync(resolve(__dirname, '../../../Database/migrations', name), 'utf8');
const admin='10000000-0000-4000-8000-000000000001', driver='10000000-0000-4000-8000-000000000002', operator='10000000-0000-4000-8000-000000000003';
module.exports = { admin, driver, operator, async createDatabase({ desktop = true } = {}) {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE SCHEMA storage;
      CREATE TABLE auth.users(id uuid PRIMARY KEY,raw_app_meta_data jsonb DEFAULT '{}',raw_user_meta_data jsonb DEFAULT '{}');
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      CREATE TABLE public.erp_roles(user_id uuid,role text);
      CREATE TABLE public.erp_profiles(user_id uuid PRIMARY KEY,display_name text);
      CREATE FUNCTION public.erp_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT role FROM public.erp_roles WHERE user_id=auth.uid() LIMIT 1 $$;
      CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text);
      CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT (string_to_array(name,'/'))[1:cardinality(string_to_array(name,'/'))-1] $$;
      GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
    `);
    const schema=readFileSync(resolve(__dirname,'../../../Database/schema.sql'),'utf8').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;','');
    await db.exec(schema);
    await db.exec(migration('20261113_planificacion_flota.sql'));
    await db.exec(migration('20261119_brax_driver.sql'));
    await db.exec(migration('20261120_brax_driver_acceso.sql'));
    if (desktop) {
      await db.exec(migration('20261120_despacho_escritorio.sql'));
      await db.exec(migration('20261120_despacho_escritorio.sql')); // additive migration is rerunnable
    }
    await db.query(`INSERT INTO auth.users(id,raw_app_meta_data) VALUES($1,'{}'),($2,'{"role":"driver"}'),($3,'{}')`,[admin,driver,operator]);
    await db.query(`INSERT INTO erp_roles VALUES($1,'admin'),($2,'operador')`,[admin,operator]);
    await db.query(`INSERT INTO erp_profiles VALUES($1,'Conductor prueba')`,[driver]);
    await db.exec(`INSERT INTO flota_camiones(identificador) VALUES('TEST-01');
      INSERT INTO solicitudes_b2c(nombre,rut,material,kilos_estimados) VALUES('QA A','QA-A','Cartón',25),('QA B','QA-B','Papel',30);
      GRANT SELECT ON solicitudes_b2b,solicitudes_b2c,telemetria_flota TO authenticated;`);

    return db;
  } catch (error) { await db.close(); throw error; }
} };
