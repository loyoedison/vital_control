import crypto from 'node:crypto';
import { Router } from 'express';
import { dbGet, dbQuery, dbRun, parseJsonField, toBool } from '../db/database.ts';
import { AuthRequest, recordAuditLog, requireAuth, requireRole } from '../middleware/auth.ts';
import { decryptSensitive, encryptSensitive, hashPassword } from '../utils/crypto.ts';
import { createUserSchema } from '../utils/validation.ts';

export const adminRouter = Router();

adminRouter.get('/organizations', requireAuth, async (_req, res) => {
  const orgs = await dbQuery(`SELECT * FROM organizations ORDER BY nombre ASC`);
  res.json({ items: orgs.map((o) => ({ ...o, activo: toBool(o.activo) })) });
});

adminRouter.get('/rules', requireAuth, async (_req, res) => {
  const rules = await dbQuery(`SELECT * FROM clinical_rules ORDER BY parametro, condicion_especial`);
  res.json({ items: rules.map((r) => ({ ...r, activa: toBool(r.activa) })) });
});

adminRouter.put(
  '/rules/:id',
  requireAuth,
  requireRole('administrador'),
  async (req: AuthRequest, res) => {
    try {
      const ruleId = req.params.id;
      const body = req.body as Record<string, unknown>;
      const nowDate = new Date().toISOString().slice(0, 10);

      await dbRun(
        `UPDATE clinical_rules SET
          fuente_clinica = $1, version_guia = $2, poblacion_aplicable = $3,
          rango_verde_min = $4, rango_verde_max = $5,
          rango_amarillo_min = $6, rango_amarillo_max = $7,
          rango_naranja_min = $8, rango_naranja_max = $9,
          rango_rojo_min = $10, rango_rojo_max = $11,
          responsable_aprobacion = $12, fecha_actualizacion = $13, activa = $14
         WHERE id = $15`,
        [
          String(body.fuenteClinica || 'Guía Institucional'),
          String(body.versionGuia || 'v1.0'),
          String(body.poblacionAplicable || 'Adultos'),
          body.rangoVerdeMin === null || body.rangoVerdeMin === '' ? null : Number(body.rangoVerdeMin),
          body.rangoVerdeMax === null || body.rangoVerdeMax === '' ? null : Number(body.rangoVerdeMax),
          body.rangoAmarilloMin === null || body.rangoAmarilloMin === '' ? null : Number(body.rangoAmarilloMin),
          body.rangoAmarilloMax === null || body.rangoAmarilloMax === '' ? null : Number(body.rangoAmarilloMax),
          body.rangoNaranjaMin === null || body.rangoNaranjaMin === '' ? null : Number(body.rangoNaranjaMin),
          body.rangoNaranjaMax === null || body.rangoNaranjaMax === '' ? null : Number(body.rangoNaranjaMax),
          body.rangoRojoMin === null || body.rangoRojoMin === '' ? null : Number(body.rangoRojoMin),
          body.rangoRojoMax === null || body.rangoRojoMax === '' ? null : Number(body.rangoRojoMax),
          String(body.responsableAprobacion || `${req.authUser!.nombres} ${req.authUser!.apellidos}`),
          nowDate,
          body.activa !== false,
          ruleId,
        ]
      );

      await recordAuditLog({
        profileId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: req.authUser!.role,
        accion: 'CLINICAL_RULE_UPDATED',
        recurso: 'clinical_rules',
        recursoId: ruleId,
        detalle: { versionGuia: body.versionGuia, responsable: body.responsableAprobacion },
        req,
      });

      res.json({ ok: true });
    } catch (err) {
      console.error('Error actualizando regla clínica:', err);
      res.status(500).json({ error: 'No se pudo actualizar la regla clínica.' });
    }
  }
);

adminRouter.get('/users', requireAuth, requireRole('administrador'), async (_req, res) => {
  const users = await dbQuery<Record<string, unknown>>(
    `SELECT p.id, p.email, p.nombres, p.apellidos, p.numero_registro_profesional, p.especialidad,
            p.mfa_enabled, p.activo, p.last_login_at, p.created_at,
            r.codigo AS role_codigo, r.nombre AS role_nombre
     FROM profiles p
     JOIN user_roles r ON r.id = p.role_id
     ORDER BY p.created_at DESC`
  );

  const enriched = await Promise.all(
    users.map(async (u) => {
      const orgs = await dbQuery<{ organization_id: string; nombre: string }>(
        `SELECT om.organization_id, o.nombre
         FROM organization_members om
         JOIN organizations o ON o.id = om.organization_id
         WHERE om.profile_id = $1 AND om.activo = $2`,
        [u.id, true]
      );
      return {
        ...u,
        mfa_enabled: toBool(u.mfa_enabled),
        activo: toBool(u.activo),
        organizations: orgs,
      };
    })
  );

  res.json({ items: enriched });
});

