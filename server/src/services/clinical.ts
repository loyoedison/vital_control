export type AlertLevel = 'verde' | 'amarillo' | 'naranja' | 'rojo' | 'gris';

export interface BpReadingInput {
  numeroMedicion: number;
  pasMmhg: number;
  padMmhg: number;
  brazo: string;
  posicion: string;
  tamanoManguito: string;
  tiempoReposoMin: number;
  tipoDispositivo: string;
  lugarMedicion: string;
}

export interface ClinicalRuleRecord {
  id: string;
  codigo: string;
  parametro: 'pas' | 'pad' | 'fc' | 'fr' | 'temperatura' | 'spo2' | 'glucemia' | 'imc';
  nombre: string;
  fuenteClinica: string;
  versionGuia: string;
  poblacionAplicable: string;
  condicionEspecial: string;
  altitudMinMsnm: number | null;
  edadMinAnios: number | null;
  edadMaxAnios: number | null;
  rangoVerdeMin: number | null;
  rangoVerdeMax: number | null;
  rangoAmarilloMin: number | null;
  rangoAmarilloMax: number | null;
  rangoNaranjaMin: number | null;
  rangoNaranjaMax: number | null;
  rangoRojoMin: number | null;
  rangoRojoMax: number | null;
  unidad: string;
  recomendacionAmarillo: string;
  recomendacionNaranja: string;
  recomendacionRojo: string;
  responsableAprobacion: string;
  fechaActualizacion: string;
  activa: boolean;
}

export function calculateAgeYears(fechaNacimiento: string, refDate = new Date()): number {
  const birth = new Date(`${fechaNacimiento.slice(0, 10)}T12:00:00Z`);
  let age = refDate.getUTCFullYear() - birth.getUTCFullYear();
  const monthDiff = refDate.getUTCMonth() - birth.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && refDate.getUTCDate() < birth.getUTCDate())) {
    age--;
  }
  return Math.max(0, age);
}

export function calculateBMI(pesoKg: number | null, tallaCm: number | null): number | null {
  if (pesoKg === null || tallaCm === null || pesoKg <= 0 || tallaCm <= 0) return null;
  const tallaM = tallaCm / 100;
  return Number((pesoKg / (tallaM * tallaM)).toFixed(2));
}

export function calculatePAM(pas: number | null, pad: number | null): number | null {
  if (pas === null || pad === null || pas <= 0 || pad <= 0) return null;
  return Number(((pas + 2 * pad) / 3).toFixed(1));
}

export function calculatePulsePressure(pas: number | null, pad: number | null): number | null {
  if (pas === null || pad === null) return null;
  return Number((pas - pad).toFixed(1));
}

export function computeBloodPressureAverage(
  readings: BpReadingInput[],
  protocolo: 'promedio_todas' | 'descartar_primera_si_hay_2_o_3' | 'ultima_medicion'
): {
  pasPromedio: number | null;
  padPromedio: number | null;
  includedIndexes: number[];
} {
  if (!readings || readings.length === 0) {
    return { pasPromedio: null, padPromedio: null, includedIndexes: [] };
  }

  const sorted = [...readings].sort((a, b) => a.numeroMedicion - b.numeroMedicion);
  let includedIndexes: number[] = [];

  if (protocolo === 'ultima_medicion') {
    includedIndexes = [sorted[sorted.length - 1].numeroMedicion];
  } else if (protocolo === 'descartar_primera_si_hay_2_o_3' && sorted.length >= 2) {
    includedIndexes = sorted.slice(1).map((r) => r.numeroMedicion);
  } else {
    includedIndexes = sorted.map((r) => r.numeroMedicion);
  }

  const selected = sorted.filter((r) => includedIndexes.includes(r.numeroMedicion));
  const pasAvg = selected.reduce((acc, r) => acc + r.pasMmhg, 0) / selected.length;
  const padAvg = selected.reduce((acc, r) => acc + r.padMmhg, 0) / selected.length;

  return {
    pasPromedio: Number(pasAvg.toFixed(1)),
    padPromedio: Number(padAvg.toFixed(1)),
    includedIndexes,
  };
}

