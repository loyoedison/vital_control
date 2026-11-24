-- VitalControl - Migración inicial versionada para Supabase (PostgreSQL)
-- Zona horaria recomendada: America/Guayaquil
-- Cumplimiento de trazabilidad clínica e integridad referencial

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Establecimientos de salud
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo VARCHAR(40) NOT NULL UNIQUE,
  nombre VARCHAR(180) NOT NULL,
  tipo VARCHAR(80) NOT NULL DEFAULT 'Centro de Salud',
  ciudad VARCHAR(100) NOT NULL,
  provincia VARCHAR(100) NOT NULL,
  altitud_msnm INTEGER NOT NULL DEFAULT 100 CHECK (altitud_msnm >= 0 AND altitud_msnm <= 6000),
  telefono VARCHAR(30),
  direccion TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Roles y permisos del sistema
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo VARCHAR(40) NOT NULL UNIQUE CHECK (codigo IN ('administrador', 'medico', 'enfermeria', 'consulta')),
  nombre VARCHAR(80) NOT NULL,
  descripcion TEXT NOT NULL,
  permisos JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Perfiles de usuarios (compatible con Supabase Auth o autenticación institucional)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES user_roles(id),
  email VARCHAR(180) NOT NULL UNIQUE,
  nombres VARCHAR(120) NOT NULL,
  apellidos VARCHAR(120) NOT NULL,
  numero_registro_profesional VARCHAR(60),
  especialidad VARCHAR(120),
  password_hash TEXT NOT NULL,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret_enc TEXT,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  recovery_token_hash TEXT,
  recovery_expires_at TIMESTAMPTZ,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Miembros autorizados por establecimiento
CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  es_principal BOOLEAN NOT NULL DEFAULT FALSE,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, profile_id)
);

-- 5. Pacientes
CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_interno VARCHAR(30) NOT NULL UNIQUE,
  tipo_identificacion VARCHAR(30) NOT NULL CHECK (tipo_identificacion IN ('cedula', 'pasaporte', 'carnet_refugio', 'otro')),
  numero_identificacion VARCHAR(40) NOT NULL UNIQUE,
  numero_historia_clinica VARCHAR(50) NOT NULL UNIQUE,
  nombres VARCHAR(120) NOT NULL,
  apellidos VARCHAR(120) NOT NULL,
  fecha_nacimiento DATE NOT NULL,
  sexo VARCHAR(20) NOT NULL CHECK (sexo IN ('masculino', 'femenino', 'intersexual', 'no_especificado')),
  telefono_enc TEXT,
  direccion_enc TEXT,
  contacto_emergencia_enc TEXT,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  antecedente_hta BOOLEAN NOT NULL DEFAULT FALSE,
  antecedente_diabetes BOOLEAN NOT NULL DEFAULT FALSE,
  embarazo_actual BOOLEAN NOT NULL DEFAULT FALSE,
  condicion_clinica_especial VARCHAR(120),
  otros_antecedentes TEXT,
  observaciones_enc TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Asignaciones de acceso a pacientes por profesional
CREATE TABLE IF NOT EXISTS patient_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tipo_acceso VARCHAR(30) NOT NULL DEFAULT 'titular' CHECK (tipo_acceso IN ('titular', 'interconsulta', 'lectura')),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (patient_id, profile_id)
);

-- 7. Antecedentes clínicos y cambios demográficos
CREATE TABLE IF NOT EXISTS medical_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tipo_registro VARCHAR(40) NOT NULL CHECK (tipo_registro IN ('antecedente_personal', 'antecedente_familiar', 'alergia', 'medicacion', 'diagnostico_previo', 'cambio_demografico')),
  titulo VARCHAR(160) NOT NULL,
  detalle TEXT NOT NULL,
  datos_anteriores JSONB,
  datos_nuevos JSONB,
  recorded_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Reglas clínicas configurables y versionadas
CREATE TABLE IF NOT EXISTS clinical_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo VARCHAR(60) NOT NULL UNIQUE,
  parametro VARCHAR(50) NOT NULL CHECK (parametro IN ('pas', 'pad', 'fc', 'fr', 'temperatura', 'spo2', 'glucemia', 'imc')),
  nombre VARCHAR(160) NOT NULL,
  fuente_clinica VARCHAR(200) NOT NULL,
  version_guia VARCHAR(60) NOT NULL,
  poblacion_aplicable VARCHAR(160) NOT NULL,
  condicion_especial VARCHAR(80) NOT NULL DEFAULT 'general',
  altitud_min_msnm INTEGER,
  edad_min_anios INTEGER,
  edad_max_anios INTEGER,
  rango_verde_min NUMERIC(8,2),
  rango_verde_max NUMERIC(8,2),
  rango_amarillo_min NUMERIC(8,2),
  rango_amarillo_max NUMERIC(8,2),
  rango_naranja_min NUMERIC(8,2),
  rango_naranja_max NUMERIC(8,2),
  rango_rojo_min NUMERIC(8,2),
  rango_rojo_max NUMERIC(8,2),
  unidad VARCHAR(20) NOT NULL,
  recomendacion_amarillo TEXT NOT NULL,
  recomendacion_naranja TEXT NOT NULL,
  recomendacion_rojo TEXT NOT NULL,
  responsable_aprobacion VARCHAR(160) NOT NULL,
  fecha_actualizacion DATE NOT NULL,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Registros de signos vitales (campos no medidos se almacenan como NULL)
