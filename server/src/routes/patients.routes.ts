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
import { calculateAgeYears } from '../services/clinical.ts';
import { decryptSensitive, encryptSensitive } from '../utils/crypto.ts';
import { patientSchema } from '../utils/validation.ts';

export const patientsRouter = Router();

function formatPatientRow(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    codigoInterno: row.codigo_interno as string,
    tipoIdentificacion: row.tipo_identificacion as string,
    numeroIdentificacion: row.numero_identificacion as string,
    numeroHistoriaClinica: row.numero_historia_clinica as string,
    nombres: row.nombres as string,
    apellidos: row.apellidos as string,
    fechaNacimiento: String(row.fecha_nacimiento).slice(0, 10),
    edadAnios: calculateAgeYears(String(row.fecha_nacimiento)),
    sexo: row.sexo as string,
    telefono: decryptSensitive(row.telefono_enc as string | null),
    direccion: decryptSensitive(row.direccion_enc as string | null),
    contactoEmergencia: decryptSensitive(row.contacto_emergencia_enc as string | null),
    organizationId: row.organization_id as string,
    organizationNombre: (row.organization_nombre as string) || '',
    altitudMsnm: Number(row.altitud_msnm || 100),
    antecedenteHta: toBool(row.antecedente_hta),
    antecedenteDiabetes: toBool(row.antecedente_diabetes),
    embarazoActual: toBool(row.embarazo_actual),
    condicionClinicaEspecial: (row.condicion_clinica_especial as string | null) ?? null,
    otrosAntecedentes: (row.otros_antecedentes as string | null) ?? null,
    observaciones: decryptSensitive(row.observaciones_enc as string | null),
    activo: toBool(row.activo),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

patientsRouter.get('/', requireAuth, async (req: AuthRequest, res) => {
  try {
    const search = String(req.query.search || '').trim().toLowerCase();
    const organizationId = String(req.query.organizationId || '').trim();
    const status = String(req.query.status || 'todos');
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize || 15)));

    const rows = await dbQuery<Record<string, unknown>>(
      `SELECT p.*, o.nombre AS organization_nombre, o.altitud_msnm
       FROM patients p
       JOIN organizations o ON o.id = p.organization_id
       ORDER BY p.created_at DESC`
    );

    const accessible: ReturnType<typeof formatPatientRow>[] = [];
    for (const row of rows) {
      const allowed = await canAccessPatient(req.authUser!, row.id as string);
      if (!allowed) continue;
      const formatted = formatPatientRow(row);
      if (organizationId && formatted.organizationId !== organizationId) continue;
      if (status === 'activos' && !formatted.activo) continue;
      if (status === 'inactivos' && formatted.activo) continue;
      if (search) {
        const haystack =
          `${formatted.nombres} ${formatted.apellidos} ${formatted.numeroIdentificacion} ${formatted.numeroHistoriaClinica} ${formatted.codigoInterno}`.toLowerCase();
        if (!haystack.includes(search)) continue;
      }
      accessible.push(formatted);
    }

    const total = accessible.length;
    const start = (page - 1) * pageSize;
    const items = accessible.slice(start, start + pageSize);

    res.json({
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (err) {
    console.error('Error listando pacientes:', err);
    res.status(500).json({ error: 'No se pudo obtener la lista de pacientes.' });
  }
});

patientsRouter.post(
  '/',
  requireAuth,
  requireRole('administrador', 'medico', 'enfermeria'),
  async (req: AuthRequest, res) => {
    try {
      const parsed = patientSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Datos del paciente inválidos.' });
        return;
      }
      const d = parsed.data;

      if (req.authUser!.role !== 'administrador' && !req.authUser!.organizationIds.includes(d.organizationId)) {
        res.status(403).json({ error: 'No está autorizado para registrar pacientes en ese establecimiento.' });
        return;
      }

      const dupId = await dbGet<{ id: string }>(
        `SELECT id FROM patients WHERE numero_identificacion = $1 OR numero_historia_clinica = $2`,
        [d.numeroIdentificacion, d.numeroHistoriaClinica]
      );
      if (dupId) {
        res.status(409).json({
          error: 'Ya existe un paciente registrado con ese número de identificación o historia clínica.',
        });
        return;
      }

      const countRow = await dbGet<{ c: number }>(`SELECT COUNT(*) AS c FROM patients`);
      const nextNum = Number(countRow?.c || 0) + 1;
      const year = new Date().getFullYear();
      const codigoInterno = `VC-${year}-${String(nextNum).padStart(4, '0')}`;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      await dbRun(
        `INSERT INTO patients (
          id, codigo_interno, tipo_identificacion, numero_identificacion, numero_historia_clinica,
          nombres, apellidos, fecha_nacimiento, sexo, telefono_enc, direccion_enc, contacto_emergencia_enc,
          organization_id, antecedente_hta, antecedente_diabetes, embarazo_actual, condicion_clinica_especial,
          otros_antecedentes, observaciones_enc, activo, created_by, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
        [
          id,
          codigoInterno,
          d.tipoIdentificacion,
          d.numeroIdentificacion,
          d.numeroHistoriaClinica,
          d.nombres,
          d.apellidos,
          d.fechaNacimiento,
          d.sexo,
          encryptSensitive(d.telefono),
          encryptSensitive(d.direccion),
          encryptSensitive(d.contactoEmergencia),
          d.organizationId,
          d.antecedenteHta,
          d.antecedenteDiabetes,
          d.embarazoActual,
          d.condicionClinicaEspecial || null,
          d.otrosAntecedentes || null,
          encryptSensitive(d.observaciones),
          true,
          req.authUser!.id,
          now,
          now,
        ]
      );

      // Registrar antecedentes estructurados si se proveyeron
      const historyItems: Array<{ tipo: string; titulo: string; detalle: string | null | undefined }> = [
        { tipo: 'alergia', titulo: 'Alergias referidas', detalle: d.alergias },
        { tipo: 'medicacion', titulo: 'Medicación habitual', detalle: d.medicacionHabitual },
        { tipo: 'antecedente_familiar', titulo: 'Antecedentes familiares', detalle: d.antecedentesFamiliares },
      ];
      for (const h of historyItems) {
        if (h.detalle && h.detalle.trim()) {
          await dbRun(
            `INSERT INTO medical_history (id, patient_id, tipo_registro, titulo, detalle, recorded_by, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [crypto.randomUUID(), id, h.tipo, h.titulo, h.detalle.trim(), req.authUser!.id, now]
          );
        }
      }

      await dbRun(
        `INSERT INTO patient_assignments (id, patient_id, profile_id, tipo_acceso, activo, created_at)
         VALUES ($1,$2,$3,'titular',$4,$5)`,
        [crypto.randomUUID(), id, req.authUser!.id, true, now]
      );

      await recordAuditLog({
        profileId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        accion: 'PATIENT_CREATED',
        recurso: 'patients',
        recursoId: id,
        detalle: { codigoInterno, organizationId: d.organizationId },
        req,
      });

      const created = await dbGet<Record<string, unknown>>(
        `SELECT p.*, o.nombre AS organization_nombre, o.altitud_msnm
         FROM patients p JOIN organizations o ON o.id = p.organization_id WHERE p.id = $1`,
        [id]
      );
      res.status(201).json({ patient: created ? formatPatientRow(created) : null });
    } catch (err) {
      console.error('Error creando paciente:', err);
      res.status(500).json({ error: 'No se pudo registrar el paciente.' });
    }
  }
);

