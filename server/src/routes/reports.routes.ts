import { Router } from 'express';
import { dbQuery, toBool } from '../db/database.ts';
import {
  AuthRequest,
  canAccessPatient,
  recordAuditLog,
  requireAuth,
} from '../middleware/auth.ts';
import { calculateAgeYears, computeDescriptiveStats } from '../services/clinical.ts';

export const reportsRouter = Router();

function toGuayaquilDateKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guayaquil',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

reportsRouter.get('/dashboard/summary', requireAuth, async (req: AuthRequest, res) => {
  try {
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();
    const organizationId = String(req.query.organizationId || '').trim();
    const professionalId = String(req.query.professionalId || '').trim();
    const period = String(req.query.period || 'diario');

    const allPatients = await dbQuery<Record<string, unknown>>(
      `SELECT p.*, o.nombre AS organization_nombre
       FROM patients p JOIN organizations o ON o.id = p.organization_id`
    );

    const accessiblePatients: Record<string, unknown>[] = [];
    for (const p of allPatients) {
      if (!(await canAccessPatient(req.authUser!, p.id as string))) continue;
      if (organizationId && p.organization_id !== organizationId) continue;
      accessiblePatients.push(p);
    }
    const accessibleIds = new Set(accessiblePatients.map((p) => p.id as string));

    const allVitals = await dbQuery<Record<string, unknown>>(
      `SELECT v.*, p.nombres AS patient_nombres, p.apellidos AS patient_apellidos,
              p.codigo_interno, p.antecedente_hta, p.sexo, p.fecha_nacimiento,
              pr.nombres || ' ' || pr.apellidos AS recorder_nombre,
              o.nombre AS organization_nombre
       FROM vital_signs v
       JOIN patients p ON p.id = v.patient_id
       JOIN profiles pr ON pr.id = v.recorded_by
       JOIN organizations o ON o.id = v.organization_id
       ORDER BY v.fecha_medicion DESC`
    );

    const filteredVitals = allVitals.filter((v) => {
      if (!accessibleIds.has(v.patient_id as string)) return false;
      if (organizationId && v.organization_id !== organizationId) return false;
      if (professionalId && v.recorded_by !== professionalId) return false;
      const dKey = toGuayaquilDateKey(String(v.fecha_medicion));
      if (startDate && dKey < startDate) return false;
      if (endDate && dKey > endDate) return false;
      return true;
    });

    const todayKey = toGuayaquilDateKey(new Date().toISOString());
    const todayPatientSet = new Set(
      filteredVitals
        .filter((v) => toGuayaquilDateKey(String(v.fecha_medicion)) === todayKey)
        .map((v) => v.patient_id as string)
    );

    const alerts = await dbQuery<Record<string, unknown>>(
      `SELECT id, patient_id, nivel, estado FROM clinical_alerts WHERE estado = 'pendiente'`
    );
    const pendingAlertsCount = alerts.filter((a) => accessibleIds.has(a.patient_id as string)).length;

    const appointments = await dbQuery<Record<string, unknown>>(
      `SELECT id, patient_id FROM appointments WHERE estado = 'pendiente'`
    );
    const pendingFollowups = appointments.filter((a) => accessibleIds.has(a.patient_id as string)).length;

    const pasValues = filteredVitals
      .map((v) => (v.pas_promedio === null ? null : Number(v.pas_promedio)))
      .filter((v): v is number => v !== null);
    const padValues = filteredVitals
      .map((v) => (v.pad_promedio === null ? null : Number(v.pad_promedio)))
      .filter((v): v is number => v !== null);

    const avgPas = pasValues.length ? Number((pasValues.reduce((a, b) => a + b, 0) / pasValues.length).toFixed(1)) : null;
    const avgPad = padValues.length ? Number((padValues.reduce((a, b) => a + b, 0) / padValues.length).toFixed(1)) : null;

    // Distribución por sexo y grupo etario (por paciente único)
    const sexMap: Record<string, number> = { femenino: 0, masculino: 0, otro: 0 };
    const ageBuckets: Record<string, number> = {
      '0-17': 0,
      '18-39': 0,
      '40-59': 0,
      '60+': 0,
    };

    for (const p of accessiblePatients) {
      const s = String(p.sexo);
      if (s === 'femenino') sexMap.femenino++;
      else if (s === 'masculino') sexMap.masculino++;
      else sexMap.otro++;

      const age = calculateAgeYears(String(p.fecha_nacimiento));
      if (age < 18) ageBuckets['0-17']++;
      else if (age < 40) ageBuckets['18-39']++;
      else if (age < 60) ageBuckets['40-59']++;
      else ageBuckets['60+']++;
    }

    // Serie temporal agrupada (diaria, semanal o mensual)
    const seriesMap = new Map<string, { pas: number[]; pad: number[]; count: number }>();
    for (const v of [...filteredVitals].reverse()) {
      const dateStr = toGuayaquilDateKey(String(v.fecha_medicion));
      let bucket = dateStr;
      if (period === 'mensual') {
        bucket = dateStr.slice(0, 7);
      } else if (period === 'semanal') {
        const dt = new Date(`${dateStr}T12:00:00Z`);
        const day = dt.getUTCDay() || 7;
        dt.setUTCDate(dt.getUTCDate() - day + 1);
        bucket = `Sem ${dt.toISOString().slice(5, 10)}`;
      }
      const entry = seriesMap.get(bucket) || { pas: [], pad: [], count: 0 };
      if (v.pas_promedio !== null) entry.pas.push(Number(v.pas_promedio));
      if (v.pad_promedio !== null) entry.pad.push(Number(v.pad_promedio));
      entry.count++;
      seriesMap.set(bucket, entry);
    }

    const bpTrend = Array.from(seriesMap.entries()).map(([label, data]) => ({
      label,
      pasPromedio: data.pas.length ? Number((data.pas.reduce((a, b) => a + b, 0) / data.pas.length).toFixed(1)) : null,
      padPromedio: data.pad.length ? Number((data.pad.reduce((a, b) => a + b, 0) / data.pad.length).toFixed(1)) : null,
      controles: data.count,
    }));

    const professionals = await dbQuery<{ id: string; nombre: string }>(
      `SELECT id, nombres || ' ' || apellidos AS nombre FROM profiles WHERE activo = $1 ORDER BY apellidos`,
      [true]
    );
    const organizations = await dbQuery<{ id: string; nombre: string }>(
      `SELECT id, nombre FROM organizations WHERE activo = $1 ORDER BY nombre`,
      [true]
    );

    res.json({
      kpis: {
        totalPatients: accessiblePatients.length,
        attendedToday: todayPatientSet.size,
        totalControls: filteredVitals.length,
        hypertensivePatients: accessiblePatients.filter((p) => toBool(p.antecedente_hta)).length,
        pendingAlerts: pendingAlertsCount,
        pendingFollowups,
        avgPas,
        avgPad,
      },
      sexDistribution: [
        { name: 'Femenino', value: sexMap.femenino },
        { name: 'Masculino', value: sexMap.masculino },
        { name: 'Otro', value: sexMap.otro },
      ].filter((x) => x.value > 0),
      ageDistribution: Object.entries(ageBuckets).map(([grupo, total]) => ({ grupo, total })),
      bpTrend,
      recentControls: filteredVitals.slice(0, 8),
      filtersData: { professionals, organizations },
    });
  } catch (err) {
    console.error('Error en dashboard/summary:', err);
    res.status(500).json({ error: 'No se pudo cargar el panel principal.' });
  }
});

