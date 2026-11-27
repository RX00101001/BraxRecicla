-- ====================================================================
-- ESQUEMA DE BASE DE DATOS BRAXRECICLA (Para ejecutar en Supabase)
-- ====================================================================

-- Habilitar extensión pgcrypto para generación de UUIDs y Hashes
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. TABLA PARA CIUDADANOS (B2C)
CREATE TABLE IF NOT EXISTS solicitudes_b2c (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre VARCHAR(150), -- Permitirá NULL para la Ley 21.719
    rut VARCHAR(150) NOT NULL, -- Se convertirá en Hash cuando se aplique Supresión
    direccion VARCHAR(255), -- Permitirá NULL para la Ley 21.719
    material VARCHAR(100) NOT NULL,
    kilos_estimados NUMERIC DEFAULT 0,
    kilos_reales NUMERIC DEFAULT 0,
    estado VARCHAR(50) DEFAULT 'Pendiente', -- Pendiente, En Ruta, Completado, Anonimizado (Ley 21.719)
    fecha_solicitud TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    fecha_retiro TIMESTAMP WITH TIME ZONE
);

-- Habilitar Row Level Security (RLS) para B2C
ALTER TABLE solicitudes_b2c ENABLE ROW LEVEL SECURITY;

-- 2. TABLA PARA EMPRESAS (B2B)
CREATE TABLE IF NOT EXISTS solicitudes_b2b (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rut VARCHAR(20) NOT NULL,
    razon_social VARCHAR(150) NOT NULL,
    email VARCHAR(100) NOT NULL,
    material VARCHAR(100) NOT NULL,
    volumen_toneladas NUMERIC NOT NULL,
    kilos_reales NUMERIC DEFAULT 0,
    estado VARCHAR(50) DEFAULT 'Pendiente', -- Pendiente, Aprobado, Rechazado, Certificado Emitido
    hash_certificado VARCHAR(255), -- Hash criptográfico SHA-256 para el SINADER
    fecha_solicitud TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()),
    fecha_retiro TIMESTAMP WITH TIME ZONE
);

-- Habilitar Row Level Security (RLS) para B2B
ALTER TABLE solicitudes_b2b ENABLE ROW LEVEL SECURITY;

-- 3. TABLA PARA SENSORES IOT Y FLOTA (GPS 4G + Visión Computacional opcional)
CREATE TABLE IF NOT EXISTS telemetria_flota (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patente_camion VARCHAR(15) NOT NULL,
    porcentaje_llenado_ia NUMERIC DEFAULT NULL, -- Opcional: dato enviado por la cámara IA
    bateria_pct INTEGER,                        -- Porcentaje de batería del tracker ESP32
    bateria_v NUMERIC,                          -- Voltaje de batería del tracker ESP32 (V)
    velocidad_kmh NUMERIC,                      -- Velocidad reportada por GNSS L76K
    satelites INTEGER,                          -- Cantidad de satélites GNSS enlazados
    latitud NUMERIC,
    longitud NUMERIC,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now())
);

-- Habilitar Row Level Security (RLS) para Telemetría
ALTER TABLE telemetria_flota ENABLE ROW LEVEL SECURITY;

-- ====================================================================
-- POLÍTICAS DE SEGURIDAD RLS (Reglas de acceso público vs privado)
-- ====================================================================

-- Cualquiera (incluso sin login) puede insertar una nueva solicitud (Insertar formulario B2B/B2C)
CREATE POLICY "Permitir inserts publicos b2c" ON solicitudes_b2c FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Permitir inserts publicos b2b" ON solicitudes_b2b FOR INSERT TO public WITH CHECK (true);

-- Solo usuarios autenticados (Los Administradores del ERP) pueden leer y actualizar los datos
CREATE POLICY "Permitir select admin b2c" ON solicitudes_b2c FOR SELECT TO authenticated USING (true);
CREATE POLICY "Permitir update admin b2c" ON solicitudes_b2c FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Permitir select admin b2b" ON solicitudes_b2b FOR SELECT TO authenticated USING (true);
CREATE POLICY "Permitir update admin b2b" ON solicitudes_b2b FOR UPDATE TO authenticated USING (true);

-- ====================================================================
-- FIN DEL ESQUEMA
-- ====================================================================
