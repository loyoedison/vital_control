import { z } from 'zod';

export function validarCedulaEcuador(cedula: string): boolean {
  if (!/^\d{10}$/.test(cedula)) return false;
  const provincia = Number(cedula.slice(0, 2));
  const tercerDigito = Number(cedula.slice(2, 3));
  if ((provincia < 1 || provincia > 24) && provincia !== 30) return false;
  if (tercerDigito >= 6) return false;

  const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let val = Number(cedula[i]) * coeficientes[i];
    if (val >= 10) val -= 9;
    suma += val;
  }
  const digitoVerificador = (10 - (suma % 10)) % 10;
  return digitoVerificador === Number(cedula[9]);
}

export const loginSchema = z.object({
  email: z.string().email('Correo electrónico inválido').max(180),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(128),
  totpCode: z.string().optional(),
});

export const setupAdminSchema = z.object({
  email: z.string().email('Correo electrónico inválido').max(180),
  password: z
    .string()
    .min(10, 'La contraseña inicial debe tener al menos 10 caracteres')
    .max(128)
    .regex(/[A-Z]/, 'Debe incluir al menos una mayúscula')
    .regex(/[0-9]/, 'Debe incluir al menos un número'),
  nombres: z.string().min(2, 'Ingrese los nombres').max(120),
  apellidos: z.string().min(2, 'Ingrese los apellidos').max(120),
  passcode: z.string().optional(),
});

export const createUserSchema = z.object({
  email: z.string().email('Correo inválido').max(180),
  password: z
    .string()
    .min(10, 'Mínimo 10 caracteres')
    .max(128)
    .regex(/[A-Z]/, 'Debe incluir al menos una mayúscula')
    .regex(/[0-9]/, 'Debe incluir al menos un número'),
  nombres: z.string().min(2).max(120),
  apellidos: z.string().min(2).max(120),
  roleCodigo: z.enum(['administrador', 'medico', 'enfermeria', 'consulta']),
  organizationId: z.string().uuid().optional(),
  numeroRegistroProfesional: z.string().max(60).optional().nullable(),
  especialidad: z.string().max(120).optional().nullable(),
});

export const patientSchema = z
  .object({
    tipoIdentificacion: z.enum(['cedula', 'pasaporte', 'carnet_refugio', 'otro']),
    numeroIdentificacion: z.string().trim().min(5, 'Número de documento muy corto').max(40),
    numeroHistoriaClinica: z.string().trim().min(3, 'Historia clínica requerida').max(50),
    nombres: z.string().trim().min(2, 'Nombres requeridos').max(120),
    apellidos: z.string().trim().min(2, 'Apellidos requeridos').max(120),
    fechaNacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado YYYY-MM-DD'),
    sexo: z.enum(['masculino', 'femenino', 'intersexual', 'no_especificado']),
    telefono: z.string().trim().max(30).optional().nullable(),
    direccion: z.string().trim().max(300).optional().nullable(),
    contactoEmergencia: z.string().trim().max(200).optional().nullable(),
    organizationId: z.string().uuid('Establecimiento inválido'),
    antecedenteHta: z.boolean().default(false),
    antecedenteDiabetes: z.boolean().default(false),
    embarazoActual: z.boolean().default(false),
    condicionClinicaEspecial: z.string().trim().max(120).optional().nullable(),
    otrosAntecedentes: z.string().trim().max(2000).optional().nullable(),
    observaciones: z.string().trim().max(2000).optional().nullable(),
    alergias: z.string().trim().max(1000).optional().nullable(),
    medicacionHabitual: z.string().trim().max(1000).optional().nullable(),
    antecedentesFamiliares: z.string().trim().max(1000).optional().nullable(),
    motivoCambio: z.string().trim().max(300).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.tipoIdentificacion === 'cedula' && !validarCedulaEcuador(data.numeroIdentificacion)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['numeroIdentificacion'],
        message: 'La cédula ecuatoriana ingresada no es válida',
      });
    }
    const birth = new Date(`${data.fechaNacimiento}T00:00:00Z`);
    if (Number.isNaN(birth.getTime()) || birth > new Date()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fechaNacimiento'],
        message: 'La fecha de nacimiento no puede ser futura',
      });
    }
  });

