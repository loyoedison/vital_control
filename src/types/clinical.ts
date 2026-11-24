export type RoleCode = 'administrador' | 'medico' | 'enfermeria' | 'consulta';
export type AlertLevel = 'verde' | 'amarillo' | 'naranja' | 'rojo' | 'gris';

export interface AuthUser {
  id: string;
  email: string;
  nombres: string;
  apellidos: string;
  role: RoleCode;
  roleNombre: string;
  permisos: string[];
  organizationIds: string[];
  mfaEnabled: boolean;
  mustChangePassword: boolean;
}

export interface Organization {
  id: string;
  codigo: string;
  nombre: string;
  tipo: string;
  ciudad: string;
  provincia: string;
  altitud_msnm: number;
  activo: boolean;
}

export interface Patient {
  id: string;
  codigoInterno: string;
  tipoIdentificacion: 'cedula' | 'pasaporte' | 'carnet_refugio' | 'otro';
  numeroIdentificacion: string;
  numeroHistoriaClinica: string;
  nombres: string;
  apellidos: string;
  fechaNacimiento: string;
  edadAnios: number;
  sexo: 'masculino' | 'femenino' | 'intersexual' | 'no_especificado';
  telefono: string | null;
  direccion: string | null;
  contactoEmergencia: string | null;
  organizationId: string;
  organizationNombre: string;
  altitudMsnm: number;
  antecedenteHta: boolean;
  antecedenteDiabetes: boolean;
  embarazoActual: boolean;
  condicionClinicaEspecial: string | null;
  otrosAntecedentes: string | null;
  observaciones: string | null;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BloodPressureReading {
  id: string;
  numero_medicion: number;
  pas_mmhg: number;
  pad_mmhg: number;
  brazo: 'derecho' | 'izquierdo';
  posicion: 'sentado' | 'acostado' | 'de_pie';
  tamano_manguito: string;
  tiempo_reposo_min: number;
  tipo_dispositivo: string;
  lugar_medicion: 'establecimiento' | 'domicilio';
  incluida_en_promedio: boolean;
}

export interface VitalSignRecord {
  id: string;
  patient_id: string;
  patient_nombres?: string;
  patient_apellidos?: string;
  codigo_interno?: string;
  numero_identificacion?: string;
  organization_id: string;
  organization_nombre?: string;
  recorded_by: string;
  recorder_nombre?: string;
  fecha_medicion: string;
  protocolo_pa: string;
  pas_promedio: number | null;
  pad_promedio: number | null;
  pam_estimada: number | null;
  presion_pulso: number | null;
  variacion_pas: number | null;
  variacion_pad: number | null;
  frecuencia_cardiaca: number | null;
  frecuencia_respiratoria: number | null;
  temperatura_c: number | null;
  saturacion_o2: number | null;
  oxigeno_suplementario: boolean | null;
  peso_kg: number | null;
  talla_cm: number | null;
  imc: number | null;
  glucemia_mg_dl: number | null;
  condicion_glucemia: string | null;
  escala_dolor: number | null;
  sintomas_referidos: string | null;
  observaciones_clinicas: string | null;
  conducta_profesional: string | null;
  proximo_control_fecha: string | null;
  nivel_alerta_global: AlertLevel;
  bpReadings?: BloodPressureReading[];
  amendments?: Array<{
    id: string;
    campo_modificado: string;
    valor_anterior: string | null;
    valor_nuevo: string;
    motivo_correccion: string;
    amended_by_nombre: string;
    created_at: string;
  }>;
}

export interface ClinicalAlertRecord {
  id: string;
  vital_sign_id: string;
  patient_id: string;
  patient_nombres?: string;
  patient_apellidos?: string;
  codigo_interno?: string;
  numero_identificacion?: string;
  parametro: string;
  valor_registrado: number | null;
  unidad: string;
  nivel: AlertLevel;
  mensaje: string;
  recomendacion: string;
  estado: 'pendiente' | 'revisada';
  revisado_por_nombre?: string | null;
  revisado_en?: string | null;
  conducta_adoptada?: string | null;
  fuente_clinica?: string | null;
  version_guia?: string | null;
  poblacion_aplicable?: string | null;
  created_at: string;
}

export interface HypertensionFollowupRecord {
  id: string;
  patient_id: string;
  patient_nombres?: string;
  patient_apellidos?: string;
  codigo_interno?: string;
  recorder_nombre?: string;
  fecha_registro: string;
  fecha_diagnostico: string | null;
  antecedentes_familiares_hta: boolean;
  tratamiento_antihipertensivo: string | null;
  adherencia_tratamiento: 'alta' | 'media' | 'baja' | 'sin_tratamiento';
  actividad_fisica: string;
  consumo_tabaco: string;
  consumo_alcohol: string;
  consumo_sal: string;
  factores_riesgo_cv: string[];
  controles_domiciliarios_texto: string | null;
  meta_pas_mmhg: number | null;
  meta_pad_mmhg: number | null;
  proxima_cita: string | null;
  observaciones: string | null;
}

export interface ClinicalRule {
  id: string;
  codigo: string;
  parametro: string;
  nombre: string;
  fuente_clinica: string;
  version_guia: string;
  poblacion_aplicable: string;
  condicion_especial: string;
  altitud_min_msnm: number | null;
  rango_verde_min: number | null;
  rango_verde_max: number | null;
  rango_amarillo_min: number | null;
  rango_amarillo_max: number | null;
  rango_naranja_min: number | null;
  rango_naranja_max: number | null;
  rango_rojo_min: number | null;
  rango_rojo_max: number | null;
  unidad: string;
  responsable_aprobacion: string;
  fecha_actualizacion: string;
  activa: boolean;
}
