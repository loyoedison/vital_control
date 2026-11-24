import crypto from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.ts';
import { dbGet, dbQuery, dbRun, parseJsonField, toBool } from '../db/database.ts';
import { signJwt, verifyJwt } from '../utils/crypto.ts';

export type RoleCode = 'administrador' | 'medico' | 'enfermeria' | 'consulta';

export interface AuthenticatedUser {
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

export interface AuthRequest extends Request {
  authUser?: AuthenticatedUser;
}

export const SESSION_COOKIE_NAME = 'vc_session';

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    path: '/',
    maxAge: 8 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true,
    path: '/',
  });
}

export async function recordAuditLog(params: {
  profileId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  accion: string;
  recurso: string;
  recursoId?: string | null;
  detalle?: Record<string, unknown>;
  req?: Request;
  resultado?: 'exitoso' | 'denegado' | 'error';
}): Promise<void> {
  try {
    const ip =
      (params.req?.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
      params.req?.socket?.remoteAddress ||
      null;
    const ua = (params.req?.headers['user-agent'] as string | undefined)?.slice(0, 250) || null;
    await dbRun(
      `INSERT INTO audit_logs (
        id, profile_id, actor_email, actor_role, accion, recurso, recurso_id,
        detalle, ip_address, user_agent, resultado, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        crypto.randomUUID(),
        params.profileId ?? null,
        params.actorEmail ?? null,
        params.actorRole ?? null,
        params.accion,
        params.recurso,
        params.recursoId ?? null,
        JSON.stringify(params.detalle ?? {}),
        ip,
        ua,
        params.resultado ?? 'exitoso',
        new Date().toISOString(),
      ]
    );
  } catch (err) {
    console.error('Error al registrar auditoría:', err);
  }
}

export function verifyCsrfForCookieMutations(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  // Rutas públicas previas a tener cookie o llamadas explícitas con cabecera personalizada
  const hasCustomHeader = req.headers['x-requested-with'] === 'VitalControl';
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;

  if (hasCustomHeader) {
    next();
    return;
  }

  if (origin && host) {
    try {
      const originHost = new URL(origin).host;
      if (originHost === host) {
        next();
        return;
      }
    } catch {
      // Origin inválido
    }
  }

  res.status(403).json({ error: 'Solicitud bloqueada por validación de origen CSRF.' });
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
  const bearerHeader = req.headers.authorization;
  const bearerToken = bearerHeader?.startsWith('Bearer ') ? bearerHeader.slice(7).trim() : undefined;
  const token = cookieToken || bearerToken;

  if (!token) {
    res.status(401).json({ error: 'Sesión no iniciada o expirada.' });
    return;
  }

  const payload = verifyJwt(token);
  if (!payload) {
    clearSessionCookie(res);
    res.status(401).json({ error: 'Token de sesión inválido o expirado.' });
    return;
  }

  const settingRow = await dbGet<{ valor: string }>(
    `SELECT valor FROM system_settings WHERE clave = 'sesion_inactividad_min'`
  );
  const idleMinutes = Math.max(5, Number(settingRow?.valor || env.sessionIdleMinutes));
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - payload.lastActivity > idleMinutes * 60) {
    clearSessionCookie(res);
    await recordAuditLog({
      profileId: payload.sub,
      actorEmail: payload.email,
      actorRole: payload.role,
      accion: 'SESSION_IDLE_EXPIRED',
      recurso: 'auth',
      req,
      resultado: 'denegado',
    });
    res.status(401).json({ error: 'Sesión cerrada automáticamente por inactividad.' });
    return;
  }

  const userRow = await dbGet<{
    id: string;
    email: string;
    nombres: string;
    apellidos: string;
    activo: unknown;
    mfa_enabled: unknown;
    must_change_password: unknown;
    role_codigo: RoleCode;
    role_nombre: string;
    permisos: unknown;
  }>(
    `SELECT p.id, p.email, p.nombres, p.apellidos, p.activo, p.mfa_enabled, p.must_change_password,
            r.codigo AS role_codigo, r.nombre AS role_nombre, r.permisos
     FROM profiles p
     JOIN user_roles r ON r.id = p.role_id
     WHERE p.id = $1`,
    [payload.sub]
  );

  if (!userRow || !toBool(userRow.activo)) {
    clearSessionCookie(res);
    res.status(401).json({ error: 'Usuario inactivo o no autorizado.' });
    return;
  }

  const orgRows = await dbQuery<{ organization_id: string }>(
    `SELECT organization_id FROM organization_members WHERE profile_id = $1 AND activo = $2`,
    [userRow.id, true]
  );

  req.authUser = {
    id: userRow.id,
    email: userRow.email,
    nombres: userRow.nombres,
    apellidos: userRow.apellidos,
    role: userRow.role_codigo,
    roleNombre: userRow.role_nombre,
    permisos: parseJsonField<string[]>(userRow.permisos, []),
    organizationIds: orgRows.map((o) => o.organization_id),
    mfaEnabled: toBool(userRow.mfa_enabled),
    mustChangePassword: toBool(userRow.must_change_password),
  };

  // Renovación deslizante de actividad en cookie
  if (cookieToken) {
    const refreshed = signJwt({
      sub: payload.sub,
      email: payload.email,
      role: userRow.role_codigo,
      lastActivity: nowSec,
      mfaVerified: payload.mfaVerified,
    });
    setSessionCookie(res, refreshed);
  }

  next();
}

export function requireRole(...allowedRoles: RoleCode[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.authUser) {
      res.status(401).json({ error: 'No autenticado.' });
      return;
    }
    if (!allowedRoles.includes(req.authUser.role)) {
      await recordAuditLog({
        profileId: req.authUser.id,
        actorEmail: req.authUser.email,
        actorRole: req.authUser.role,
        accion: 'FORBIDDEN_ACCESS',
        recurso: req.originalUrl,
        req,
        resultado: 'denegado',
      });
      res.status(403).json({ error: 'No cuenta con permisos para realizar esta acción.' });
      return;
    }
    next();
  };
}

export async function canAccessPatient(user: AuthenticatedUser, patientId: string): Promise<boolean> {
  if (user.role === 'administrador') return true;

  const patient = await dbGet<{ organization_id: string }>(
    `SELECT organization_id FROM patients WHERE id = $1`,
    [patientId]
  );
  if (!patient) return false;

  // Rol consulta requiere asignación explícita o pertenencia al establecimiento si tiene asignación
  const assignment = await dbGet<{ id: string }>(
    `SELECT id FROM patient_assignments WHERE patient_id = $1 AND profile_id = $2 AND activo = $3`,
    [patientId, user.id, true]
  );
  if (assignment) return true;

  if (user.role === 'consulta') {
    const anyAssignments = await dbGet<{ c: number }>(
      `SELECT COUNT(*) AS c FROM patient_assignments WHERE profile_id = $1 AND activo = $2`,
      [user.id, true]
    );
    if (Number(anyAssignments?.c || 0) > 0) return false;
  }

  return user.organizationIds.includes(patient.organization_id);
}