export const bpReadingSchema = z.object({
  numeroMedicion: z.number().int().min(1).max(3),
  pasMmhg: z.number().min(40, 'PAS mínima 40 mmHg').max(320, 'PAS máxima 320 mmHg'),
  padMmhg: z.number().min(20, 'PAD mínima 20 mmHg').max(220, 'PAD máxima 220 mmHg'),
  brazo: z.enum(['derecho', 'izquierdo']),
  posicion: z.enum(['sentado', 'acostado', 'de_pie']),
  tamanoManguito: z.enum(['pediatrico', 'estandar_adulto', 'adulto_grande', 'muslo']),
  tiempoReposoMin: z.number().int().min(0).max(120),
  tipoDispositivo: z.string().trim().min(2).max(60),
  lugarMedicion: z.enum(['establecimiento', 'domicilio']),
}).superRefine((val, ctx) => {
  if (val.pasMmhg <= val.padMmhg) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pasMmhg'],
      message: 'La presión sistólica debe ser mayor que la diastólica',
    });
  }
});

const optionalNullableNumber = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? null : Number(v)),
    z.number().min(min).max(max).nullable()
  );

export const vitalSignCreateSchema = z.object({
  clientSubmissionId: z.string().trim().min(6).max(100).optional(),
  patientId: z.string().uuid(),
  fechaMedicion: z.string().min(10),
  protocoloPa: z
    .enum(['promedio_todas', 'descartar_primera_si_hay_2_o_3', 'ultima_medicion'])
    .default('promedio_todas'),
  bpReadings: z.array(bpReadingSchema).max(3).default([]),
  frecuenciaCardiaca: optionalNullableNumber(20, 280),
  frecuenciaRespiratoria: optionalNullableNumber(4, 80),
  temperaturaC: optionalNullableNumber(30, 44),
  saturacionO2: optionalNullableNumber(40, 100),
  oxigenoSuplementario: z.boolean().nullable().optional().default(null),
  pesoKg: optionalNullableNumber(0.5, 400),
  tallaCm: optionalNullableNumber(30, 250),
  glucemiaMgDl: optionalNullableNumber(15, 1200),
  condicionGlucemia: z.enum(['ayuno', 'posprandial', 'aleatoria']).nullable().optional().default(null),
  escalaDolor: z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? null : Number(v)),
    z.number().int().min(0).max(10).nullable()
  ),
  sintomasReferidos: z.string().trim().max(1500).nullable().optional().default(null),
  observacionesClinicas: z.string().trim().max(2000).nullable().optional().default(null),
  conductaProfesional: z.string().trim().max(2000).nullable().optional().default(null),
  proximoControlFecha: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .default(null),
  confirmUnusualValues: z.boolean().optional().default(false),
});

export const hypertensionFollowupSchema = z.object({
  patientId: z.string().uuid(),
  fechaDiagnostico: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  antecedentesFamiliaresHta: z.boolean().default(false),
  tratamientoAntihipertensivo: z.string().trim().max(1000).nullable().optional(),
  adherenciaTratamiento: z.enum(['alta', 'media', 'baja', 'sin_tratamiento']),
  actividadFisica: z.enum(['sedentario', 'ligera', 'moderada', 'intensa']),
  consumoTabaco: z.enum(['no_fuma', 'exfumador', 'ocasional', 'diario']),
  consumoAlcohol: z.enum(['ninguno', 'ocasional', 'moderado', 'frecuente']),
  consumoSal: z.enum(['bajo', 'moderado', 'alto']),
  factoresRiesgoCv: z.array(z.string()).default([]),
  controlesDomiciliariosTexto: z.string().trim().max(1000).nullable().optional(),
  metaPasMmhg: z.number().int().min(90).max(180).nullable().optional(),
  metaPadMmhg: z.number().int().min(50).max(110).nullable().optional(),
  proximaCita: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  observaciones: z.string().trim().max(2000).nullable().optional(),
});