patientsRouter.get('/:id', requireAuth, async (req: AuthRequest, res) => {
  try {
    const patientId = req.params.id;
    const allowed = await canAccessPatient(req.authUser!, patientId);
    if (!allowed) {
      res.status(403).json({ error: 'No tiene acceso a la ficha clínica de este paciente.' });
      return;
    }

    const row = await dbGet<Record<string, unknown>>(
      `SELECT p.*, o.nombre AS organization_nombre, o.altitud_msnm
       FROM patients p JOIN organizations o ON o.id = p.organization_id WHERE p.id = $1`,
      [patientId]
    );
    if (!row) {
      res.status(404).json({ error: 'Paciente no encontrado.' });
      return;
    }

    const history = await dbQuery<Record<string, unknown>>(
      `SELECT mh.*, pr.nombres || ' ' || pr.apellidos AS recorder_nombre
       FROM medical_history mh
       LEFT JOIN profiles pr ON pr.id = mh.recorded_by
       WHERE mh.patient_id = $1
       ORDER BY mh.created_at DESC`,
      [patientId]
    );

    const vitals = await dbQuery<Record<string, unknown>>(
      `SELECT v.*, pr.nombres || ' ' || pr.apellidos AS recorder_nombre, o.nombre AS organization_nombre
       FROM vital_signs v
       JOIN profiles pr ON pr.id = v.recorded_by
       JOIN organizations o ON o.id = v.organization_id
       WHERE v.patient_id = $1
       ORDER BY v.fecha_medicion DESC`,
      [patientId]
    );

    const vitalsWithReadings = await Promise.all(
      vitals.map(async (v) => {
        const bpReadings = await dbQuery<Record<string, unknown>>(
          `SELECT * FROM blood_pressure_readings WHERE vital_sign_id = $1 ORDER BY numero_medicion ASC`,
          [v.id]
        );
        const amendments = await dbQuery<Record<string, unknown>>(
          `SELECT a.*, pr.nombres || ' ' || pr.apellidos AS amended_by_nombre
           FROM vital_sign_amendments a
           JOIN profiles pr ON pr.id = a.amended_by
           WHERE a.vital_sign_id = $1 ORDER BY a.created_at DESC`,
          [v.id]
        );
        return {
          ...v,
          oxigeno_suplementario: v.oxigeno_suplementario === null ? null : toBool(v.oxigeno_suplementario),
          bpReadings: bpReadings.map((b) => ({
            ...b,
            incluida_en_promedio: toBool(b.incluida_en_promedio),
          })),
          amendments,
        };
      })
    );

    const alerts = await dbQuery<Record<string, unknown>>(
      `SELECT ca.*, cr.fuente_clinica, cr.version_guia, pr.nombres || ' ' || pr.apellidos AS revisado_por_nombre
       FROM clinical_alerts ca
       LEFT JOIN clinical_rules cr ON cr.id = ca.rule_id
       LEFT JOIN profiles pr ON pr.id = ca.revisado_por
       WHERE ca.patient_id = $1
       ORDER BY ca.created_at DESC`,
      [patientId]
    );

    const followups = await dbQuery<Record<string, unknown>>(
      `SELECT hf.*, pr.nombres || ' ' || pr.apellidos AS recorder_nombre
       FROM hypertension_followups hf
       JOIN profiles pr ON pr.id = hf.recorded_by
       WHERE hf.patient_id = $1
       ORDER BY hf.fecha_registro DESC`,
      [patientId]
    );

    const appointments = await dbQuery<Record<string, unknown>>(
      `SELECT * FROM appointments WHERE patient_id = $1 ORDER BY fecha_programada ASC`,
      [patientId]
    );

    await recordAuditLog({
      profileId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      accion: 'PATIENT_RECORD_VIEWED',
      recurso: 'patients',
      recursoId: patientId,
      req,
    });

    res.json({
      patient: formatPatientRow(row),
      medicalHistory: history.map((h) => ({
        ...h,
        datos_anteriores: parseJsonField(h.datos_anteriores, null),
        datos_nuevos: parseJsonField(h.datos_nuevos, null),
      })),
      vitalSigns: vitalsWithReadings,
      alerts,
      hypertensionFollowups: followups.map((f) => ({
        ...f,
        antecedentes_familiares_hta: toBool(f.antecedentes_familiares_hta),
        factores_riesgo_cv: parseJsonField<string[]>(f.factores_riesgo_cv, []),
      })),
      appointments,
    });
  } catch (err) {
    console.error('Error consultando ficha clínica:', err);
    res.status(500).json({ error: 'No se pudo cargar la ficha clínica.' });
  }
});

