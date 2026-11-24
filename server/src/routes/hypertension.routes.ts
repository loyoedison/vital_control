import crypto from 'node:crypto';
import { Router } from 'express';
import { dbGet, dbQuery, dbRun, parseJsonField, toBool } from '../db/database.ts';
import {
  AuthRequest,
  canAccessPatient,
  recordAuditLog,
  requireAuth,
  requireRole,
} from '../middleware/auth.ts';
import { hypertensionFollowupSchema } from '../utils/validation.ts';

export const hypertensionRouter = Router();

hypertensionRouter.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const patientId = String(req.query.patientId || '').trim();

    const followups = await dbQuery<Record<string, unknown>>(
      `SELECT hf.*, p.nombres AS patient_nombres, p.apellidos AS patient_apellidos,
              p.codigo_interno, p.numero_identificacion, p.antecedente_hta,
              pr.nombres || ' ' || pr.apellidos AS recorder_nombre
       FROM hypertension_followups hf
       JOIN patients p ON p.id = hf.patient_id
       JOIN profiles pr ON pr.id = hf.recorded_by
       ${patientId ? 'WHERE hf.patient_id = $1' : ''}
       ORDER BY hf.fecha_registro DESC`,
      patientId ? [patientId] : []
    );

    const visible: Record<string, unknown>[] = [];
    for (const f of followups) {
      if (!(await canAccessPatient(req.authUser!, f.patient_id as string))) continue;
      visible.push({
        ...f,
        antecedente_hta: toBool(f.antecedente_hta),
        antecedentes_familiares_hta: toBool(f.antecedentes_familiares_hta),
        factores_riesgo_cv: parseJsonField<string[]>(f.factores_riesgo_cv, []),
      });
    }

    res.json({ items: visible });
  } catch (err) {
    console.error('Error listando seguimiento HTA:', err);
    res.status(500).json({ error: 'No se pudo consultar el módulo de hipertensión.' });
  }
});

hypertensionRouter.post(
  '/',
  requireAuth,
  requireRole('administrador', 'medico', 'enfermeria'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = hypertensionFollowupSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Datos inválidos.' });
        return;
      }
      const d = parsed.data;

      if (!(await canAccessPatient(req.authUser!, d.patientId))) {
        res.status(403).json({ error: 'No autorizado para registrar seguimiento de este paciente.' });
        return;
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await dbRun(
        `INSERT INTO hypertension_followups (
          id, patient_id, recorded_by, fecha_registro, fecha_diagnostico, antecedentes_familiares_hta,
          tratamiento_antihipertensivo, adherencia_tratamiento, actividad_fisica, consumo_tabaco,
          consumo_alcohol, consumo_sal, factores_riesgo_cv, controles_domiciliarios_texto,
          meta_pas_mmhg, meta_pad_mmhg, proxima_cita, observaciones, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          id,
          d.patientId,
          req.authUser!.id,
          now,
          d.fechaDiagnostico || null,
          d.antecedentesFamiliaresHta,
          d.tratamientoAntihipertensivo || null,
          d.adherenciaTratamiento,
          d.actividadFisica,
          d.consumoTabaco,
          d.consumoAlcohol,
          d.consumoSal,
          JSON.stringify(d.factoresRiesgoCv),
          d.controlesDomiciliariosTexto || null,
          d.metaPasMmhg ?? null,
          d.metaPadMmhg ?? null,
          d.proximaCita || null,
          d.observaciones || null,
          now,
        ]
      );

      if (d.proximaCita) {
        const patient = await dbGet<{ organization_id: string }>(
          `SELECT organization_id FROM patients WHERE id = $1`,
          [d.patientId]
        );
        if (patient) {
          await dbRun(
            `INSERT INTO appointments (id, patient_id, organization_id, assigned_to, fecha_programada, motivo, estado, created_by, created_at)
             VALUES ($1,$2,$3,$4,$5,'Control de seguimiento de hipertensión arterial','pendiente',$6,$7)`,
            [crypto.randomUUID(), d.patientId, patient.organization_id, req.authUser!.id, d.proximaCita, req.authUser!.id, now]
          );
        }
      }

      await recordAuditLog({
        profileId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        accion: 'HYPERTENSION_FOLLOWUP_CREATED',
        recurso: 'hypertension_followups',
        recursoId: id,
        detalle: { patientId: d.patientId, metaPas: d.metaPasMmhg, metaPad: d.metaPadMmhg },
        req,
      });

      res.status(201).json({ ok: true, id });
    } catch (err) {
      console.error('Error registrando seguimiento HTA:', err);
      res.status(500).json({ error: 'No se pudo guardar el seguimiento de hipertensión.' });
    }
  }
);