export function detectUnusualValues(input: {
  pasPromedio: number | null;
  padPromedio: number | null;
  frecuenciaCardiaca: number | null;
  frecuenciaRespiratoria: number | null;
  temperaturaC: number | null;
  saturacionO2: number | null;
  pesoKg: number | null;
  tallaCm: number | null;
  glucemiaMgDl: number | null;
}): string[] {
  const warnings: string[] = [];
  if (input.pasPromedio !== null && (input.pasPromedio < 70 || input.pasPromedio > 210)) {
    warnings.push(`Presión sistólica inusual (${input.pasPromedio} mmHg)`);
  }
  if (input.padPromedio !== null && (input.padPromedio < 40 || input.padPromedio > 130)) {
    warnings.push(`Presión diastólica inusual (${input.padPromedio} mmHg)`);
  }
  if (input.frecuenciaCardiaca !== null && (input.frecuenciaCardiaca < 40 || input.frecuenciaCardiaca > 160)) {
    warnings.push(`Frecuencia cardíaca inusual (${input.frecuenciaCardiaca} lpm)`);
  }
  if (input.frecuenciaRespiratoria !== null && (input.frecuenciaRespiratoria < 8 || input.frecuenciaRespiratoria > 36)) {
    warnings.push(`Frecuencia respiratoria inusual (${input.frecuenciaRespiratoria} rpm)`);
  }
  if (input.temperaturaC !== null && (input.temperaturaC < 34.5 || input.temperaturaC > 41)) {
    warnings.push(`Temperatura corporal inusual (${input.temperaturaC} °C)`);
  }
  if (input.saturacionO2 !== null && input.saturacionO2 < 85) {
    warnings.push(`Saturación de O2 críticamente baja (${input.saturacionO2} %)`);
  }
  if (input.glucemiaMgDl !== null && (input.glucemiaMgDl < 45 || input.glucemiaMgDl > 450)) {
    warnings.push(`Glucemia capilar inusual (${input.glucemiaMgDl} mg/dL)`);
  }
  return warnings;
}

const LEVEL_PRIORITY: Record<AlertLevel, number> = {
  gris: 0,
  verde: 1,
  amarillo: 2,
  naranja: 3,
  rojo: 4,
};