patientsRouter.put(
  '/:id',
  requireAuth,
  requireRole('administrador', 'medico', 'enfermeria'),
  async (req: AuthRequest, res) => {
    try {
      const patientId = req.params.id;
      if (!(await canAccessPatient(req.authUser!, patientId))) {
        res.status(403).json({ error: 'No autorizado para editar este paciente.' });
        return;
      }

      const existing = await dbGet<Record<string, unknown>>(`SELECT * FROM patients WHERE id = $1`, [patientId]);
      if (!existing) {
        res.status(404).json({ error: 'Paciente no encontrado.' });
        return;
      }

      const parsed = patientSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message || 'Datos inválidos.' });
        return;
      }
      const d = parsed.data;

      const dup = await dbGet<{ id: string }>(
        `SELECT id FROM patients WHERE (numero_identificacion = $1 OR numero_historia_clinica = $2) AND id != $3`,
        [d.numeroIdentificacion, d.numeroHistoriaClinica, patientId]
      );
      if (dup) {
        res.status(409).json({ error: 'Otro paciente ya utiliza esa identificación o historia clínica.' });
        return;
      }

      const now = new Date().toISOString();
      const prevSnapshot = {
        nombres: existing.nombres,
        apellidos: existing.apellidos,
        numero_identificacion: existing.numero_identificacion,
        numero_historia_clinica: existing.numero_historia_clinica,
        fecha_nacimiento: existing.fecha_nacimiento,
        sexo: existing.sexo,
        antecedente_hta: toBool(existing.antecedente_hta),
        antecedente_diabetes: toBool(existing.antecedente_diabetes),
        embarazo_actual: toBool(existing.embarazo_actual),
      };
      const newSnapshot = {
        nombres: d.nombres,
        apellidos: d.apellidos,
        numero_identificacion: d.numeroIdentificacion,
        numero_historia_clinica: d.numeroHistoriaClinica,
        fecha_nacimiento: d.fechaNacimiento,
        sexo: d.sexo,
        antecedente_hta: d.antecedenteHta,
        antecedente_diabetes: d.antecedenteDiabetes,
        embarazo_actual: d.embarazoActual,
      };

      await dbRun(
        `UPDATE patients SET
          tipo_identificacion = $1, numero_identificacion = $2, numero_historia_clinica = $3,
          nombres = $4, apellidos = $5, fecha_nacimiento = $6, sexo = $7,
          telefono_enc = $8, direccion_enc = $9, contacto_emergencia_enc = $10,
          organization_id = $11, antecedente_hta = $12, antecedente_diabetes = $13,
          embarazo_actual = $14, condicion_clinica_especial = $15, otros_antecedentes = $16,
          observaciones_enc = $17, updated_at = $18
         WHERE id = $19`,
        [
          d.tipoIdentificacion,
          d.numeroIdentificacion,
          d.numeroHistoriaClinica,
          d.nombres,
          d.apellidos,
          d.fechaNacimiento,
          d.sexo,
          encryptSensitive(d.telefono),
          encryptSensitive(d.direccion),
          encryptSensitive(d.contactoEmergencia),
          d.organizationId,
          d.antecedenteHta,
          d.antecedenteDiabetes,
          d.embarazoActual,
          d.condicionClinicaEspecial || null,
          d.otrosAntecedentes || null,
          encryptSensitive(d.observaciones),
          now,
          patientId,
        ]
      );

      await dbRun(
        `INSERT INTO medical_history (
          id, patient_id, tipo_registro, titulo, detalle, datos_anteriores, datos_nuevos, recorded_by, created_at
        ) VALUES ($1,$2,'cambio_demografico',$3,$4,$5,$6,$7,$8)`,
        [
          crypto.randomUUID(),
          patientId,
          'Actualización demográfica y clínica',
          d.motivoCambio || 'Actualización de datos del paciente',
          JSON.stringify(prevSnapshot),
          JSON.stringify(newSnapshot),
          req.authUser!.id,
          now,
        ]
      );

      await recordAuditLog({
        profileId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        accion: 'PATIENT_UPDATED',
        recurso: 'patients',
        recursoId: patientId,
        detalle: { motivo: d.motivoCambio || 'Edición autorizada' },
        req,
      });

      const updated = await dbGet<Record<string, unknown>>(
        `SELECT p.*, o.nombre AS organization_nombre, o.altitud_msnm
         FROM patients p JOIN organizations o ON o.id = p.organization_id WHERE p.id = $1`,
        [patientId]
      );
      res.json({ patient: updated ? formatPatientRow(updated) : null });
    } catch (err) {
      console.error('Error actualizando paciente:', err);
      res.status(500).json({ error: 'No se pudo actualizar el paciente.' });
    }
  }
);

