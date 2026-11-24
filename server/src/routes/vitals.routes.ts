import crypto from 'node:crypto';
import { Router } from 'express';
import { dbGet, dbQuery, dbRun, toBool } from '../db/database.ts';
import {
  AuthRequest,
  canAccessPatient,
  recordAuditLog,
  requireAuth,
  requireRole,
} from '../middleware/auth.ts';
import {
  calculateAgeYears,
  calculateBMI,
  calculatePAM,
  calculatePulsePressure,
  ClinicalRuleRecord,
  computeBloodPressureAverage,
  detectUnusualValues,
  evaluateVitalSignsAlerts,
} from '../services/clinical.ts';
import { vitalSignCreateSchema } from '../utils/validation.ts';

export const vitalsRouter = Router();

function mapRuleRow(r: Record<string, unknown>): ClinicalRuleRecord {
  return {
    id: r.id as string,
    codigo: r.codigo as string,
    parametro: r.parametro as ClinicalRuleRecord['parametro'],
    nombre: r.nombre as string,
    fuenteClinica: r.fuente_clinica as string,
    versionGuia: r.version_guia as string,
    poblacionAplicable: r.poblacion_aplicable as string,
    condicionEspecial: r.condicion_especial as string,
    altitudMinMsnm: r.altitud_min_msnm === null ? null : Number(r.altitud_min_msnm),
    edadMinAnios: r.edad_min_anios === null ? null : Number(r.edad_min_anios),
    edadMaxAnios: r.edad_max_anios === null ? null : Number(r.edad_max_anios),
    rangoVerdeMin: r.rango_verde_min === null ? null : Number(r.rango_verde_min),
    rangoVerdeMax: r.rango_verde_max === null ? null : Number(r.rango_verde_max),
    rangoAmarilloMin: r.rango_amarillo_min === null ? null : Number(r.rango_amarillo_min),
    rangoAmarilloMax: r.rango_amarillo_max === null ? null : Number(r.rango_amarillo_max),
    rangoNaranjaMin: r.rango_naranja_min === null ? null : Number(r.rango_naranja_min),
    rangoNaranjaMax: r.rango_naranja_max === null ? null : Number(r.rango_naranja_max),
    rangoRojoMin: r.rango_rojo_min === null ? null : Number(r.rango_rojo_min),
    rangoRojoMax: r.rango_rojo_max === null ? null : Number(r.rango_rojo_max),
    unidad: r.unidad as string,
    recomendacionAmarillo: r.recomendacion_amarillo as string,
    recomendacionNaranja: r.recomendacion_naranja as string,
    recomendacionRojo: r.recomendacion_rojo as string,
    responsableAprobacion: r.responsable_aprobacion as string,
    fechaActualizacion: String(r.fecha_actualizacion),
    activa: toBool(r.activa),
  };
}

vitalsRouter.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const patientId = String(req.query.patientId || '').trim();
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));

    const rows = await dbQuery<Record<string, unknown>>(
      `SELECT v.*, p.nombres AS patient_nombres, p.apellidos AS patient_apellidos,
              p.codigo_interno, p.numero_identificacion,
              pr.nombres || ' ' || pr.apellidos AS recorder_nombre,
              o.nombre AS organization_nombre
       FROM vital_signs v
       JOIN patients p ON p.id = v.patient_id
       JOIN profiles pr ON pr.id = v.recorded_by
       JOIN organizations o ON o.id = v.organization_id
       ${patientId ? 'WHERE v.patient_id = $1' : ''}
       ORDER BY v.fecha_medicion DESC`,
      patientId ? [patientId] : []
    );

    const filtered: Record<string, unknown>[] = [];
    for (const r of rows) {
      if (!(await canAccessPatient(req.authUser!, r.patient_id as string))) continue;
      filtered.push({
        ...r,
        oxigeno_suplementario: r.oxigeno_suplementario === null ? null : toBool(r.oxigeno_suplementario),
      });
      if (filtered.length >= limit) break;
    }

    res.json({ items: filtered });
  } catch (err) {
    console.error('Error listando signos vitales:', err);
    res.status(500).json({ error: 'No se pudieron consultar los signos vitales.' });
  }
});

