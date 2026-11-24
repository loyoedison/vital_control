import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';
import { env } from '../config/env.ts';
import { encryptSensitive } from '../utils/crypto.ts';

export type DbMode = 'postgres' | 'sqlite';

let pgPool: Pool | null = null;
let sqliteDb: DatabaseSync | null = null;
let initialized = false;

export function getDbMode(): DbMode {
  return env.databaseUrl ? 'postgres' : 'sqlite';
}

function normalizeSqlForSqlite(sql: string): string {
  return sql.replace(/\$(\d+)/g, '?');
}

function normalizeParamsForSqlite(params: unknown[]): Array<string | number | bigint | null | Uint8Array> {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (p instanceof Date) return p.toISOString();
    if (typeof p === 'object' && !(p instanceof Uint8Array)) return JSON.stringify(p);
    return p as string | number | bigint | Uint8Array;
  });
}

function getSqlite(): DatabaseSync {
  if (!sqliteDb) {
    const customPath = process.env.VITALCONTROL_DB_PATH;
    const dbPath = customPath || path.resolve(process.cwd(), '.data', 'vitalcontrol.db');
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    sqliteDb = new DatabaseSync(dbPath);
    sqliteDb.exec('PRAGMA foreign_keys = ON;');
    sqliteDb.exec('PRAGMA journal_mode = WAL;');
  }
  return sqliteDb;
}

function getPgPool(): Pool {
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: env.databaseUrl,
      ssl: env.databaseUrl.includes('supabase') ? { rejectUnauthorized: false } : undefined,
      max: 10,
      connectionTimeoutMillis: 15000,
    });
    pgPool.on('error', (err) => {
      console.error('Error inesperado en pool PostgreSQL:', err.message);
    });
  }
  return pgPool;
}

export async function dbQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  await ensureDbInitialized();
  if (getDbMode() === 'postgres') {
    const res = await getPgPool().query(sql, params);
    return res.rows as T[];
  }
  const db = getSqlite();
  const stmt = db.prepare(normalizeSqlForSqlite(sql));
  const rows = stmt.all(...normalizeParamsForSqlite(params));
  return rows as T[];
}

export async function dbGet<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await dbQuery<T>(sql, params);
  return rows[0] ?? null;
}

export async function dbRun(sql: string, params: unknown[] = []): Promise<void> {
  await ensureDbInitialized();
  if (getDbMode() === 'postgres') {
    await getPgPool().query(sql, params);
    return;
  }
  const db = getSqlite();
  const stmt = db.prepare(normalizeSqlForSqlite(sql));
  stmt.run(...normalizeParamsForSqlite(params));
}

export function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