function selectRuleForPatient(
  rules: ClinicalRuleRecord[],
  parametro: ClinicalRuleRecord['parametro'],
  context: {
    ageYears: number;
    embarazoActual: boolean;
    condicionClinicaEspecial: string | null;
    altitudMsnm: number;
  }
): ClinicalRuleRecord | null {
  const active = rules.filter((r) => r.activa && r.parametro === parametro);
  if (active.length === 0) return null;

  // Prioridad clínica: embarazo > condición especial > pediátrico > altitud > general
  const scored = active
    .filter((r) => {
      if (r.edadMinAnios !== null && context.ageYears < r.edadMinAnios) return false;
      if (r.edadMaxAnios !== null && context.ageYears > r.edadMaxAnios) return false;
      if (r.altitudMinMsnm !== null && context.altitudMsnm < r.altitudMinMsnm) return false;
      if (r.condicionEspecial === 'embarazo' && !context.embarazoActual) return false;
      if (
        r.condicionEspecial !== 'general' &&
        r.condicionEspecial !== 'embarazo' &&
        r.condicionEspecial !== 'pediatrico' &&
        r.condicionEspecial !== 'altitud' &&
        context.condicionClinicaEspecial?.toLowerCase() !== r.condicionEspecial.toLowerCase()
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const rank = (c: string) =>
        c === 'embarazo' ? 5 : c === 'epoc' ? 4 : c === 'pediatrico' ? 3 : c === 'altitud' ? 2 : 1;
      return rank(b.condicionEspecial) - rank(a.condicionEspecial);
    });

  return scored[0] || active.find((r) => r.condicionEspecial === 'general') || active[0];
}

function classifyWithRule(value: number | null, rule: ClinicalRuleRecord): AlertLevel {
  if (value === null || value === undefined) return 'gris';

  // Para SpO2, menor es más severo (por debajo del rango)
  if (rule.parametro === 'spo2') {
    if (rule.rangoRojoMax !== null && value <= rule.rangoRojoMax) return 'rojo';
    if (rule.rangoNaranjaMax !== null && value <= rule.rangoNaranjaMax) return 'naranja';
    if (rule.rangoAmarilloMax !== null && value <= rule.rangoAmarilloMax) return 'amarillo';
    if (rule.rangoVerdeMin !== null && value >= rule.rangoVerdeMin) return 'verde';
    return 'amarillo';
  }

  // Para parámetros bidireccionales (PAS, PAD, FC, FR, Temp, Glucemia, IMC)
  const inRange = (min: number | null, max: number | null) => {
    if (min === null && max === null) return false;
    const minOk = min === null || value >= min;
    const maxOk = max === null || value <= max;
    return minOk && maxOk;
  };

  if (inRange(rule.rangoVerdeMin, rule.rangoVerdeMax)) return 'verde';
  if (inRange(rule.rangoAmarilloMin, rule.rangoAmarilloMax)) return 'amarillo';
  if (inRange(rule.rangoNaranjaMin, rule.rangoNaranjaMax)) return 'naranja';

  // Fuera de rango rojo superior o inferior crítico
  if (
    (rule.rangoRojoMax !== null && value >= rule.rangoRojoMax) ||
    (rule.rangoRojoMin !== null && value <= rule.rangoRojoMin)
  ) {
    return 'rojo';
  }
  return 'naranja';
}

export interface GeneratedAlertItem {
  ruleId: string | null;
  parametro: string;
  valorRegistrado: number;
  unidad: string;
  nivel: AlertLevel;
  mensaje: string;
  recomendacion: string;
}

export function evaluateVitalSignsAlerts(
  metrics: {
    pasPromedio: number | null;
    padPromedio: number | null;
    frecuenciaCardiaca: number | null;
    frecuenciaRespiratoria: number | null;
    temperaturaC: number | null;
    saturacionO2: number | null;
    glucemiaMgDl: number | null;
    imc: number | null;
  },
  sintomasReferidos: string | null,
  patientContext: {
    ageYears: number;
    embarazoActual: boolean;
    condicionClinicaEspecial: string | null;
    altitudMsnm: number;
  },
  rules: ClinicalRuleRecord[]
): {
  nivelGlobal: AlertLevel;
  alerts: GeneratedAlertItem[];
} {
  const paramMap: Array<{ key: keyof typeof metrics; param: ClinicalRuleRecord['parametro']; label: string }> = [
    { key: 'pasPromedio', param: 'pas', label: 'Presión arterial sistólica' },
    { key: 'padPromedio', param: 'pad', label: 'Presión arterial diastólica' },
    { key: 'frecuenciaCardiaca', param: 'fc', label: 'Frecuencia cardíaca' },
    { key: 'frecuenciaRespiratoria', param: 'fr', label: 'Frecuencia respiratoria' },
    { key: 'temperaturaC', param: 'temperatura', label: 'Temperatura corporal' },
    { key: 'saturacionO2', param: 'spo2', label: 'Saturación de O₂' },
    { key: 'glucemiaMgDl', param: 'glucemia', label: 'Glucemia capilar' },
    { key: 'imc', param: 'imc', label: 'Índice de masa corporal' },
  ];

  const alerts: GeneratedAlertItem[] = [];
  let maxLevel: AlertLevel = 'gris';

  const hasAlarmSymptoms = Boolean(
    sintomasReferidos &&
      /(dolor tor|disnea|cefalea intensa|visi[oó]n borrosa|s[ií]ncope|convulsi|mareo severo|confusi[oó]n)/i.test(
        sintomasReferidos
      )
  );

  for (const item of paramMap) {
    const val = metrics[item.key];
    if (val === null || val === undefined) continue;
    const rule = selectRuleForPatient(rules, item.param, patientContext);
    if (!rule) continue;

    let nivel = classifyWithRule(val, rule);

    // Si hay síntomas neurológicos/cardiovasculares de alarma junto con PA alterada, elevar vigilancia prioritaria
    if (hasAlarmSymptoms && (item.param === 'pas' || item.param === 'pad') && nivel === 'amarillo') {
      nivel = 'naranja';
    } else if (hasAlarmSymptoms && (item.param === 'pas' || item.param === 'pad') && nivel === 'naranja') {
      nivel = 'rojo';
    }

    if (LEVEL_PRIORITY[nivel] > LEVEL_PRIORITY[maxLevel]) {
      maxLevel = nivel;
    }

    if (nivel !== 'verde' && nivel !== 'gris') {
      const recomendacionBase =
        nivel === 'rojo'
          ? rule.recomendacionRojo
          : nivel === 'naranja'
            ? rule.recomendacionNaranja
            : rule.recomendacionAmarillo;

      alerts.push({
        ruleId: rule.id,
        parametro: item.param,
        valorRegistrado: val,
        unidad: rule.unidad,
        nivel,
        mensaje: `${item.label} en ${val} ${rule.unidad} (${rule.nombre} · ${rule.versionGuia}).`,
        recomendacion: `${recomendacionBase} Herramienta de apoyo clínico: no establece diagnóstico ni prescripción automática; requiere valoración profesional.`,
      });
    }
  }

  return { nivelGlobal: maxLevel, alerts };
}

export function computeDescriptiveStats(values: number[]) {
  if (values.length === 0) {
    return { count: 0, mean: null, median: null, stdDev: null, min: null, max: null };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / count;
  const mid = Math.floor(count / 2);
  const median = count % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / count;
  const stdDev = Math.sqrt(variance);
  return {
    count,
    mean: Number(mean.toFixed(2)),
    median: Number(median.toFixed(2)),
    stdDev: Number(stdDev.toFixed(2)),
    min: Number(sorted[0].toFixed(2)),
    max: Number(sorted[count - 1].toFixed(2)),
  };
}