vitalsRouter.post(
  '/',
  requireAuth,
  requireRole('administrador', 'medico', 'enfermeria'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = vitalSignCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Datos de signos vitales inválidos.' });
        return;
      }
      const d = parsed.data;

      if (!(await canAccessPatient(req.authUser!, d.patientId))) {
        res.status(403).json({ error: 'No tiene permisos para registrar controles a este paciente.' });
        return;
      }

      // Prevención de duplicados por doble pulsación del botón Guardar
      if (d.clientSubmissionId) {
        const existingSub = await dbGet<{ id: string }>(
          `SELECT id FROM vital_signs WHERE client_submission_id = $1`,
          [d.clientSubmissionId]
        );
        if (existingSub) {
          res.status(200).json({
            ok: true,
            duplicatePrevented: true,
            vitalSignId: existingSub.id,
            message: 'Este control ya había sido registrado previamente.',
          });
          return;
        }
      }

      const hasAnyMetric =
        d.bpReadings.length > 0 ||
        d.frecuenciaCardiaca !== null ||
        d.frecuenciaRespiratoria !== null ||
        d.temperaturaC !== null ||
        d.saturacionO2 !== null ||
        d.pesoKg !== null ||
        d.tallaCm !== null ||
        d.glucemiaMgDl !== null;

      if (!hasAnyMetric) {
        res.status(400).json({ error: 'Debe ingresar al menos una medición clínica antes de guardar.' });
        return;
      }

      const patient = await dbGet<{
        id: string;
        fecha_nacimiento: string;
        organization_id: string;
        embarazo_actual: unknown;
        condicion_clinica_especial: string | null;
        altitud_msnm: number;
      }>(
        `SELECT p.id, p.fecha_nacimiento, p.organization_id, p.embarazo_actual,
                p.condicion_clinica_especial, o.altitud_msnm
         FROM patients p
         JOIN organizations o ON o.id = p.organization_id
         WHERE p.id = $1`,
        [d.patientId]
      );
      if (!patient) {
        res.status(404).json({ error: 'Paciente no encontrado.' });
        return;
      }

      const { pasPromedio, padPromedio, includedIndexes } = computeBloodPressureAverage(
        d.bpReadings,
        d.protocoloPa
      );

      const unusualWarnings = detectUnusualValues({
        pasPromedio,
        padPromedio,
        frecuenciaCardiaca: d.frecuenciaCardiaca,
        frecuenciaRespiratoria: d.frecuenciaRespiratoria,
        temperaturaC: d.temperaturaC,
        saturacionO2: d.saturacionO2,
        pesoKg: d.pesoKg,
        tallaCm: d.tallaCm,
        glucemiaMgDl: d.glucemiaMgDl,
      });

      if (unusualWarnings.length > 0 && !d.confirmUnusualValues) {
        res.status(422).json({
          requiresConfirmation: true,
          warnings: unusualWarnings,
          error: 'Se detectaron valores inusuales. Confirme si las mediciones son correctas para continuar.',
        });
        return;
      }

      const imc = calculateBMI(d.pesoKg, d.tallaCm);
      const pam = calculatePAM(pasPromedio, padPromedio);
      const presionPulso = calculatePulsePressure(pasPromedio, padPromedio);

      const prevControl = await dbGet<{ pas_promedio: number | null; pad_promedio: number | null }>(
        `SELECT pas_promedio, pad_promedio FROM vital_signs
         WHERE patient_id = $1 AND pas_promedio IS NOT NULL AND pad_promedio IS NOT NULL
         ORDER BY fecha_medicion DESC LIMIT 1`,
        [d.patientId]
      );

      const variacionPas =
        pasPromedio !== null && prevControl?.pas_promedio !== null && prevControl?.pas_promedio !== undefined
          ? Number((pasPromedio - Number(prevControl.pas_promedio)).toFixed(1))
          : null;
      const variacionPad =
        padPromedio !== null && prevControl?.pad_promedio !== null && prevControl?.pad_promedio !== undefined
          ? Number((padPromedio - Number(prevControl.pad_promedio)).toFixed(1))
          : null;

      const ruleRows = await dbQuery<Record<string, unknown>>(`SELECT * FROM clinical_rules WHERE activa = $1`, [true]);
      const rules = ruleRows.map(mapRuleRow);

      const ageYears = calculateAgeYears(patient.fecha_nacimiento, new Date(d.fechaMedicion));
      const evaluation = evaluateVitalSignsAlerts(
        {
          pasPromedio,
          padPromedio,
          frecuenciaCardiaca: d.frecuenciaCardiaca,
          frecuenciaRespiratoria: d.frecuenciaRespiratoria,
          temperaturaC: d.temperaturaC,
          saturacionO2: d.saturacionO2,
          glucemiaMgDl: d.glucemiaMgDl,
          imc,
        },
        d.sintomasReferidos ?? null,
        {
          ageYears,
          embarazoActual: toBool(patient.embarazo_actual),
          condicionClinicaEspecial: patient.condicion_clinica_especial,
          altitudMsnm: Number(patient.altitud_msnm || 100),
        },
        rules
      );

      const vitalSignId = crypto.randomUUID();
      const now = new Date().toISOString();

      await dbRun(
        `INSERT INTO vital_signs (
          id, client_submission_id, patient_id, organization_id, recorded_by, fecha_medicion,
          protocolo_pa, pas_promedio, pad_promedio, pam_estimada, presion_pulso, variacion_pas, variacion_pad,
          frecuencia_cardiaca, frecuencia_respiratoria, temperatura_c, saturacion_o2, oxigeno_suplementario,
          peso_kg, talla_cm, imc, glucemia_mg_dl, condicion_glucemia, escala_dolor,
          sintomas_referidos, observaciones_clinicas, conducta_profesional, proximo_control_fecha,
          nivel_alerta_global, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)`,
        [
          vitalSignId,
          d.clientSubmissionId || null,
          d.patientId,
          patient.organization_id,
          req.authUser!.id,
          new Date(d.fechaMedicion).toISOString(),
          d.protocoloPa,
          pasPromedio,
          padPromedio,
          pam,
          presionPulso,
          variacionPas,
          variacionPad,
          d.frecuenciaCardiaca,
          d.frecuenciaRespiratoria,
          d.temperaturaC,
          d.saturacionO2,
          d.oxigenoSuplementario,
          d.pesoKg,
          d.tallaCm,
          imc,
          d.glucemiaMgDl,
          d.glucemiaMgDl !== null ? d.condicionGlucemia : null,
          d.escalaDolor,
          d.sintomasReferidos || null,
          d.observacionesClinicas || null,
          d.conductaProfesional || null,
          d.proximoControlFecha || null,
          evaluation.nivelGlobal,
          now,
        ]
      );

      for (const r of d.bpReadings) {
        await dbRun(
          `INSERT INTO blood_pressure_readings (
            id, vital_sign_id, numero_medicion, pas_mmhg, pad_mmhg, brazo, posicion,
            tamano_manguito, tiempo_reposo_min, tipo_dispositivo, lugar_medicion, incluida_en_promedio, measured_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [
            crypto.randomUUID(),
            vitalSignId,
            r.numeroMedicion,
            r.pasMmhg,
            r.padMmhg,
            r.brazo,
            r.posicion,
            r.tamanoManguito,
            r.tiempoReposoMin,
            r.tipoDispositivo,
            r.lugarMedicion,
            includedIndexes.includes(r.numeroMedicion),
            now,
          ]
        );
      }

      for (const alert of evaluation.alerts) {
        await dbRun(
          `INSERT INTO clinical_alerts (
            id, vital_sign_id, patient_id, rule_id, parametro, valor_registrado, unidad,
            nivel, mensaje, recomendacion, estado, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pendiente',$11)`,
          [
            crypto.randomUUID(),
            vitalSignId,
            d.patientId,
            alert.ruleId,
            alert.parametro,
            alert.valorRegistrado,
            alert.unidad,
            alert.nivel,
            alert.mensaje,
            alert.recomendacion,
            now,
          ]
        );
      }

      if (d.proximoControlFecha) {
        await dbRun(
          `INSERT INTO appointments (
            id, patient_id, organization_id, assigned_to, fecha_programada, motivo, estado, created_by, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,'pendiente',$7,$8)`,
          [
            crypto.randomUUID(),
            d.patientId,
            patient.organization_id,
            req.authUser!.id,
            d.proximoControlFecha,
            'Control programado de seguimiento de signos vitales',
            req.authUser!.id,
            now,
          ]
        );
      }

      await recordAuditLog({
        profileId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        accion: 'VITAL_SIGNS_RECORDED',
        recurso: 'vital_signs',
        recursoId: vitalSignId,
        detalle: {
          patientId: d.patientId,
          nivelGlobal: evaluation.nivelGlobal,
          alertasGeneradas: evaluation.alerts.length,
        },
        req,
      });

      res.status(201).json({
        ok: true,
        vitalSignId,
        calculated: {
          pasPromedio,
          padPromedio,
          pamEstimada: pam,
          presionPulso,
          imc,
          variacionPas,
          variacionPad,
        },
        nivelAlertaGlobal: evaluation.nivelGlobal,
        alerts: evaluation.alerts,
      });
    } catch (err) {
      console.error('Error guardando signos vitales:', err);
      res.status(500).json({ error: 'No se pudo guardar el control de signos vitales.' });
    }
  }
);

