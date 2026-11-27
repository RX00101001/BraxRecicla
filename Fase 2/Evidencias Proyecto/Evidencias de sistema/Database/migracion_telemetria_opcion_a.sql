-- ====================================================================
-- MIGRACIÓN OPCIÓN A: TELEMETRÍA GPS + BATERÍA REAL EN telemetria_flota
-- Mantiene porcentaje_llenado_ia opcional (NULL) para compatibilidad
-- con camara_ia.py y agrega columnas reales del tracker ESP32 + L76K.
-- ====================================================================

ALTER TABLE public.telemetria_flota
  ALTER COLUMN porcentaje_llenado_ia DROP NOT NULL,
  ALTER COLUMN porcentaje_llenado_ia SET DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bateria_pct INTEGER,
  ADD COLUMN IF NOT EXISTS bateria_v NUMERIC,
  ADD COLUMN IF NOT EXISTS velocidad_kmh NUMERIC,
  ADD COLUMN IF NOT EXISTS satelites INTEGER;