adminRouter.post('/users', requireAuth, requireRole('administrador'), async (req: AuthRequest, res) => {
  try {
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Datos de usuario inválidos.' });
      return;
    }
    const d = parsed.data;
    const email = d.email.toLowerCase().trim();

    const exists = await dbGet<{ id: string }>(`SELECT id FROM profiles WHERE email = $1`, [email]);
    if (exists) {
      res.status(409).json({ error: 'Ya existe un usuario registrado con ese correo.' });
      return;
    }

    const role = await dbGet<{ id: string }>(`SELECT id FROM user_roles WHERE codigo = $1`, [d.roleCodigo]);
    if (!role) {
      res.status(400).json({ error: 'Rol no válido.' });
      return;
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const hash = await hashPassword(d.password);

    await dbRun(
      `INSERT INTO profiles (
        id, role_id, email, nombres, apellidos, numero_registro_profesional, especialidad,
        password_hash, mfa_enabled, activo, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        role.id,
        email,
        d.nombres.trim(),
        d.apellidos.trim(),
        d.numeroRegistroProfesional || null,
        d.especialidad || null,
        hash,
        false,
        true,
        now,
        now,
      ]
    );

    if (d.organizationId) {
      await dbRun(
        `INSERT INTO organization_members (id, organization_id, profile_id, es_principal, activo, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [crypto.randomUUID(), d.organizationId, id, true, true, now]
      );
    }

    await recordAuditLog({
      profileId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      accion: 'USER_CREATED',
      recurso: 'profiles',
      recursoId: id,
      detalle: { email, role: d.roleCodigo },
      req,
    });

    res.status(201).json({ ok: true, id });
  } catch (err) {
    console.error('Error creando usuario:', err);
    res.status(500).json({ error: 'No se pudo crear el usuario.' });
  }
});

adminRouter.patch('/users/:id/status', requireAuth, requireRole('administrador'), async (req: AuthRequest, res) => {
  const targetId = req.params.id;
  if (targetId === req.authUser!.id) {
    res.status(400).json({ error: 'No puede desactivar su propia cuenta activa.' });
    return;
  }
  const activo = Boolean(req.body?.activo);
  await dbRun(`UPDATE profiles SET activo = $1, updated_at = $2 WHERE id = $3`, [
    activo,
    new Date().toISOString(),
    targetId,
  ]);
  await recordAuditLog({
    profileId: req.authUser!.id,
    actorEmail: req.authUser!.email,
    actorRole: req.authUser!.role,
    accion: activo ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
    recurso: 'profiles',
    recursoId: targetId,
    req,
  });
  res.json({ ok: true });
});

adminRouter.patch('/users/:id/role', requireAuth, requireRole('administrador'), async (req: AuthRequest, res) => {
  const targetId = req.params.id;
  const roleCodigo = String(req.body?.roleCodigo || '');
  const role = await dbGet<{ id: string }>(`SELECT id FROM user_roles WHERE codigo = $1`, [roleCodigo]);
  if (!role) {
    res.status(400).json({ error: 'Rol inválido.' });
    return;
  }
  await dbRun(`UPDATE profiles SET role_id = $1, updated_at = $2 WHERE id = $3`, [
    role.id,
    new Date().toISOString(),
    targetId,
  ]);
  await recordAuditLog({
    profileId: req.authUser!.id,
    actorEmail: req.authUser!.email,
    actorRole: req.authUser!.role,
    accion: 'USER_ROLE_CHANGED',
    recurso: 'profiles',
    recursoId: targetId,
    detalle: { roleCodigo },
    req,
  });
  res.json({ ok: true });
});

