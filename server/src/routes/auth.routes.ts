import crypto from 'node:crypto';
import { Router } from 'express';
import { env } from '../config/env.ts';
import { dbGet, dbQuery, dbRun, seedSyntheticClinicalData, toBool } from '../db/database.ts';
import {
  AuthRequest,
  clearSessionCookie,
  recordAuditLog,
  requireAuth,
  SESSION_COOKIE_NAME,
  setSessionCookie,
} from '../middleware/auth.ts';
import {
  decryptSensitive,
  encryptSensitive,
  generateTotpSecret,
  hashPassword,
  sha256Hex,
  signJwt,
  verifyJwt,
  verifyPassword,
  verifyTotpCode,
} from '../utils/crypto.ts';
import { loginSchema, setupAdminSchema } from '../utils/validation.ts';

export const authRouter = Router();

authRouter.get('/status', async (req, res) => {
  try {
    const countRow = await dbGet<{ c: number }>(`SELECT COUNT(*) AS c FROM profiles`);
    const hasUsers = Number(countRow?.c || 0) > 0;
    const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    const payload = token ? verifyJwt(token) : null;

    res.json({
      requiresInitialSetup: !hasUsers,
      requiresBootstrapPasscode: Boolean(env.adminBootstrapPasscode),
      authenticated: Boolean(payload),
    });
  } catch (err) {
    console.error('Error en /auth/status:', err);
    res.status(500).json({ error: 'Error al consultar estado de autenticación.' });
  }
});