patientsRouter.patch(
  '/:id/status',
  requireAuth,
  requireRole('administrador', 'medico'),
  async (req: AuthRequest, res) => {
    try {
      const patientId = req.params.id;
      const activo = Boolean(req.body?.activo);
      const motivo = String(req.body?.motivo || 'Cambio de estado institucional').trim();

      if (!(await canAccessPatient(req.authUser!, patientId))) {
        res.status(403).json({ error: 'No autorizado.' });
        return;
      }

      const now = new Date().toISOString();
      await dbRun(`UPDATE patients SET activo = $1, updated_at = $2 WHERE id = $3`, [activo, now, patientId]);
      await dbRun(
        `INSERT INTO medical_history (id, patient_id, tipo_registro, titulo, detalle, recorded_by, created_at)
         VALUES ($1,$2,'cambio_demografico',$3,$4,$5,$6)`,
        [
          crypto.randomUUID(),
          patientId,
          activo ? 'Reactivación de paciente' : 'Inactivación de paciente',
          motivo,
          req.authUser!.id,
          now,
        ]
      );

      await recordAuditLog({
        profileId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        accion: activo ? 'PATIENT_REACTIVATED' : 'PATIENT_DEACTIVATED',
        recurso: 'patients',
        recursoId: patientId,
        detalle: { motivo },
        req,
      });

      res.json({ ok: true, activo });
    } catch (err) {
      console.error('Error cambiando estado del paciente:', err);
      res.status(500).json({ error: 'No se pudo cambiar el estado del paciente.' });
    }
  }
);

