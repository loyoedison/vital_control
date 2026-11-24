import { Router } from 'express';
import { dbGet, dbQuery, dbRun } from '../db/database.ts';
import {
  AuthRequest,
  canAccessPatient,
  recordAuditLog,
  requireAuth,
  requireRole,
} from '../middleware/auth.ts';

export const alertsRouter = Router();

alertsRouter.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const estado = String(req.query.estado || 'todas');
    const nivel = String(req.query.nivel || 'todos');

    const rows = await dbQuery<Record<string, unknown>>(
      `SELECT ca.*, p.nombres AS patient_nombres, p.apellidos AS patient_apellidos,
              p.codigo_interno, p.numero_identificacion,
              cr.fuente_clinica, cr.version_guia, cr.poblacion_aplicable,
              pr.nombres || ' ' || pr.apellidos AS revisado_por_nombre
       FROM clinical_alerts ca
       JOIN patients p ON p.id = ca.patient_id
       LEFT JOIN clinical_rules cr ON cr.id = ca.rule_id
       LEFT JOIN profiles pr ON pr.id = ca.revisado_por
       ORDER BY
         CASE ca.nivel WHEN 'rojo' THEN 1 WHEN 'naranja' THEN 2 WHEN 'amarillo' THEN 3 ELSE 4 END,
         ca.created_at DESC`
    );

    const visible: Record<string, unknown>[] = [];
    for (const r of rows) {
      if (!(await canAccessPatient(req.authUser!, r.patient_id as string))) continue;
      if (estado !== 'todas' && r.estado !== estado) continue;
      if (nivel !== 'todos' && r.nivel !== nivel) continue;
      visible.push(r);
    }

    res.json({ items: visible });
  } catch (err) {
    console.error('Error listando alertas clínicas:', err);
    res.status(500).json({ error: 'No se pudieron consultar las alertas clínicas.' });
  }
});

alertsRouter.patch(
  '/:id/review',
  requireAuth,
  requireRole('administrador', 'medico', 'enfermeria'),
  async (req: AuthRequest, res) => {
    try {
      const alertId = req.params.id;
      const conductaAdoptada = String(req.body?.conductaAdoptada || '').trim();
      if (conductaAdoptada.length < 4) {
        res.status(400).json({ error: 'Registre la conducta o valoración profesional adoptada.' });
        return;
      }

      const alert = await dbGet<{ id: string; patient_id: string }>(
        `SELECT id, patient_id FROM clinical_alerts WHERE id = $1`,
        [alertId]
      );
      if (!alert) {
        res.status(404).json({ error: 'Alerta no encontrada.' });
        return;
      }

      if (!(await canAccessPatient(req.authUser!, alert.patient_id))) {
        res.status(403).json({ error: 'No autorizado para revisar alertas de este paciente.' });
        return;
      }

      const now = new Date().toISOString();
      await dbRun(
        `UPDATE clinical_alerts
         SET estado = 'revisada', revisado_por = $1, revisado_en = $2, conducta_adoptada = $3
         WHERE id = $4`,
        [req.authUser!.id, now, conductaAdoptada, alertId]
      );

      await recordAuditLog({
        profileId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        accion: 'CLINICAL_ALERT_REVIEWED',
        recurso: 'clinical_alerts',
        recursoId: alertId,
        detalle: { patientId: alert.patient_id, conductaAdoptada },
        req,
      });

      res.json({ ok: true });
    } catch (err) {
      console.error('Error revisando alerta:', err);
      res.status(500).json({ error: 'No se pudo registrar la revisión de la alerta.' });
    }
  }
);