authRouter.post('/setup-admin', async (req, res) => {
  try {
    const countRow = await dbGet<{ c: number }>(`SELECT COUNT(*) AS c FROM profiles`);
    if (Number(countRow?.c || 0) > 0) {
      res.status(409).json({ error: 'La cuenta de administrador inicial ya fue configurada.' });
      return;
    }

    const parsed = setupAdminSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Datos inválidos.' });
      return;
    }

    if (env.adminBootstrapPasscode && parsed.data.passcode !== env.adminBootstrapPasscode) {
      res.status(403).json({ error: 'Código de autorización inicial incorrecto.' });
      return;
    }

    const adminRole = await dbGet<{ id: string }>(
      `SELECT id FROM user_roles WHERE codigo = 'administrador'`
    );
    if (!adminRole) {
      res.status(500).json({ error: 'Catálogo de roles no inicializado.' });
      return;
    }

    const profileId = crypto.randomUUID();
    const now = new Date().toISOString();
    const passwordHash = await hashPassword(parsed.data.password);

    await dbRun(
      `INSERT INTO profiles (
        id, role_id, email, nombres, apellidos, numero_registro_profesional, especialidad,
        password_hash, mfa_enabled, activo, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        profileId,
        adminRole.id,
        parsed.data.email.toLowerCase(),
        parsed.data.nombres.trim(),
        parsed.data.apellidos.trim(),
        'ADM-001',
        'Administración Sanitaria',
        passwordHash,
        false,
        true,
        now,
        now,
      ]
    );

    const orgs = await dbQuery<{ id: string }>(`SELECT id FROM organizations`);
    for (let i = 0; i < orgs.length; i++) {
      await dbRun(
        `INSERT INTO organization_members (id, organization_id, profile_id, es_principal, activo, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [crypto.randomUUID(), orgs[i].id, profileId, i === 0, true, now]
      );
    }

    await seedSyntheticClinicalData(profileId);

    await recordAuditLog({
      profileId,
      actorEmail: parsed.data.email.toLowerCase(),
      actorRole: 'administrador',
      accion: 'ADMIN_INITIAL_CLAIM',
      recurso: 'profiles',
      recursoId: profileId,
      req,
    });

    const token = signJwt({
      sub: profileId,
      email: parsed.data.email.toLowerCase(),
      role: 'administrador',
      lastActivity: Math.floor(Date.now() / 1000),
      mfaVerified: false,
    });
    setSessionCookie(res, token);

    res.status(201).json({ ok: true, message: 'Administrador inicial configurado correctamente.' });
  } catch (err) {
    console.error('Error en setup-admin:', err);
    res.status(500).json({ error: 'No se pudo configurar el administrador inicial.' });
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Credenciales inválidas.' });
      return;
    }

    const email = parsed.data.email.toLowerCase().trim();
    const user = await dbGet<{
      id: string;
      email: string;
      nombres: string;
      apellidos: string;
      password_hash: string;
      mfa_enabled: unknown;
      mfa_secret_enc: string | null;
      failed_login_attempts: number;
      locked_until: string | null;
      activo: unknown;
      role_codigo: string;
    }>(
      `SELECT p.*, r.codigo AS role_codigo
       FROM profiles p
       JOIN user_roles r ON r.id = p.role_id
       WHERE p.email = $1`,
      [email]
    );

    if (!user) {
      await recordAuditLog({
        actorEmail: email,
        accion: 'LOGIN_FAILED',
        recurso: 'auth',
        detalle: { motivo: 'Usuario no encontrado' },
        req,
        resultado: 'denegado',
      });
      res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
      return;
    }

    if (!toBool(user.activo)) {
      await recordAuditLog({
        profileId: user.id,
        actorEmail: email,
        actorRole: user.role_codigo,
        accion: 'LOGIN_INACTIVE_USER',
        recurso: 'auth',
        req,
        resultado: 'denegado',
      });
      res.status(403).json({ error: 'Esta cuenta se encuentra desactivada. Contacte al administrador.' });
      return;
    }

    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      const minutosRestantes = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
      res.status(429).json({
        error: `Cuenta bloqueada temporalmente por intentos fallidos. Intente en ${minutosRestantes} minuto(s).`,
      });
      return;
    }

    const validPwd = await verifyPassword(parsed.data.password, user.password_hash);
    if (!validPwd) {
      const attempts = Number(user.failed_login_attempts || 0) + 1;
      const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      await dbRun(
        `UPDATE profiles SET failed_login_attempts = $1, locked_until = $2, updated_at = $3 WHERE id = $4`,
        [attempts, lockUntil, new Date().toISOString(), user.id]
      );
      await recordAuditLog({
        profileId: user.id,
        actorEmail: email,
        actorRole: user.role_codigo,
        accion: lockUntil ? 'ACCOUNT_TEMP_LOCKED' : 'LOGIN_FAILED',
        recurso: 'auth',
        detalle: { intentos: attempts },
        req,
        resultado: 'denegado',
      });
      res.status(401).json({
        error: lockUntil
          ? 'Cuenta bloqueada por 15 minutos tras múltiples intentos fallidos.'
          : 'Correo o contraseña incorrectos.',
      });
      return;
    }

    const mfaEnabled = toBool(user.mfa_enabled);
    if (mfaEnabled) {
      if (!parsed.data.totpCode) {
        res.status(200).json({ mfaRequired: true, message: 'Ingrese el código de verificación de 6 dígitos.' });
        return;
      }
      const secret = decryptSensitive(user.mfa_secret_enc);
      if (!secret || !verifyTotpCode(secret, parsed.data.totpCode)) {
        await recordAuditLog({
          profileId: user.id,
          actorEmail: email,
          actorRole: user.role_codigo,
          accion: 'MFA_FAILED',
          recurso: 'auth',
          req,
          resultado: 'denegado',
        });
        res.status(401).json({ error: 'Código de autenticación multifactor incorrecto.' });
        return;
      }
    }

    const now = new Date().toISOString();
    await dbRun(
      `UPDATE profiles SET failed_login_attempts = 0, locked_until = NULL, last_login_at = $1, updated_at = $1 WHERE id = $2`,
      [now, user.id]
    );

    const token = signJwt({
      sub: user.id,
      email: user.email,
      role: user.role_codigo,
      lastActivity: Math.floor(Date.now() / 1000),
      mfaVerified: mfaEnabled,
    });
    setSessionCookie(res, token);

    await recordAuditLog({
      profileId: user.id,
      actorEmail: user.email,
      actorRole: user.role_codigo,
      accion: 'LOGIN_SUCCESS',
      recurso: 'auth',
      req,
    });

    res.json({ ok: true, mfaRequired: false });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