patientsRouter.post(
  '/:id/history',
  requireAuth,
  requireRole('administrador', 'medico', 'enfermeria'),
  async (req: AuthRequest, res) => {
    try {
      const patientId = req.params.id;
      if (!(await canAccessPatient(req.authUser!, patientId))) {
        res.status(403).json({ error: 'No autorizado.' });
        return;
      }
      const { tipoRegistro, titulo, detalle } = req.body as {
        tipoRegistro?: string;
        titulo?: string;
        detalle?: string;
      };
      const validTypes = ['antecedente_personal', 'antecedente_familiar', 'alergia', 'medicacion', 'diagnostico_previo'];
      if (!tipoRegistro || !validTypes.includes(tipoRegistro) || !titulo?.trim() || !detalle?.trim()) {
        res.status(400).json({ error: 'Complete tipo, título y detalle del antecedente.' });
        return;
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await dbRun(
        `INSERT INTO medical_history (id, patient_id, tipo_registro, titulo, detalle, recorded_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, patientId, tipoRegistro, titulo.trim(), detalle.trim(), req.authUser!.id, now]
      );
      await recordAuditLog({
        profileId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        accion: 'MEDICAL_HISTORY_ADDED',
        recurso: 'medical_history',
        recursoId: id,
        detalle: { patientId, tipoRegistro },
        req,
      });
      res.status(201).json({ ok: true, id });
    } catch (err) {
      console.error('Error agregando antecedente:', err);
      res.status(500).json({ error: 'No se pudo registrar el antecedente.' });
    }
  }
);