const SQLITE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'Centro de Salud',
  ciudad TEXT NOT NULL,
  provincia TEXT NOT NULL,
  altitud_msnm INTEGER NOT NULL DEFAULT 100 CHECK (altitud_msnm >= 0 AND altitud_msnm <= 6000),
  telefono TEXT,
  direccion TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_roles (
  id TEXT PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE CHECK (codigo IN ('administrador', 'medico', 'enfermeria', 'consulta')),
  nombre TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  permisos TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL REFERENCES user_roles(id),
  email TEXT NOT NULL UNIQUE,
  nombres TEXT NOT NULL,
  apellidos TEXT NOT NULL,
  numero_registro_profesional TEXT,
  especialidad TEXT,
  password_hash TEXT NOT NULL,
  mfa_enabled INTEGER NOT NULL DEFAULT 0,
  mfa_secret_enc TEXT,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  recovery_token_hash TEXT,
  recovery_expires_at TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_members (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  es_principal INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (organization_id, profile_id)
);

CREATE TABLE IF NOT EXISTS patients (
  id TEXT PRIMARY KEY,
  codigo_interno TEXT NOT NULL UNIQUE,
  tipo_identificacion TEXT NOT NULL CHECK (tipo_identificacion IN ('cedula', 'pasaporte', 'carnet_refugio', 'otro')),
  numero_identificacion TEXT NOT NULL UNIQUE,
  numero_historia_clinica TEXT NOT NULL UNIQUE,
  nombres TEXT NOT NULL,
  apellidos TEXT NOT NULL,
  fecha_nacimiento TEXT NOT NULL,
  sexo TEXT NOT NULL CHECK (sexo IN ('masculino', 'femenino', 'intersexual', 'no_especificado')),
  telefono_enc TEXT,
  direccion_enc TEXT,
  contacto_emergencia_enc TEXT,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  antecedente_hta INTEGER NOT NULL DEFAULT 0,
  antecedente_diabetes INTEGER NOT NULL DEFAULT 0,
  embarazo_actual INTEGER NOT NULL DEFAULT 0,
  condicion_clinica_especial TEXT,
  otros_antecedentes TEXT,
  observaciones_enc TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES profiles(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS patient_assignments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tipo_acceso TEXT NOT NULL DEFAULT 'titular' CHECK (tipo_acceso IN ('titular', 'interconsulta', 'lectura')),
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (patient_id, profile_id)
);

CREATE TABLE IF NOT EXISTS medical_history (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  tipo_registro TEXT NOT NULL CHECK (tipo_registro IN ('antecedente_personal', 'antecedente_familiar', 'alergia', 'medicacion', 'diagnostico_previo', 'cambio_demografico')),
  titulo TEXT NOT NULL,
  detalle TEXT NOT NULL,
  datos_anteriores TEXT,
  datos_nuevos TEXT,
  recorded_by TEXT REFERENCES profiles(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clinical_rules (
  id TEXT PRIMARY KEY,
  codigo TEXT NOT NULL UNIQUE,
  parametro TEXT NOT NULL CHECK (parametro IN ('pas', 'pad', 'fc', 'fr', 'temperatura', 'spo2', 'glucemia', 'imc')),
  nombre TEXT NOT NULL,
  fuente_clinica TEXT NOT NULL,
  version_guia TEXT NOT NULL,
  poblacion_aplicable TEXT NOT NULL,
  condicion_especial TEXT NOT NULL DEFAULT 'general',
  altitud_min_msnm INTEGER,
  edad_min_anios INTEGER,
  edad_max_anios INTEGER,
  rango_verde_min REAL,
  rango_verde_max REAL,
  rango_amarillo_min REAL,
  rango_amarillo_max REAL,
  rango_naranja_min REAL,
  rango_naranja_max REAL,
  rango_rojo_min REAL,
  rango_rojo_max REAL,
  unidad TEXT NOT NULL,
  recomendacion_amarillo TEXT NOT NULL,
  recomendacion_naranja TEXT NOT NULL,
  recomendacion_rojo TEXT NOT NULL,
  responsable_aprobacion TEXT NOT NULL,
  fecha_actualizacion TEXT NOT NULL,
  activa INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vital_signs (
  id TEXT PRIMARY KEY,
  client_submission_id TEXT UNIQUE,
  patient_id TEXT NOT NULL REFERENCES patients(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  recorded_by TEXT NOT NULL REFERENCES profiles(id),
  fecha_medicion TEXT NOT NULL,
  protocolo_pa TEXT NOT NULL DEFAULT 'promedio_todas',
  pas_promedio REAL,
  pad_promedio REAL,
  pam_estimada REAL,
  presion_pulso REAL,
  variacion_pas REAL,
  variacion_pad REAL,
  frecuencia_cardiaca REAL,
  frecuencia_respiratoria REAL,
  temperatura_c REAL,
  saturacion_o2 REAL,
  oxigeno_suplementario INTEGER,
  peso_kg REAL,
  talla_cm REAL,
  imc REAL,
  glucemia_mg_dl REAL,
  condicion_glucemia TEXT,
  escala_dolor INTEGER,
  sintomas_referidos TEXT,
  observaciones_clinicas TEXT,
  conducta_profesional TEXT,
  proximo_control_fecha TEXT,
  nivel_alerta_global TEXT NOT NULL DEFAULT 'gris' CHECK (nivel_alerta_global IN ('verde', 'amarillo', 'naranja', 'rojo', 'gris')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS blood_pressure_readings (
  id TEXT PRIMARY KEY,
  vital_sign_id TEXT NOT NULL REFERENCES vital_signs(id) ON DELETE CASCADE,
  numero_medicion INTEGER NOT NULL CHECK (numero_medicion BETWEEN 1 AND 3),
  pas_mmhg REAL NOT NULL,
  pad_mmhg REAL NOT NULL,
  brazo TEXT NOT NULL CHECK (brazo IN ('derecho', 'izquierdo')),
  posicion TEXT NOT NULL CHECK (posicion IN ('sentado', 'acostado', 'de_pie')),
  tamano_manguito TEXT NOT NULL CHECK (tamano_manguito IN ('pediatrico', 'estandar_adulto', 'adulto_grande', 'muslo')),
  tiempo_reposo_min INTEGER NOT NULL DEFAULT 5,
  tipo_dispositivo TEXT NOT NULL,
  lugar_medicion TEXT NOT NULL CHECK (lugar_medicion IN ('establecimiento', 'domicilio')),
  incluida_en_promedio INTEGER NOT NULL DEFAULT 1,
  measured_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vital_sign_amendments (
  id TEXT PRIMARY KEY,
  vital_sign_id TEXT NOT NULL REFERENCES vital_signs(id) ON DELETE CASCADE,
  campo_modificado TEXT NOT NULL,
  valor_anterior TEXT,
  valor_nuevo TEXT NOT NULL,
  motivo_correccion TEXT NOT NULL,
  amended_by TEXT NOT NULL REFERENCES profiles(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hypertension_followups (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  recorded_by TEXT NOT NULL REFERENCES profiles(id),
  fecha_registro TEXT NOT NULL,
  fecha_diagnostico TEXT,
  antecedentes_familiares_hta INTEGER NOT NULL DEFAULT 0,
  tratamiento_antihipertensivo TEXT,
  adherencia_tratamiento TEXT NOT NULL,
  actividad_fisica TEXT NOT NULL,
  consumo_tabaco TEXT NOT NULL,
  consumo_alcohol TEXT NOT NULL,
  consumo_sal TEXT NOT NULL,
  factores_riesgo_cv TEXT NOT NULL DEFAULT '[]',
  controles_domiciliarios_texto TEXT,
  meta_pas_mmhg INTEGER,
  meta_pad_mmhg INTEGER,
  proxima_cita TEXT,
  observaciones TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clinical_alerts (
  id TEXT PRIMARY KEY,
  vital_sign_id TEXT NOT NULL REFERENCES vital_signs(id) ON DELETE CASCADE,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  rule_id TEXT REFERENCES clinical_rules(id),
  parametro TEXT NOT NULL,
  valor_registrado REAL,
  unidad TEXT NOT NULL,
  nivel TEXT NOT NULL CHECK (nivel IN ('verde', 'amarillo', 'naranja', 'rojo', 'gris')),
  mensaje TEXT NOT NULL,
  recomendacion TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'revisada')),
  revisado_por TEXT REFERENCES profiles(id),
  revisado_en TEXT,
  conducta_adoptada TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  assigned_to TEXT REFERENCES profiles(id),
  fecha_programada TEXT NOT NULL,
  motivo TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'completada', 'reprogramada', 'cancelada')),
  notas TEXT,
  created_by TEXT REFERENCES profiles(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  profile_id TEXT REFERENCES profiles(id),
  actor_email TEXT,
  actor_role TEXT,
  accion TEXT NOT NULL,
  recurso TEXT NOT NULL,
  recurso_id TEXT,
  detalle TEXT NOT NULL DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  resultado TEXT NOT NULL DEFAULT 'exitoso' CHECK (resultado IN ('exitoso', 'denegado', 'error')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  updated_by TEXT REFERENCES profiles(id),
  updated_at TEXT NOT NULL
);
`;

export function buildSyntheticCedula(prefix9: string): string {
  const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let val = Number(prefix9[i]) * coeficientes[i];
    if (val >= 10) val -= 9;
    suma += val;
  }
  const digito = (10 - (suma % 10)) % 10;
  return `${prefix9}${digito}`;
}

export async function ensureDbInitialized(): Promise<void> {
  if (initialized) return;
  initialized = true;

  if (getDbMode() === 'sqlite') {
    const db = getSqlite();
    db.exec(SQLITE_SCHEMA_SQL);
  } else {
    const migrationPath = path.resolve(process.cwd(), 'supabase', 'migrations', '0001_initial_schema.sql');
    if (fs.existsSync(migrationPath)) {
      const ddl = fs.readFileSync(migrationPath, 'utf8');
      await getPgPool().query(ddl);
    }
  }

  await seedBaseCatalogs();
}

async function rawExec(sql: string, params: unknown[] = []): Promise<void> {
  if (getDbMode() === 'postgres') {
    await getPgPool().query(sql, params);
  } else {
    const db = getSqlite();
    db.prepare(normalizeSqlForSqlite(sql)).run(...normalizeParamsForSqlite(params));
  }
}

async function rawCount(table: string): Promise<number> {
  if (getDbMode() === 'postgres') {
    const res = await getPgPool().query(`SELECT COUNT(*)::int AS c FROM ${table}`);
    return Number(res.rows[0]?.c || 0);
  }
  const row = getSqlite().prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number };
  return Number(row?.c || 0);
}

async function seedBaseCatalogs(): Promise<void> {
  const now = new Date().toISOString();

  if ((await rawCount('user_roles')) === 0) {
    const roles = [
      {
        id: '11111111-1111-4111-8111-111111111101',
        codigo: 'administrador',
        nombre: 'Administrador',
        descripcion: 'Gestión completa de usuarios, roles, establecimientos, reglas clínicas, auditoría y respaldos.',
        permisos: [
          'users:manage',
          'patients:read',
          'patients:write',
          'vitals:read',
          'vitals:write',
          'alerts:review',
          'reports:export_identifiable',
          'reports:export_anonymized',
          'rules:manage',
          'audit:read',
          'backups:manage',
          'settings:manage',
        ],
      },
      {
        id: '11111111-1111-4111-8111-111111111102',
        codigo: 'medico',
        nombre: 'Médico',
        descripcion: 'Consulta de pacientes asignados, registro de signos vitales, revisión clínica de alertas y seguimiento de HTA.',
        permisos: [
          'patients:read',
          'patients:write',
          'vitals:read',
          'vitals:write',
          'alerts:review',
          'reports:export_identifiable',
          'reports:export_anonymized',
        ],
      },
      {
        id: '11111111-1111-4111-8111-111111111103',
        codigo: 'enfermeria',
        nombre: 'Enfermería',
        descripcion: 'Registro de pacientes y toma de signos vitales dentro de su establecimiento autorizado.',
        permisos: [
          'patients:read',
          'patients:write',
          'vitals:read',
          'vitals:write',
          'alerts:review',
          'reports:export_anonymized',
        ],
      },
      {
        id: '11111111-1111-4111-8111-111111111104',
        codigo: 'consulta',
        nombre: 'Consulta',
        descripcion: 'Acceso de solo lectura a pacientes e indicadores autorizados sin capacidad de modificación.',
        permisos: ['patients:read', 'vitals:read', 'reports:export_anonymized'],
      },
    ];
    for (const r of roles) {
      await rawExec(
        `INSERT INTO user_roles (id, codigo, nombre, descripcion, permisos, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [r.id, r.codigo, r.nombre, r.descripcion, JSON.stringify(r.permisos), now]
      );
    }
  }

  if ((await rawCount('organizations')) === 0) {
    const orgs = [
      {
        id: '22222222-2222-4222-8222-222222222201',
        codigo: 'EST-UIO-01',
        nombre: 'Centro de Salud Chimbacalle',
        tipo: 'Centro de Salud Tipo C',
        ciudad: 'Quito',
        provincia: 'Pichincha',
        altitud_msnm: 2850,
        telefono: '02-265-4100',
        direccion: 'Av. Maldonado y Andrés Pérez (datos ficticios de demostración)',
      },
      {
        id: '22222222-2222-4222-8222-222222222202',
        codigo: 'EST-GYE-02',
        nombre: 'Unidad Clínica Guasmo Sur',
        tipo: 'Centro de Salud Tipo B',
        ciudad: 'Guayaquil',
        provincia: 'Guayas',
        altitud_msnm: 4,
        telefono: '04-248-9200',
        direccion: 'Av. Abdón Calderón Mz 14 (datos ficticios de demostración)',
      },
      {
        id: '22222222-2222-4222-8222-222222222203',
        codigo: 'EST-CUE-03',
        nombre: 'Clínica de Atención Primaria Yanuncay',
        tipo: 'Centro de Salud Tipo B',
        ciudad: 'Cuenca',
        provincia: 'Azuay',
        altitud_msnm: 2560,
        telefono: '07-281-3300',
        direccion: 'Av. 10 de Agosto y Loja (datos ficticios de demostración)',
      },
    ];
    for (const o of orgs) {
      await rawExec(
        `INSERT INTO organizations (id, codigo, nombre, tipo, ciudad, provincia, altitud_msnm, telefono, direccion, activo, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [o.id, o.codigo, o.nombre, o.tipo, o.ciudad, o.provincia, o.altitud_msnm, o.telefono, o.direccion, true, now, now]
      );
    }
  }

  if ((await rawCount('clinical_rules')) === 0) {
    const rules = [
      {
        id: '33333333-3333-4333-8333-333333333301',
        codigo: 'PAS-ADULTO-MSP-2024',
        parametro: 'pas',
        nombre: 'Presión Arterial Sistólica — Adulto General',
        fuente_clinica: 'MSP Ecuador / ESC-ESH 2024 Hipertensión Arterial',
        version_guia: 'v2024.1',
        poblacion_aplicable: 'Adultos (>= 18 años) no gestantes',
        condicion_especial: 'general',
        altitud_min_msnm: null,
        edad_min_anios: 18,
        edad_max_anios: 120,
        rango_verde_min: 90,
        rango_verde_max: 129,
        rango_amarillo_min: 130,
        rango_amarillo_max: 139,
        rango_naranja_min: 140,
        rango_naranja_max: 179,
        rango_rojo_min: 89,
        rango_rojo_max: 180,
        unidad: 'mmHg',
        recomendacion_amarillo: 'Repetir toma tras reposo y programar control ambulatorio o MAPA/AMPA.',
        recomendacion_naranja: 'Requiere revisión clínica prioritaria y evaluación de factores de riesgo.',
        recomendacion_rojo: 'Valoración médica inmediata conforme a protocolo de crisis/hipotensión.',
        responsable_aprobacion: 'Comité Clínico Institucional',
        fecha_actualizacion: '2026-01-15',
      },
      {
        id: '33333333-3333-4333-8333-333333333302',
        codigo: 'PAD-ADULTO-MSP-2024',
        parametro: 'pad',
        nombre: 'Presión Arterial Diastólica — Adulto General',
        fuente_clinica: 'MSP Ecuador / ESC-ESH 2024 Hipertensión Arterial',
        version_guia: 'v2024.1',
        poblacion_aplicable: 'Adultos (>= 18 años) no gestantes',
        condicion_especial: 'general',
        altitud_min_msnm: null,
        edad_min_anios: 18,
        edad_max_anios: 120,
        rango_verde_min: 60,
        rango_verde_max: 84,
        rango_amarillo_min: 85,
        rango_amarillo_max: 89,
        rango_naranja_min: 90,
        rango_naranja_max: 109,
        rango_rojo_min: 55,
        rango_rojo_max: 110,
        unidad: 'mmHg',
        recomendacion_amarillo: 'Vigilancia en controles seriados y verificación de técnica de toma.',
        recomendacion_naranja: 'Revisión prioritaria por profesional médico responsable.',
        recomendacion_rojo: 'Valoración inmediata según protocolo institucional.',
        responsable_aprobacion: 'Comité Clínico Institucional',
        fecha_actualizacion: '2026-01-15',
      },
      {
        id: '33333333-3333-4333-8333-333333333303',
        codigo: 'PAS-EMBARAZO-ACOG-2024',
        parametro: 'pas',
        nombre: 'Presión Arterial Sistólica — Gestantes',
        fuente_clinica: 'MSP Score MAMÁ / ACOG Trastornos Hipertensivos del Embarazo',
        version_guia: 'v2024.2',
        poblacion_aplicable: 'Pacientes en gestación',
        condicion_especial: 'embarazo',
        altitud_min_msnm: null,
        edad_min_anios: 12,
        edad_max_anios: 55,
        rango_verde_min: 90,
        rango_verde_max: 119,
        rango_amarillo_min: 120,
        rango_amarillo_max: 139,
        rango_naranja_min: 140,
        rango_naranja_max: 159,
        rango_rojo_min: 85,
        rango_rojo_max: 160,
        unidad: 'mmHg',
        recomendacion_amarillo: 'Seguimiento obstétrico estrecho y pesquisa de signos de alarma.',
        recomendacion_naranja: 'Valoración obstétrica prioritaria y solicitud de proteinuria/perfil.',
        recomendacion_rojo: 'Activación inmediata de protocolo obstétrico de emergencia.',
        responsable_aprobacion: 'Jefatura Obstétrica Institucional',
        fecha_actualizacion: '2026-02-01',
      },
      {
        id: '33333333-3333-4333-8333-333333333304',
        codigo: 'FC-ADULTO-OMS-2024',
        parametro: 'fc',
        nombre: 'Frecuencia Cardíaca — Adulto',
        fuente_clinica: 'Guía Clínica de Atención Primaria OMS / MSP',
        version_guia: 'v2024.1',
        poblacion_aplicable: 'Adultos (>= 18 años)',
        condicion_especial: 'general',
        altitud_min_msnm: null,
        edad_min_anios: 18,
        edad_max_anios: 120,
        rango_verde_min: 60,
        rango_verde_max: 100,
        rango_amarillo_min: 101,
        rango_amarillo_max: 115,
        rango_naranja_min: 116,
        rango_naranja_max: 130,
        rango_rojo_min: 45,
        rango_rojo_max: 131,
        unidad: 'lpm',
        recomendacion_amarillo: 'Evaluar reposo, hidratación, fiebre o ansiedad y repetir medición.',
        recomendacion_naranja: 'Valoración clínica prioritaria y descartar arritmia o descompensación.',
        recomendacion_rojo: 'Valoración médica inmediata y monitorización electrocardiográfica.',
        responsable_aprobacion: 'Comité Clínico Institucional',
        fecha_actualizacion: '2026-01-15',
      },
      {
        id: '33333333-3333-4333-8333-333333333305',
        codigo: 'SPO2-COSTA-2024',
        parametro: 'spo2',
        nombre: 'Saturación de O₂ — Baja Altitud (< 2500 msnm)',
        fuente_clinica: 'OMS Oximetría Clínica',
        version_guia: 'v2024.1',
        poblacion_aplicable: 'Población general < 2500 msnm',
        condicion_especial: 'general',
        altitud_min_msnm: null,
        edad_min_anios: 0,
        edad_max_anios: 120,
        rango_verde_min: 95,
        rango_verde_max: 100,
        rango_amarillo_min: 92,
        rango_amarillo_max: 94,
        rango_naranja_min: 89,
        rango_naranja_max: 91,
        rango_rojo_min: 40,
        rango_rojo_max: 88,
        unidad: '%',
        recomendacion_amarillo: 'Verificar perfusión digital y repetir lectura tras reposo.',
        recomendacion_naranja: 'Evaluación respiratoria prioritaria por médico de turno.',
        recomendacion_rojo: 'Valoración inmediata y evaluación de soporte de oxígeno.',
        responsable_aprobacion: 'Comité Clínico Institucional',
        fecha_actualizacion: '2026-01-15',
      },
      {
        id: '33333333-3333-4333-8333-333333333306',
        codigo: 'SPO2-ALTITUD-SIERRA-2024',
        parametro: 'spo2',
        nombre: 'Saturación de O₂ — Zona Andina (>= 2500 msnm)',
        fuente_clinica: 'Protocolo Andino de Oximetría MSP Ecuador',
        version_guia: 'v2024.1',
        poblacion_aplicable: 'Establecimientos >= 2500 msnm (Quito, Cuenca)',
        condicion_especial: 'altitud',
        altitud_min_msnm: 2500,
        edad_min_anios: 0,
        edad_max_anios: 120,
        rango_verde_min: 90,
        rango_verde_max: 100,
        rango_amarillo_min: 87,
        rango_amarillo_max: 89,
        rango_naranja_min: 84,
        rango_naranja_max: 86,
        rango_rojo_min: 40,
        rango_rojo_max: 83,
        unidad: '%',
        recomendacion_amarillo: 'Vigilar sintomatología respiratoria considerando altitud local.',
        recomendacion_naranja: 'Valoración prioritaria respiratoria y auscultación pulmonar.',
        recomendacion_rojo: 'Valoración médica inmediata por hipoxemia severa.',
        responsable_aprobacion: 'Comité Clínico Regional Sierra',
        fecha_actualizacion: '2026-01-20',
      },
      {
        id: '33333333-3333-4333-8333-333333333307',
        codigo: 'TEMP-GENERAL-2024',
        parametro: 'temperatura',
        nombre: 'Temperatura Corporal Axilar/Oral',
        fuente_clinica: 'MSP Atención Primaria',
        version_guia: 'v2024.1',
        poblacion_aplicable: 'Población general',
        condicion_especial: 'general',
        altitud_min_msnm: null,
        edad_min_anios: 0,
        edad_max_anios: 120,
        rango_verde_min: 36.0,
        rango_verde_max: 37.4,
        rango_amarillo_min: 37.5,
        rango_amarillo_max: 38.2,
        rango_naranja_min: 38.3,
        rango_naranja_max: 39.4,
        rango_rojo_min: 35.0,
        rango_rojo_max: 39.5,
        unidad: '°C',
        recomendacion_amarillo: 'Control térmico en 2 horas e hidratación oral.',
        recomendacion_naranja: 'Valoración médica prioritaria para foco infeccioso.',
        recomendacion_rojo: 'Valoración clínica inmediata por hipertermia o hipotermia.',
        responsable_aprobacion: 'Comité Clínico Institucional',
        fecha_actualizacion: '2026-01-15',
      },
      {
        id: '33333333-3333-4333-8333-333333333308',
        codigo: 'FR-ADULTO-2024',
        parametro: 'fr',
        nombre: 'Frecuencia Respiratoria — Adulto',
        fuente_clinica: 'OMS / MSP Triage Clínico',
        version_guia: 'v2024.1',
        poblacion_aplicable: 'Adultos (>= 18 años)',
        condicion_especial: 'general',
        altitud_min_msnm: null,
        edad_min_anios: 18,
        edad_max_anios: 120,
        rango_verde_min: 12,
        rango_verde_max: 20,
        rango_amarillo_min: 21,
        rango_amarillo_max: 24,
        rango_naranja_min: 25,
        rango_naranja_max: 29,
        rango_rojo_min: 10,
        rango_rojo_max: 30,
        unidad: 'rpm',
        recomendacion_amarillo: 'Vigilar mecánica ventilatoria en reposo.',
        recomendacion_naranja: 'Evaluación respiratoria prioritaria.',
        recomendacion_rojo: 'Valoración inmediata por dificultad respiratoria o bradipnea.',
        responsable_aprobacion: 'Comité Clínico Institucional',
        fecha_actualizacion: '2026-01-15',
      },
      {
        id: '33333333-3333-4333-8333-333333333309',
        codigo: 'GLUC-GENERAL-2024',
        parametro: 'glucemia',
        nombre: 'Glucemia Capilar — Referencia General',
        fuente_clinica: 'ADA 2025 / MSP Diabetes Mellitus',
        version_guia: 'v2025.1',
        poblacion_aplicable: 'Adultos',
        condicion_especial: 'general',
        altitud_min_msnm: null,
        edad_min_anios: 12,
        edad_max_anios: 120,
        rango_verde_min: 70,
        rango_verde_max: 140,
        rango_amarillo_min: 141,
        rango_amarillo_max: 199,
        rango_naranja_min: 200,
        rango_naranja_max: 299,
        rango_rojo_min: 60,
        rango_rojo_max: 300,
        unidad: 'mg/dL',
        recomendacion_amarillo: 'Verificar condición de ayuno/posprandial y programar control.',
        recomendacion_naranja: 'Revisión médica prioritaria y evaluación metabólica.',
        recomendacion_rojo: 'Valoración inmediata por hipoglucemia o hiperglucemia severa.',
        responsable_aprobacion: 'Comité Clínico Institucional',
        fecha_actualizacion: '2026-01-15',
      },
      {
        id: '33333333-3333-4333-8333-333333333310',
        codigo: 'IMC-ADULTO-OMS-2024',
        parametro: 'imc',
        nombre: 'Índice de Masa Corporal — Adultos',
        fuente_clinica: 'OMS Clasificación Nutricional',
        version_guia: 'v2024.1',
        poblacion_aplicable: 'Adultos (>= 18 años)',
        condicion_especial: 'general',
        altitud_min_msnm: null,
        edad_min_anios: 18,
        edad_max_anios: 120,
        rango_verde_min: 18.5,
        rango_verde_max: 24.99,
        rango_amarillo_min: 25.0,
        rango_amarillo_max: 29.99,
        rango_naranja_min: 30.0,
        rango_naranja_max: 39.99,
        rango_rojo_min: 15.0,
        rango_rojo_max: 40.0,
        unidad: 'kg/m²',
        recomendacion_amarillo: 'Consejería nutricional y plan de actividad física.',
        recomendacion_naranja: 'Seguimiento multidisciplinario de riesgo cardiometabólico.',
        recomendacion_rojo: 'Valoración clínica integral por obesidad grado III o desnutrición severa.',
        responsable_aprobacion: 'Comité Clínico Institucional',
        fecha_actualizacion: '2026-01-15',
      },
    ];

    for (const r of rules) {
      await rawExec(
        `INSERT INTO clinical_rules (
          id, codigo, parametro, nombre, fuente_clinica, version_guia, poblacion_aplicable,
          condicion_especial, altitud_min_msnm, edad_min_anios, edad_max_anios,
          rango_verde_min, rango_verde_max, rango_amarillo_min, rango_amarillo_max,
          rango_naranja_min, rango_naranja_max, rango_rojo_min, rango_rojo_max,
          unidad, recomendacion_amarillo, recomendacion_naranja, recomendacion_rojo,
          responsable_aprobacion, fecha_actualizacion, activa, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
        [
          r.id,
          r.codigo,
          r.parametro,
          r.nombre,
          r.fuente_clinica,
          r.version_guia,
          r.poblacion_aplicable,
          r.condicion_especial,
          r.altitud_min_msnm,
          r.edad_min_anios,
          r.edad_max_anios,
          r.rango_verde_min,
          r.rango_verde_max,
          r.rango_amarillo_min,
          r.rango_amarillo_max,
          r.rango_naranja_min,
          r.rango_naranja_max,
          r.rango_rojo_min,
          r.rango_rojo_max,
          r.unidad,
          r.recomendacion_amarillo,
          r.recomendacion_naranja,
          r.recomendacion_rojo,
          r.responsable_aprobacion,
          r.fecha_actualizacion,
          true,
          now,
        ]
      );
    }
  }

  if ((await rawCount('system_settings')) === 0) {
    const settings = [
      ['zona_horaria', 'America/Guayaquil', 'Zona horaria institucional oficial'],
      ['formato_fecha', 'DD/MM/AAAA', 'Formato estándar de fecha clínica'],
      ['sesion_inactividad_min', String(env.sessionIdleMinutes), 'Minutos de inactividad antes del cierre automático de sesión'],
      ['retencion_auditoria_dias', '1825', 'Política de conservación de bitácoras clínicas (5 años, LOPDP)'],
      ['protocolo_pa_predeterminado', 'descartar_primera_si_hay_2_o_3', 'Protocolo por defecto para promediado de presión arterial'],
    ];
    for (const [clave, valor, descripcion] of settings) {
      await rawExec(
        `INSERT INTO system_settings (clave, valor, descripcion, updated_at) VALUES ($1, $2, $3, $4)`,
        [clave, valor, descripcion, now]
      );
    }
  }
}

// Datos ficticios sintéticos poblados tras el alta inicial del administrador
export async function seedSyntheticClinicalData(adminProfileId: string): Promise<void> {
  if ((await rawCount('patients')) > 0) return;

  const now = new Date();
  const isoNow = now.toISOString();
  const orgQuito = '22222222-2222-4222-8222-222222222201';
  const orgGye = '22222222-2222-4222-8222-222222222202';
  const orgCuenca = '22222222-2222-4222-8222-222222222203';

  const samplePatients = [
    {
      id: '44444444-4444-4444-8444-444444444401',
      codigo_interno: 'VC-2026-0001',
      cedula: buildSyntheticCedula('171003406'),
      hc: 'HC-UIO-00101',
      nombres: 'María Fernanda',
      apellidos: 'Quintero Paredes',
      fecha_nacimiento: '1962-04-18',
      sexo: 'femenino',
      org: orgQuito,
      hta: true,
      dm: true,
      embarazo: false,
      condicion: null,
      otros: 'Hipertensión arterial crónica diagnosticada en 2019 · Dislipidemia controlada',
      obs: 'Paciente ficticia en seguimiento regular de riesgo cardiovascular.',
    },
    {
      id: '44444444-4444-4444-8444-444444444402',
      codigo_interno: 'VC-2026-0002',
      cedula: buildSyntheticCedula('091542318'),
      hc: 'HC-GYE-00204',
      nombres: 'Carlos Alberto',
      apellidos: 'Mendoza Cevallos',
      fecha_nacimiento: '1957-09-12',
      sexo: 'masculino',
      org: orgGye,
      hta: true,
      dm: false,
      embarazo: false,
      condicion: null,
      otros: 'Hipertensión arterial estadio II · Antecedente familiar de cardiopatía isquémica',
      obs: 'Paciente ficticio con monitoreo domiciliario semanal.',
    },
    {
      id: '44444444-4444-4444-8444-444444444403',
      codigo_interno: 'VC-2026-0003',
      cedula: buildSyntheticCedula('010421875'),
      hc: 'HC-CUE-00315',
      nombres: 'Lucía Valeria',
      apellidos: 'Andrade Ordóñez',
      fecha_nacimiento: '1993-11-05',
      sexo: 'femenino',
      org: orgCuenca,
      hta: false,
      dm: false,
      embarazo: true,
      condicion: null,
      otros: 'Gestación de 28 semanas · Control prenatal periódico',
      obs: 'Paciente ficticia para seguimiento obstétrico preventivo.',
    },
    {
      id: '44444444-4444-4444-8444-444444444404',
      codigo_interno: 'VC-2026-0004',
      cedula: buildSyntheticCedula('172298451'),
      hc: 'HC-UIO-00118',
      nombres: 'Jorge Enrique',
      apellidos: 'Salazar Villacís',
      fecha_nacimiento: '1975-02-23',
      sexo: 'masculino',
      org: orgQuito,
      hta: true,
      dm: false,
      embarazo: false,
      condicion: null,
      otros: 'Hipertensión arterial controlada con IECA · Sobrepeso leve',
      obs: 'Paciente ficticio activo en programa de crónicos.',
    },
    {
      id: '44444444-4444-4444-8444-444444444405',
      codigo_interno: 'VC-2026-0005',
      cedula: buildSyntheticCedula('092187342'),
      hc: 'HC-GYE-00249',
      nombres: 'Elena Beatriz',
      apellidos: 'Zambrano Mora',
      fecha_nacimiento: '1984-07-30',
      sexo: 'femenino',
      org: orgGye,
      hta: false,
      dm: true,
      embarazo: false,
      condicion: null,
      otros: 'Diabetes mellitus tipo 2 en control ambulatorio',
      obs: 'Paciente ficticia sin antecedentes hipertensivos.',
    },
  ];

  for (const p of samplePatients) {
    await rawExec(
      `INSERT INTO patients (
        id, codigo_interno, tipo_identificacion, numero_identificacion, numero_historia_clinica,
        nombres, apellidos, fecha_nacimiento, sexo, telefono_enc, direccion_enc, contacto_emergencia_enc,
        organization_id, antecedente_hta, antecedente_diabetes, embarazo_actual, condicion_clinica_especial,
        otros_antecedentes, observaciones_enc, activo, created_by, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        p.id,
        p.codigo_interno,
        'cedula',
        p.cedula,
        p.hc,
        p.nombres,
        p.apellidos,
        p.fecha_nacimiento,
        p.sexo,
        encryptSensitive('0990001122'),
        encryptSensitive('Sector de referencia ficticio'),
        encryptSensitive('Familiar de referencia - 0990003344'),
        p.org,
        p.hta,
        p.dm,
        p.embarazo,
        p.condicion,
        p.otros,
        encryptSensitive(p.obs),
        true,
        adminProfileId,
        isoNow,
        isoNow,
      ]
    );

    await rawExec(
      `INSERT INTO patient_assignments (id, patient_id, profile_id, tipo_acceso, activo, created_at)
       VALUES ($1, $2, $3, 'titular', $4, $5)`,
      [crypto.randomUUID(), p.id, adminProfileId, true, isoNow]
    );

    if (p.hta) {
      await rawExec(
        `INSERT INTO hypertension_followups (
          id, patient_id, recorded_by, fecha_registro, fecha_diagnostico, antecedentes_familiares_hta,
          tratamiento_antihipertensivo, adherencia_tratamiento, actividad_fisica, consumo_tabaco,
          consumo_alcohol, consumo_sal, factores_riesgo_cv, controles_domiciliarios_texto,
          meta_pas_mmhg, meta_pad_mmhg, proxima_cita, observaciones, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          crypto.randomUUID(),
          p.id,
          adminProfileId,
          isoNow,
          '2021-05-10',
          true,
          'Losartán 50 mg VO cada 12h (registro demostrativo)',
          p.id.endsWith('02') ? 'media' : 'alta',
          'moderada',
          'no_fuma',
          'ninguno',
          'moderado',
          JSON.stringify(['Edad > 55 años', p.dm ? 'Diabetes mellitus' : 'Dislipidemia']),
          'Promedio domiciliario semanal 132/82 mmHg',
          130,
          80,
          new Date(now.getTime() + 14 * 86400000).toISOString().slice(0, 10),
          'Seguimiento programado de adherencia y automonitoreo.',
          isoNow,
        ]
      );
    }
  }

  // Registros históricos ficticios de signos vitales en los últimos 14 días + hoy
  const controls = [
    {
      patientId: samplePatients[0].id,
      orgId: orgQuito,
      daysAgo: 12,
      pas1: 146,
      pad1: 92,
      pas2: 142,
      pad2: 88,
      fc: 78,
      fr: 17,
      temp: 36.5,
      spo2: 94,
      peso: 68.5,
      talla: 158,
      gluc: 126,
      nivel: 'naranja',
      sintomas: 'Cefalea occipital leve',
      conducta: 'Refuerzo de adherencia y control en 1 semana.',
    },
    {
      patientId: samplePatients[0].id,
      orgId: orgQuito,
      daysAgo: 0,
      pas1: 132,
      pad1: 84,
      pas2: 128,
      pad2: 80,
      fc: 74,
      fr: 16,
      temp: 36.6,
      spo2: 95,
      peso: 68.0,
      talla: 158,
      gluc: 112,
      nivel: 'verde',
      sintomas: 'Asintomática',
      conducta: 'Continuar esquema vigente y actividad física regular.',
    },
    {
      patientId: samplePatients[1].id,
      orgId: orgGye,
      daysAgo: 6,
      pas1: 164,
      pad1: 98,
      pas2: 160,
      pad2: 96,
      fc: 88,
      fr: 20,
      temp: 36.7,
      spo2: 97,
      peso: 84.0,
      talla: 172,
      gluc: 104,
      nivel: 'naranja',
      sintomas: 'Mareo ocasional al levantarse',
      conducta: 'Valoración prioritaria por medicina interna.',
    },
    {
      patientId: samplePatients[1].id,
      orgId: orgGye,
      daysAgo: 0,
      pas1: 184,
      pad1: 112,
      pas2: 182,
      pad2: 110,
      fc: 104,
      fr: 22,
      temp: 36.8,
      spo2: 96,
      peso: 84.2,
      talla: 172,
      gluc: 108,
      nivel: 'rojo',
      sintomas: 'Cefalea intensa y palpitaciones',
      conducta: 'Derivación inmediata a valoración médica prioritaria en establecimiento.',
    },
    {
      patientId: samplePatients[2].id,
      orgId: orgCuenca,
      daysAgo: 1,
      pas1: 124,
      pad1: 78,
      pas2: 122,
      pad2: 76,
      fc: 82,
      fr: 18,
      temp: 36.4,
      spo2: 93,
      peso: 64.5,
      talla: 162,
      gluc: 92,
      nivel: 'amarillo',
      sintomas: 'Sin síntomas de alarma obstétrica',
      conducta: 'Vigilancia en control prenatal semanal.',
    },
    {
      patientId: samplePatients[3].id,
      orgId: orgQuito,
      daysAgo: 2,
      pas1: 126,
      pad1: 80,
      pas2: 122,
      pad2: 78,
      fc: 70,
      fr: 16,
      temp: 36.5,
      spo2: 94,
      peso: 76.0,
      talla: 170,
      gluc: 98,
      nivel: 'verde',
      sintomas: 'Asintomático',
      conducta: 'Control trimestral programado.',
    },
    {
      patientId: samplePatients[4].id,
      orgId: orgGye,
      daysAgo: 0,
      pas1: 118,
      pad1: 74,
      pas2: 116,
      pad2: 72,
      fc: 76,
      fr: 16,
      temp: 36.6,
      spo2: 98,
      peso: 66.0,
      talla: 160,
      gluc: 158,
      nivel: 'amarillo',
      sintomas: 'Sed leve posprandial',
      conducta: 'Revisión de registro glucémico en consulta.',
    },
  ];

  for (const c of controls) {
    const vsId = crypto.randomUUID();
    const fechaMed = new Date(now.getTime() - c.daysAgo * 86400000).toISOString();
    const pasAvg = Number(((c.pas1 + c.pas2) / 2).toFixed(1));
    const padAvg = Number(((c.pad1 + c.pad2) / 2).toFixed(1));
    const pam = Number(((pasAvg + 2 * padAvg) / 3).toFixed(1));
    const pp = Number((pasAvg - padAvg).toFixed(1));
    const imc = Number((c.peso / ((c.talla / 100) ** 2)).toFixed(2));

    await rawExec(
      `INSERT INTO vital_signs (
        id, patient_id, organization_id, recorded_by, fecha_medicion, protocolo_pa,
        pas_promedio, pad_promedio, pam_estimada, presion_pulso, variacion_pas, variacion_pad,
        frecuencia_cardiaca, frecuencia_respiratoria, temperatura_c, saturacion_o2, oxigeno_suplementario,
        peso_kg, talla_cm, imc, glucemia_mg_dl, condicion_glucemia, escala_dolor,
        sintomas_referidos, observaciones_clinicas, conducta_profesional, nivel_alerta_global, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`,
      [
        vsId,
        c.patientId,
        c.orgId,
        adminProfileId,
        fechaMed,
        'promedio_todas',
        pasAvg,
        padAvg,
        pam,
        pp,
        null,
        null,
        c.fc,
        c.fr,
        c.temp,
        c.spo2,
        false,
        c.peso,
        c.talla,
        imc,
        c.gluc,
        'posprandial',
        c.nivel === 'rojo' ? 6 : 1,
        c.sintomas,
        'Registro demostrativo de control ambulatorio.',
        c.conducta,
        c.nivel,
        fechaMed,
      ]
    );

    await rawExec(
      `INSERT INTO blood_pressure_readings (
        id, vital_sign_id, numero_medicion, pas_mmhg, pad_mmhg, brazo, posicion,
        tamano_manguito, tiempo_reposo_min, tipo_dispositivo, lugar_medicion, incluida_en_promedio, measured_at
      ) VALUES ($1,$2,1,$3,$4,'izquierdo','sentado','estandar_adulto',5,'Oscilométrico validado','establecimiento',$5,$6)`,
      [crypto.randomUUID(), vsId, c.pas1, c.pad1, true, fechaMed]
    );

    await rawExec(
      `INSERT INTO blood_pressure_readings (
        id, vital_sign_id, numero_medicion, pas_mmhg, pad_mmhg, brazo, posicion,
        tamano_manguito, tiempo_reposo_min, tipo_dispositivo, lugar_medicion, incluida_en_promedio, measured_at
      ) VALUES ($1,$2,2,$3,$4,'izquierdo','sentado','estandar_adulto',5,'Oscilométrico validado','establecimiento',$5,$6)`,
      [crypto.randomUUID(), vsId, c.pas2, c.pad2, true, fechaMed]
    );

    if (c.nivel !== 'verde') {
      await rawExec(
        `INSERT INTO clinical_alerts (
          id, vital_sign_id, patient_id, rule_id, parametro, valor_registrado, unidad,
          nivel, mensaje, recomendacion, estado, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          crypto.randomUUID(),
          vsId,
          c.patientId,
          c.nivel === 'amarillo' && c.gluc > 140
            ? '33333333-3333-4333-8333-333333333309'
            : '33333333-3333-4333-8333-333333333301',
          c.nivel === 'amarillo' && c.gluc > 140 ? 'glucemia' : 'pas',
          c.nivel === 'amarillo' && c.gluc > 140 ? c.gluc : pasAvg,
          c.nivel === 'amarillo' && c.gluc > 140 ? 'mg/dL' : 'mmHg',
          c.nivel,
          c.nivel === 'amarillo' && c.gluc > 140
            ? `Glucemia capilar en ${c.gluc} mg/dL fuera de rango meta.`
            : `Presión arterial sistólica promedio en ${pasAvg} mmHg.`,
          `${c.conducta} Herramienta de apoyo clínico: requiere valoración profesional.`,
          c.daysAgo > 3 ? 'revisada' : 'pendiente',
          fechaMed,
        ]
      );
    }
  }

  // Próximo control programado
  await rawExec(
    `INSERT INTO appointments (id, patient_id, organization_id, assigned_to, fecha_programada, motivo, estado, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,'pendiente',$7,$8)`,
    [
      crypto.randomUUID(),
      samplePatients[1].id,
      orgGye,
      adminProfileId,
      new Date(now.getTime() + 2 * 86400000).toISOString().slice(0, 10),
      'Control prioritario de presión arterial e historial de adherencia',
      adminProfileId,
      isoNow,
    ]
  );
}