authRouter.post('/logout', requireAuth, async (req: AuthRequest, res) => {
  await recordAuditLog({
    profileId: req.authUser?.id,
    actorEmail: req.authUser?.email,
    actorRole: req.authUser?.role,
    accion: 'LOGOUT',
    recurso: 'auth',
    req,
  });
  clearSessionCookie(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req: AuthRequest, res) => {
  const orgs = await dbQuery<{ id: string; codigo: string; nombre: string; ciudad: string; altitud_msnm: number }>(
    `SELECT o.id, o.codigo, o.nombre, o.ciudad, o.altitud_msnm
     FROM organizations o
     JOIN organization_members om ON om.organization_id = o.id
     WHERE om.profile_id = $1 AND om.activo = $2 AND o.activo = $3`,
    [req.authUser!.id, true, true]
  );

  const settingsRows = await dbQuery<{ clave: string; valor: string }>(`SELECT clave, valor FROM system_settings`);
  const settings = Object.fromEntries(settingsRows.map((s) => [s.clave, s.valor]));

  res.json({
    user: req.authUser,
    organizations: orgs,
    settings,
  });
});

authRouter.post('/change-password', requireAuth, async (req: AuthRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword || newPassword.length < 10 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      res.status(400).json({
        error: 'La nueva contraseña debe tener al menos 10 caracteres, una mayúscula y un número.',
      });
      return;
    }

    const row = await dbGet<{ password_hash: string }>(`SELECT password_hash FROM profiles WHERE id = $1`, [
      req.authUser!.id,
    ]);
    if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
      res.status(400).json({ error: 'La contraseña actual no es correcta.' });
      return;
    }

    const nextHash = await hashPassword(newPassword);
    await dbRun(
      `UPDATE profiles SET password_hash = $1, must_change_password = $2, updated_at = $3 WHERE id = $4`,
      [nextHash, false, new Date().toISOString(), req.authUser!.id]
    );

    await recordAuditLog({
      profileId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      actorRole: req.authUser!.role,
      accion: 'PASSWORD_CHANGED',
      recurso: 'profiles',
      recursoId: req.authUser!.id,
      req,
    });

    res.json({ ok: true, message: 'Contraseña actualizada correctamente.' });
  } catch (err) {
    console.error('Error cambiando contraseña:', err);
    res.status(500).json({ error: 'No se pudo actualizar la contraseña.' });
  }
});

authRouter.post('/recover', async (req, res) => {
  try {
    const email = String(req.body?.email || '').toLowerCase().trim();
    if (!email) {
      res.status(400).json({ error: 'Ingrese el correo electrónico institucional.' });
      return;
    }
    const user = await dbGet<{ id: string; activo: unknown }>(`SELECT id, activo FROM profiles WHERE email = $1`, [
      email,
    ]);
    if (user && toBool(user.activo)) {
      const rawToken = crypto.randomBytes(16).toString('hex');
      const tokenHash = sha256Hex(rawToken);
      const expiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
      await dbRun(
        `UPDATE profiles SET recovery_token_hash = $1, recovery_expires_at = $2, updated_at = $3 WHERE id = $4`,
        [tokenHash, expiresAt, new Date().toISOString(), user.id]
      );
      await recordAuditLog({
        profileId: user.id,
        actorEmail: email,
        accion: 'PASSWORD_RECOVERY_REQUESTED',
        recurso: 'auth',
        req,
      });

      res.json({
        ok: true,
        message: 'Se generó una solicitud de recuperación válida por 20 minutos.',
        previewRecoveryToken: env.nodeEnv !== 'production' ? rawToken : undefined,
      });
      return;
    }

    res.json({
      ok: true,
      message: 'Si el correo existe en el sistema, se procesó la solicitud de recuperación.',
    });
  } catch (err) {
    console.error('Error en recuperación:', err);
    res.status(500).json({ error: 'No se pudo procesar la recuperación.' });
  }
});