reportsRouter.get('/reports/generate', requireAuth, async (req: AuthRequest, res) => {
  try {
    const type = String(req.query.type || 'diario');
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();
    const patientId = String(req.query.patientId || '').trim();
    const organizationId = String(req.query.organizationId || '').trim();
    const anonymized = req.query.anonymized === 'true';

    // Permiso para exportación identificable
    const canIdentifiable = req.authUser!.permisos.includes('reports:export_identifiable');
    const effectiveAnonymized = anonymized || !canIdentifiable;

    const allPatients = await dbQuery<Record<string, unknown>>(
      `SELECT p.*, o.nombre AS organization_nombre FROM patients p JOIN organizations o ON o.id = p.organization_id`
    );
    const patientMap = new Map<string, Record<string, unknown>>();
    for (const p of allPatients) {
      if (await canAccessPatient(req.authUser!, p.id as string)) {
        if (!organizationId || p.organization_id === organizationId) {
          patientMap.set(p.id as string, p);
        }
      }
    }

    const allVitals = await dbQuery<Record<string, unknown>>(
      `SELECT v.*, pr.nombres || ' ' || pr.apellidos AS recorder_nombre, o.nombre AS organization_nombre
       FROM vital_signs v
       JOIN profiles pr ON pr.id = v.recorded_by
       JOIN organizations o ON o.id = v.organization_id
       ORDER BY v.fecha_medicion DESC`
    );

    const rows = allVitals
      .filter((v) => {
        const p = patientMap.get(v.patient_id as string);
        if (!p) return false;
        if (patientId && v.patient_id !== patientId) return false;
        const dKey = toGuayaquilDateKey(String(v.fecha_medicion));
        if (startDate && dKey < startDate) return false;
        if (endDate && dKey > endDate) return false;
        if (type === 'hipertensos' && !toBool(p.antecedente_hta)) return false;
        if (type === 'fuera_de_rango' && v.nivel_alerta_global === 'verde') return false;
        return true;
      })
      .map((v, idx) => {
        const p = patientMap.get(v.patient_id as string)!;
        const age = calculateAgeYears(String(p.fecha_nacimiento));
        return {
          id: v.id,
          pacienteCodigo: effectiveAnonymized ? `ANON-${String(idx + 1).padStart(4, '0')}` : p.codigo_interno,
          pacienteNombre: effectiveAnonymized ? 'Paciente Anonimizado' : `${p.nombres} ${p.apellidos}`,
          identificacion: effectiveAnonymized ? '***' : p.numero_identificacion,
          edadAnios: age,
          sexo: p.sexo,
          antecedenteHta: toBool(p.antecedente_hta),
          establecimiento: v.organization_nombre,
          profesional: effectiveAnonymized ? 'Personal Sanitario' : v.recorder_nombre,
          fechaMedicion: v.fecha_medicion,
          pas: v.pas_promedio === null ? null : Number(v.pas_promedio),
          pad: v.pad_promedio === null ? null : Number(v.pad_promedio),
          pam: v.pam_estimada === null ? null : Number(v.pam_estimada),
          presionPulso: v.presion_pulso === null ? null : Number(v.presion_pulso),
          fc: v.frecuencia_cardiaca === null ? null : Number(v.frecuencia_cardiaca),
          fr: v.frecuencia_respiratoria === null ? null : Number(v.frecuencia_respiratoria),
          temperatura: v.temperatura_c === null ? null : Number(v.temperatura_c),
          spo2: v.saturacion_o2 === null ? null : Number(v.saturacion_o2),
          imc: v.imc === null ? null : Number(v.imc),
          glucemia: v.glucemia_mg_dl === null ? null : Number(v.glucemia_mg_dl),
          nivelAlerta: v.nivel_alerta_global,
        };
      });

    const uniquePatientsCount = new Set(
      allVitals
        .filter((v) => patientMap.has(v.patient_id as string))
        .filter((v) => rows.some((r) => r.id === v.id))
        .map((v) => v.patient_id)
    ).size;

    const stats = {
      indicadoresPorPaciente: {
        pacientesUnicosEvaluados: uniquePatientsCount,
        pacientesConAntecedenteHta: Array.from(patientMap.values()).filter((p) => toBool(p.antecedente_hta)).length,
        porcentajeHtaEnPoblacion:
          patientMap.size > 0
            ? Number(
                (
                  (Array.from(patientMap.values()).filter((p) => toBool(p.antecedente_hta)).length /
                    patientMap.size) *
                  100
                ).toFixed(1)
              )
            : 0,
      },
      indicadoresPorMedicion: {
        totalMediciones: rows.length,
        pas: computeDescriptiveStats(rows.map((r) => r.pas).filter((n): n is number => n !== null)),
        pad: computeDescriptiveStats(rows.map((r) => r.pad).filter((n): n is number => n !== null)),
        fc: computeDescriptiveStats(rows.map((r) => r.fc).filter((n): n is number => n !== null)),
        spo2: computeDescriptiveStats(rows.map((r) => r.spo2).filter((n): n is number => n !== null)),
        imc: computeDescriptiveStats(rows.map((r) => r.imc).filter((n): n is number => n !== null)),
      },
      distribucionAlertas: ['verde', 'amarillo', 'naranja', 'rojo', 'gris'].map((lvl) => {
        const freq = rows.filter((r) => r.nivelAlerta === lvl).length;
        return {
          nivel: lvl,
          frecuenciaAbsoluta: freq,
          frecuenciaRelativa: rows.length > 0 ? Number((freq / rows.length).toFixed(3)) : 0,
          porcentaje: rows.length > 0 ? Number(((freq / rows.length) * 100).toFixed(1)) : 0,
        };
      }),
      productividadPorProfesional: Object.entries(
        rows.reduce<Record<string, number>>((acc, r) => {
          const key = String(r.profesional);
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {})
      ).map(([profesional, controles]) => ({
        profesional,
        controles,
        porcentaje: rows.length > 0 ? Number(((controles / rows.length) * 100).toFixed(1)) : 0,
      })),
    };

    res.json({
      reportType: type,
      anonymized: effectiveAnonymized,
      rows,
      stats,
    });
  } catch (err) {
    console.error('Error generando reporte:', err);
    res.status(500).json({ error: 'No se pudo generar el reporte.' });
  }
});

reportsRouter.post('/reports/audit-export', requireAuth, async (req: AuthRequest, res) => {
  const { formato, reportType, anonymized, totalRegistros } = req.body as {
    formato?: string;
    reportType?: string;
    anonymized?: boolean;
    totalRegistros?: number;
  };

  if (!anonymized && !req.authUser!.permisos.includes('reports:export_identifiable')) {
    await recordAuditLog({
      profileId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      accion: 'EXPORT_IDENTIFIABLE_DENIED',
      recurso: 'reports',
      detalle: { formato, reportType },
      req,
      resultado: 'denegado',
    });
    res.status(403).json({ error: 'Su rol solo permite exportaciones anonimizadas.' });
    return;
  }

  await recordAuditLog({
    profileId: req.authUser!.id,
    actorEmail: req.authUser!.email,
    actorRole: req.authUser!.role,
    accion: anonymized ? 'REPORT_EXPORTED_ANONYMIZED' : 'REPORT_EXPORTED_IDENTIFIABLE',
    recurso: 'reports',
    detalle: { formato, reportType, totalRegistros },
    req,
  });

  res.json({ ok: true });
});