adminRouter.get('/audit', requireAuth, requireRole('administrador'), async (req, res) => {
  const limit = Math.min(300, Math.max(20, Number(req.query.limit || 100)));
  const logs = await dbQuery<Record<string, unknown>>(
    `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  res.json({
    items: logs.map((l) => ({
      ...l,
      detalle: parseJsonField(l.detalle, {}),
    })),
  });
});

adminRouter.get('/settings', requireAuth, async (_req, res) => {
  const rows = await dbQuery(`SELECT * FROM system_settings ORDER BY clave`);
  res.json({ items: rows });
});

adminRouter.put('/settings', requireAuth, requireRole('administrador'), async (req: AuthRequest, res) => {
  const updates = req.body?.settings as Array<{ clave: string; valor: string }> | undefined;
  if (!Array.isArray(updates)) {
    res.status(400).json({ error: 'Formato de configuración inválido.' });
    return;
  }
  const now = new Date().toISOString();
  for (const item of updates) {
    await dbRun(
      `UPDATE system_settings SET valor = $1, updated_by = $2, updated_at = $3 WHERE clave = $4`,
      [String(item.valor), req.authUser!.id, now, String(item.clave)]
    );
  }
  await recordAuditLog({
    profileId: req.authUser!.id,
    actorEmail: req.authUser!.email,
    actorRole: req.authUser!.role,
    accion: 'SYSTEM_SETTINGS_UPDATED',
    recurso: 'system_settings',
    detalle: { claves: updates.map((u) => u.clave) },
    req,
  });
  res.json({ ok: true });
});

adminRouter.get('/backup', requireAuth, requireRole('administrador'), async (req: AuthRequest, res) => {
  try {
    const payload = {
      format: 'vitalcontrol-encrypted-backup-v1',
      generatedAt: new Date().toISOString(),
      timezone: 'America/Guayaquil',
      data: {
        organizations: await dbQuery(`SELECT * FROM organizations`),
        clinical_rules: await dbQuery(`SELECT * FROM clinical_rules`),
        patients: await dbQuery(`SELECT * FROM patients`),
        medical_history: await dbQuery(`SELECT * FROM medical_history`),
        vital_signs: await dbQuery(`SELECT * FROM vital_signs`),
        blood_pressure_readings: await dbQuery(`SELECT * FROM blood_pressure_readings`),
        hypertension_followups: await dbQuery(`SELECT * FROM hypertension_followups`),
        clinical_alerts: await dbQuery(`SELECT * FROM clinical_alerts`),
        appointments: await dbQuery(`SELECT * FROM appointments`),
        system_settings: await dbQuery(`SELECT * FROM system_settings`),
      },
    };

    const rawJson = JSON.stringify(payload);
    const encryptedEnvelope = encryptSensitive(rawJson);
    const checksum = crypto.createHash('sha256').update(rawJson).digest('hex');

    await recordAuditLog({
      profileId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      accion: 'BACKUP_GENERATED',
      recurso: 'system_backup',
      detalle: { checksum, patientsCount: payload.data.patients.length },
      req,
    });

    res.json({
      version: '1.0',
      generatedAt: payload.generatedAt,
      checksum,
      encryptedPayload: encryptedEnvelope,
    });
  } catch (err) {
    console.error('Error generando respaldo:', err);
    res.status(500).json({ error: 'No se pudo generar la copia de seguridad.' });
  }
});

adminRouter.post('/restore', requireAuth, requireRole('administrador'), async (req: AuthRequest, res) => {
  try {
    const { encryptedPayload, checksum } = req.body as { encryptedPayload?: string; checksum?: string };
    if (!encryptedPayload || !checksum) {
      res.status(400).json({ error: 'Proporcione el archivo cifrado y su suma de verificación SHA-256.' });
      return;
    }

    const rawJson = decryptSensitive(encryptedPayload);
    if (!rawJson || rawJson.startsWith('[Dato protegido')) {
      res.status(400).json({ error: 'No se pudo descifrar el respaldo con la clave de cifrado vigente.' });
      return;
    }

    const actualChecksum = crypto.createHash('sha256').update(rawJson).digest('hex');
    if (actualChecksum !== checksum) {
      res.status(400).json({ error: 'Verificación de integridad SHA-256 fallida. Respaldo alterado.' });
      return;
    }

    const parsed = JSON.parse(rawJson) as {
      format: string;
      data: {
        system_settings?: Array<{ clave: string; valor: string }>;
        clinical_rules?: Array<Record<string, unknown>>;
      };
    };

    if (parsed.format !== 'vitalcontrol-encrypted-backup-v1') {
      res.status(400).json({ error: 'Formato de respaldo incompatible.' });
      return;
    }

    let restoredSettings = 0;
    if (Array.isArray(parsed.data.system_settings)) {
      for (const s of parsed.data.system_settings) {
        await dbRun(`UPDATE system_settings SET valor = $1, updated_at = $2 WHERE clave = $3`, [
          s.valor,
          new Date().toISOString(),
          s.clave,
        ]);
        restoredSettings++;
      }
    }

    await recordAuditLog({
      profileId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      accion: 'BACKUP_VERIFIED_AND_RESTORED',
      recurso: 'system_backup',
      detalle: { checksum, restoredSettings },
      req,
    });

    res.json({
      ok: true,
      message: `Respaldo verificado (SHA-256 válido) y parámetros restaurados (${restoredSettings} ajustes).`,
    });
  } catch (err) {
    console.error('Error restaurando respaldo:', err);
    res.status(500).json({ error: 'Error al validar o restaurar el respaldo.' });
  }
});