authRouter.post('/reset-password', async (req, res) => {
  try {
    const { email, token, newPassword } = req.body as { email?: string; token?: string; newPassword?: string };
    if (!email || !token || !newPassword || newPassword.length < 10 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      res.status(400).json({
        error: 'Datos inválidos. La contraseña debe tener mínimo 10 caracteres, una mayúscula y un número.',
      });
      return;
    }

    const user = await dbGet<{ id: string; recovery_token_hash: string | null; recovery_expires_at: string | null }>(
      `SELECT id, recovery_token_hash, recovery_expires_at FROM profiles WHERE email = $1`,
      [email.toLowerCase().trim()]
    );
    if (
      !user ||
      !user.recovery_token_hash ||
      !user.recovery_expires_at ||
      new Date(user.recovery_expires_at).getTime() < Date.now() ||
      user.recovery_token_hash !== sha256Hex(token.trim())
    ) {
      res.status(400).json({ error: 'Token de recuperación inválido o expirado.' });
      return;
    }

    const nextHash = await hashPassword(newPassword);
    await dbRun(
      `UPDATE profiles SET password_hash = $1, recovery_token_hash = NULL, recovery_expires_at = NULL, failed_login_attempts = 0, locked_until = NULL, updated_at = $2 WHERE id = $3`,
      [nextHash, new Date().toISOString(), user.id]
    );

    await recordAuditLog({
      profileId: user.id,
      actorEmail: email.toLowerCase().trim(),
      accion: 'PASSWORD_RESET_COMPLETED',
      recurso: 'auth',
      req,
    });

    res.json({ ok: true, message: 'Contraseña restablecida correctamente.' });
  } catch (err) {
    console.error('Error en reset-password:', err);
    res.status(500).json({ error: 'Error al restablecer la contraseña.' });
  }
});

authRouter.post('/mfa/enroll', requireAuth, async (req: AuthRequest, res) => {
  const secret = generateTotpSecret();
  const encryptedSecret = encryptSensitive(secret);
  await dbRun(`UPDATE profiles SET mfa_secret_enc = $1, updated_at = $2 WHERE id = $3`, [
    encryptedSecret,
    new Date().toISOString(),
    req.authUser!.id,
  ]);
  const issuer = encodeURIComponent('VitalControl');
  const label = encodeURIComponent(`VitalControl:${req.authUser!.email}`);
  const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&digits=6&period=30`;

  res.json({
    secret,
    otpauthUrl,
  });
});

authRouter.post('/mfa/verify', requireAuth, async (req: AuthRequest, res) => {
  const code = String(req.body?.code || '');
  const row = await dbGet<{ mfa_secret_enc: string | null }>(
    `SELECT mfa_secret_enc FROM profiles WHERE id = $1`,
    [req.authUser!.id]
  );
  const secret = decryptSensitive(row?.mfa_secret_enc);
  if (!secret || !verifyTotpCode(secret, code)) {
    res.status(400).json({ error: 'El código de 6 dígitos no coincide. Verifique la hora de su dispositivo.' });
    return;
  }

  await dbRun(`UPDATE profiles SET mfa_enabled = $1, updated_at = $2 WHERE id = $3`, [
    true,
    new Date().toISOString(),
    req.authUser!.id,
  ]);

  await recordAuditLog({
    profileId: req.authUser!.id,
    actorEmail: req.authUser!.email,
    actorRole: req.authUser!.role,
    accion: 'MFA_ENABLED',
    recurso: 'profiles',
    recursoId: req.authUser!.id,
    req,
  });

  res.json({ ok: true, message: 'Autenticación multifactor activada.' });
});

authRouter.post('/mfa/disable', requireAuth, async (req: AuthRequest, res) => {
  await dbRun(`UPDATE profiles SET mfa_enabled = $1, mfa_secret_enc = NULL, updated_at = $2 WHERE id = $3`, [
    false,
    new Date().toISOString(),
    req.authUser!.id,
  ]);
  await recordAuditLog({
    profileId: req.authUser!.id,
    actorEmail: req.authUser!.email,
    actorRole: req.authUser!.role,
    accion: 'MFA_DISABLED',
    recurso: 'profiles',
    recursoId: req.authUser!.id,
    req,
  });
  res.json({ ok: true });
});