vitalsRouter.post(
  '/:id/amend',
  requireAuth,
  requireRole('administrador', 'medico'),
  async (req: AuthRequest, res) => {
    try {
      const vitalSignId = req.params.id;
      const { campoModificado, valorNuevo, motivoCorreccion } = req.body as {
        campoModificado?: string;
        valorNuevo?: string;
        motivoCorreccion?: string;
      };
      if (!campoModificado || !valorNuevo || !motivoCorreccion || motivoCorreccion.trim().length < 5) {
        res.status(400).json({ error: 'Indique el campo, nuevo valor y motivo clínico de la corrección.' });
        return;
      }

      const existing = await dbGet<Record<string, unknown>>(`SELECT * FROM vital_signs WHERE id = $1`, [vitalSignId]);
      if (!existing) {
        res.status(404).json({ error: 'Registro no encontrado.' });
        return;
      }

      if (!(await canAccessPatient(req.authUser!, existing.patient_id as string))) {
        res.status(403).json({ error: 'No autorizado.' });
        return;
      }

      const allowedColumns: Record<string, string> = {
        observaciones_clinicas: 'observaciones_clinicas',
        conducta_profesional: 'conducta_profesional',
        sintomas_referidos: 'sintomas_referidos',
      };
      const col = allowedColumns[campoModificado];
      if (!col) {
        res.status(400).json({
          error: 'Solo se permite enmendar observaciones clínicas, conducta profesional o síntomas preservando los valores numéricos originales.',
        });
        return;
      }

      const valorAnterior = existing[col] === null ? null : String(existing[col]);
      const amendmentId = crypto.randomUUID();
      const now = new Date().toISOString();

      await dbRun(
        `INSERT INTO vital_sign_amendments (id, vital_sign_id, campo_modificado, valor_anterior, valor_nuevo, motivo_correccion, amended_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [amendmentId, vitalSignId, col, valorAnterior, valorNuevo.trim(), motivoCorreccion.trim(), req.authUser!.id, now]
      );

      await recordAuditLog({
        profileId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        accion: 'VITAL_SIGN_AMENDED',
        recurso: 'vital_signs',
        recursoId: vitalSignId,
        detalle: { campoModificado: col, motivoCorreccion: motivoCorreccion.trim() },
        req,
      });

      res.status(201).json({ ok: true, amendmentId });
    } catch (err) {
      console.error('Error registrando enmienda:', err);
      res.status(500).json({ error: 'No se pudo registrar la enmienda auditada.' });
    }
  }
);