CREATE TABLE IF NOT EXISTS vital_signs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_submission_id VARCHAR(100) UNIQUE,
  patient_id UUID NOT NULL REFERENCES patients(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  recorded_by UUID NOT NULL REFERENCES profiles(id),
  fecha_medicion TIMESTAMPTZ NOT NULL,
  protocolo_pa VARCHAR(60) NOT NULL DEFAULT 'promedio_todas',
  pas_promedio NUMERIC(6,2) CHECK (pas_promedio IS NULL OR (pas_promedio >= 40 AND pas_promedio <= 320)),
  pad_promedio NUMERIC(6,2) CHECK (pad_promedio IS NULL OR (pad_promedio >= 20 AND pad_promedio <= 220)),
  pam_estimada NUMERIC(6,2),
  presion_pulso NUMERIC(6,2),
  variacion_pas NUMERIC(6,2),
  variacion_pad NUMERIC(6,2),
  frecuencia_cardiaca NUMERIC(6,2) CHECK (frecuencia_cardiaca IS NULL OR (frecuencia_cardiaca >= 20 AND frecuencia_cardiaca <= 280)),
  frecuencia_respiratoria NUMERIC(6,2) CHECK (frecuencia_respiratoria IS NULL OR (frecuencia_respiratoria >= 4 AND frecuencia_respiratoria <= 80)),
  temperatura_c NUMERIC(5,2) CHECK (temperatura_c IS NULL OR (temperatura_c >= 30 AND temperatura_c <= 44)),
  saturacion_o2 NUMERIC(5,2) CHECK (saturacion_o2 IS NULL OR (saturacion_o2 >= 40 AND saturacion_o2 <= 100)),
  oxigeno_suplementario BOOLEAN,
  peso_kg NUMERIC(6,2) CHECK (peso_kg IS NULL OR (peso_kg >= 0.5 AND peso_kg <= 400)),
  talla_cm NUMERIC(6,2) CHECK (talla_cm IS NULL OR (talla_cm >= 30 AND talla_cm <= 250)),
  imc NUMERIC(5,2),
  glucemia_mg_dl NUMERIC(6,2) CHECK (glucemia_mg_dl IS NULL OR (glucemia_mg_dl >= 15 AND glucemia_mg_dl <= 1200)),
  condicion_glucemia VARCHAR(30) CHECK (condicion_glucemia IS NULL OR condicion_glucemia IN ('ayuno', 'posprandial', 'aleatoria')),
  escala_dolor INTEGER CHECK (escala_dolor IS NULL OR (escala_dolor >= 0 AND escala_dolor <= 10)),
  sintomas_referidos TEXT,
  observaciones_clinicas TEXT,
  conducta_profesional TEXT,
  proximo_control_fecha DATE,
  nivel_alerta_global VARCHAR(20) NOT NULL DEFAULT 'gris' CHECK (nivel_alerta_global IN ('verde', 'amarillo', 'naranja', 'rojo', 'gris')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. Mediciones individuales de presión arterial (conserva lecturas originales 1, 2, 3)
CREATE TABLE IF NOT EXISTS blood_pressure_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vital_sign_id UUID NOT NULL REFERENCES vital_signs(id) ON DELETE CASCADE,
  numero_medicion INTEGER NOT NULL CHECK (numero_medicion BETWEEN 1 AND 3),
  pas_mmhg NUMERIC(6,2) NOT NULL CHECK (pas_mmhg >= 40 AND pas_mmhg <= 320),
  pad_mmhg NUMERIC(6,2) NOT NULL CHECK (pad_mmhg >= 20 AND pad_mmhg <= 220),
  brazo VARCHAR(20) NOT NULL CHECK (brazo IN ('derecho', 'izquierdo')),
  posicion VARCHAR(20) NOT NULL CHECK (posicion IN ('sentado', 'acostado', 'de_pie')),
  tamano_manguito VARCHAR(30) NOT NULL CHECK (tamano_manguito IN ('pediatrico', 'estandar_adulto', 'adulto_grande', 'muslo')),
  tiempo_reposo_min INTEGER NOT NULL DEFAULT 5 CHECK (tiempo_reposo_min >= 0 AND tiempo_reposo_min <= 120),
  tipo_dispositivo VARCHAR(60) NOT NULL,
  lugar_medicion VARCHAR(30) NOT NULL CHECK (lugar_medicion IN ('establecimiento', 'domicilio')),
  incluida_en_promedio BOOLEAN NOT NULL DEFAULT TRUE,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 11. Enmiendas auditadas de signos vitales (sin sobrescribir el registro original)
CREATE TABLE IF NOT EXISTS vital_sign_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vital_sign_id UUID NOT NULL REFERENCES vital_signs(id) ON DELETE CASCADE,
  campo_modificado VARCHAR(80) NOT NULL,
  valor_anterior TEXT,
  valor_nuevo TEXT NOT NULL,
  motivo_correccion TEXT NOT NULL,
  amended_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. Seguimiento específico de hipertensión arterial
CREATE TABLE IF NOT EXISTS hypertension_followups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  recorded_by UUID NOT NULL REFERENCES profiles(id),
  fecha_registro TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fecha_diagnostico DATE,
  antecedentes_familiares_hta BOOLEAN NOT NULL DEFAULT FALSE,
  tratamiento_antihipertensivo TEXT,
  adherencia_tratamiento VARCHAR(30) NOT NULL CHECK (adherencia_tratamiento IN ('alta', 'media', 'baja', 'sin_tratamiento')),
  actividad_fisica VARCHAR(30) NOT NULL CHECK (actividad_fisica IN ('sedentario', 'ligera', 'moderada', 'intensa')),
  consumo_tabaco VARCHAR(30) NOT NULL CHECK (consumo_tabaco IN ('no_fuma', 'exfumador', 'ocasional', 'diario')),
  consumo_alcohol VARCHAR(30) NOT NULL CHECK (consumo_alcohol IN ('ninguno', 'ocasional', 'moderado', 'frecuente')),
  consumo_sal VARCHAR(30) NOT NULL CHECK (consumo_sal IN ('bajo', 'moderado', 'alto')),
  factores_riesgo_cv JSONB NOT NULL DEFAULT '[]'::jsonb,
  controles_domiciliarios_texto TEXT,
  meta_pas_mmhg INTEGER CHECK (meta_pas_mmhg IS NULL OR (meta_pas_mmhg >= 90 AND meta_pas_mmhg <= 180)),
  meta_pad_mmhg INTEGER CHECK (meta_pad_mmhg IS NULL OR (meta_pad_mmhg >= 50 AND meta_pad_mmhg <= 110)),
  proxima_cita DATE,
  observaciones TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 13. Alertas clínicas generadas
CREATE TABLE IF NOT EXISTS clinical_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vital_sign_id UUID NOT NULL REFERENCES vital_signs(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES clinical_rules(id),
  parametro VARCHAR(50) NOT NULL,
  valor_registrado NUMERIC(8,2),
  unidad VARCHAR(20) NOT NULL,
  nivel VARCHAR(20) NOT NULL CHECK (nivel IN ('verde', 'amarillo', 'naranja', 'rojo', 'gris')),
  mensaje TEXT NOT NULL,
  recomendacion TEXT NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'revisada')),
  revisado_por UUID REFERENCES profiles(id),
  revisado_en TIMESTAMPTZ,
  conducta_adoptada TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 14. Próximos controles / citas
CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  assigned_to UUID REFERENCES profiles(id),
  fecha_programada DATE NOT NULL,
  motivo VARCHAR(200) NOT NULL,
  estado VARCHAR(30) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'completada', 'reprogramada', 'cancelada')),
  notas TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. Auditoría de operaciones y seguridad
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES profiles(id),
  actor_email VARCHAR(180),
  actor_role VARCHAR(40),
  accion VARCHAR(80) NOT NULL,
  recurso VARCHAR(80) NOT NULL,
  recurso_id VARCHAR(100),
  detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address VARCHAR(80),
  user_agent TEXT,
  resultado VARCHAR(30) NOT NULL DEFAULT 'exitoso' CHECK (resultado IN ('exitoso', 'denegado', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 16. Configuración del sistema
CREATE TABLE IF NOT EXISTS system_settings (
  clave VARCHAR(80) PRIMARY KEY,
  valor TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  updated_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para optimización de búsquedas y reportes
CREATE INDEX IF NOT EXISTS idx_patients_org ON patients(organization_id);
CREATE INDEX IF NOT EXISTS idx_patients_identificacion ON patients(numero_identificacion);
CREATE INDEX IF NOT EXISTS idx_patients_hc ON patients(numero_historia_clinica);
CREATE INDEX IF NOT EXISTS idx_patients_apellidos ON patients(apellidos, nombres);
CREATE INDEX IF NOT EXISTS idx_vitals_patient_fecha ON vital_signs(patient_id, fecha_medicion DESC);
CREATE INDEX IF NOT EXISTS idx_vitals_org_fecha ON vital_signs(organization_id, fecha_medicion DESC);
CREATE INDEX IF NOT EXISTS idx_vitals_recorded_by ON vital_signs(recorded_by);
CREATE INDEX IF NOT EXISTS idx_bp_readings_vital ON blood_pressure_readings(vital_sign_id);
CREATE INDEX IF NOT EXISTS idx_alerts_estado_nivel ON clinical_alerts(estado, nivel, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_patient ON clinical_alerts(patient_id);
CREATE INDEX IF NOT EXISTS idx_hta_patient_fecha ON hypertension_followups(patient_id, fecha_registro DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_fecha ON appointments(fecha_programada, estado);
CREATE INDEX IF NOT EXISTS idx_audit_fecha_accion ON audit_logs(created_at DESC, accion);
