import React, { useEffect, useState } from 'react';
import { Download, Key, RefreshCw, Shield, Sliders, Upload, UserPlus } from 'lucide-react';
import { apiRequest } from '../../lib/api.ts';
import { formatDateEC, formatDateTimeEC } from '../../lib/utils.ts';
import { ClinicalRule, Organization } from '../../types/clinical.ts';
import { Button, Input, Modal, Select, Surface, Textarea, useToast } from '../ui/Primitives.tsx';

interface AdminUserRow {
  id: string;
  email: string;
  nombres: string;
  apellidos: string;
  role_codigo: string;
  role_nombre: string;
  mfa_enabled: boolean;
  activo: boolean;
  last_login_at: string | null;
  organizations: Array<{ organization_id: string; nombre: string }>;
}

interface AuditRow {
  id: string;
  actor_email: string | null;
  actor_role: string | null;
  accion: string;
  recurso: string;
  recurso_id: string | null;
  resultado: string;
  ip_address: string | null;
  created_at: string;
}

export function AdminView() {
  const { notify } = useToast();
  const [tab, setTab] = useState<'users' | 'rules' | 'audit' | 'backups' | 'settings'>('users');

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [rules, setRules] = useState<ClinicalRule[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditRow[]>([]);
  const [settings, setSettings] = useState<Array<{ clave: string; valor: string; descripcion: string }>>([]);

  // Modal nuevo usuario
  const [userModal, setUserModal] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombres, setNombres] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [roleCodigo, setRoleCodigo] = useState<'medico' | 'enfermeria' | 'consulta' | 'administrador'>('medico');
  const [organizationId, setOrganizationId] = useState('');
  const [registroProf, setRegistroProf] = useState('');

  // Modal editar regla
  const [editingRule, setEditingRule] = useState<ClinicalRule | null>(null);

  // Respaldo y restauración
  const [backupOutput, setBackupOutput] = useState<{ checksum: string; encryptedPayload: string } | null>(null);
  const [restoreJson, setRestoreJson] = useState('');

  const loadAll = async () => {
    try {
      const [uRes, oRes, rRes, aRes, sRes] = await Promise.all([
        apiRequest<{ items: AdminUserRow[] }>('/api/admin/users'),
        apiRequest<{ items: Organization[] }>('/api/admin/organizations'),
        apiRequest<{ items: ClinicalRule[] }>('/api/admin/rules'),
        apiRequest<{ items: AuditRow[] }>('/api/admin/audit?limit=80'),
        apiRequest<{ items: Array<{ clave: string; valor: string; descripcion: string }> }>('/api/admin/settings'),
      ]);
      setUsers(uRes.items);
      setOrgs(oRes.items);
      setRules(rRes.items);
      setAuditLogs(aRes.items);
      setSettings(sRes.items);
      if (!organizationId && oRes.items[0]) setOrganizationId(oRes.items[0].id);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error cargando módulo administrativo.');
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email,
          password,
          nombres,
          apellidos,
          roleCodigo,
          organizationId: organizationId || undefined,
          numeroRegistroProfesional: registroProf || null,
        }),
      });
      notify('success', 'Usuario institucional creado correctamente.');
      setUserModal(false);
      setEmail('');
      setPassword('');
      setNombres('');
      setApellidos('');
      loadAll();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'No se pudo crear el usuario.');
    }
  };

  const toggleUserActive = async (u: AdminUserRow) => {
    try {
      await apiRequest(`/api/admin/users/${u.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ activo: !u.activo }),
      });
      notify('success', u.activo ? 'Usuario desactivado.' : 'Usuario activado.');
      loadAll();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error actualizando usuario.');
    }
  };

  const changeUserRole = async (userId: string, nextRole: string) => {
    try {
      await apiRequest(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ roleCodigo: nextRole }),
      });
      notify('success', 'Rol actualizado en el servidor.');
      loadAll();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error cambiando rol.');
    }
  };

  const handleSaveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRule) return;
    try {
      await apiRequest(`/api/admin/rules/${editingRule.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          fuenteClinica: editingRule.fuente_clinica,
          versionGuia: editingRule.version_guia,
          poblacionAplicable: editingRule.poblacion_aplicable,
          rangoVerdeMin: editingRule.rango_verde_min,
          rangoVerdeMax: editingRule.rango_verde_max,
          rangoAmarilloMin: editingRule.rango_amarillo_min,
          rangoAmarilloMax: editingRule.rango_amarillo_max,
          rangoNaranjaMin: editingRule.rango_naranja_min,
          rangoNaranjaMax: editingRule.rango_naranja_max,
          rangoRojoMin: editingRule.rango_rojo_min,
          rangoRojoMax: editingRule.rango_rojo_max,
          responsableAprobacion: editingRule.responsable_aprobacion,
          activa: editingRule.activa,
        }),
      });
      notify('success', 'Regla clínica actualizada y auditada.');
      setEditingRule(null);
      loadAll();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error guardando regla clínica.');
    }
  };

  const handleGenerateBackup = async () => {
    try {
      const res = await apiRequest<{
        version: string;
        generatedAt: string;
        checksum: string;
        encryptedPayload: string;
      }>('/api/admin/backup');
      setBackupOutput({ checksum: res.checksum, encryptedPayload: res.encryptedPayload });
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vitalcontrol_backup_${res.generatedAt.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      notify('success', 'Copia de seguridad cifrada AES-256-GCM descargada.');
      loadAll();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error generando respaldo.');
    }
  };

  const handleRestoreBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const parsed = JSON.parse(restoreJson) as { encryptedPayload: string; checksum: string };
      const res = await apiRequest<{ message: string }>('/api/admin/restore', {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      notify('success', res.message);
      setRestoreJson('');
      loadAll();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Respaldo inválido o alterado.');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({
          settings: settings.map((s) => ({ clave: s.clave, valor: s.valor })),
        }),
      });
      notify('success', 'Configuración del sistema actualizada.');
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error guardando configuración.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Administración, Reglas Clínicas y Seguridad
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Gestión de personal sanitario, umbrales clínicos versionados, bitácora de auditoría y copias cifradas
          </p>
        </div>
        <a
          href="/api/docs"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <Key className="h-3.5 w-3.5" />
          <span>Documentación OpenAPI / Swagger</span>
        </a>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
        {(
          [
            { id: 'users', label: 'Usuarios y Roles' },
            { id: 'rules', label: 'Reglas Clínicas' },
            { id: 'audit', label: 'Auditoría' },
            { id: 'backups', label: 'Respaldos Cifrados' },
            { id: 'settings', label: 'Configuración' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
              tab === t.id
                ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'users' && (
        <Surface className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Cuentas de personal sanitario</h2>
            <Button size="sm" onClick={() => setUserModal(true)}>
              <UserPlus className="h-4 w-4" />
              <span>Crear usuario</span>
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="py-2 pr-3 font-medium">Profesional</th>
                  <th className="py-2 pr-3 font-medium">Correo</th>
                  <th className="py-2 pr-3 font-medium">Rol asignado</th>
                  <th className="py-2 pr-3 font-medium">Establecimiento</th>
                  <th className="py-2 pr-3 font-medium">MFA</th>
                  <th className="py-2 pr-3 font-medium">Último acceso</th>
                  <th className="py-2 text-right font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2.5 pr-3 font-medium">
                      {u.nombres} {u.apellidos}
                    </td>
                    <td className="py-2.5 pr-3 font-mono">{u.email}</td>
                    <td className="py-2.5 pr-3">
                      <Select
                        className="w-36 py-1 text-xs"
                        value={u.role_codigo}
                        onChange={(e) => changeUserRole(u.id, e.target.value)}
                      >
                        <option value="administrador">Administrador</option>
                        <option value="medico">Médico</option>
                        <option value="enfermeria">Enfermería</option>
                        <option value="consulta">Consulta</option>
                      </Select>
                    </td>
                    <td className="py-2.5 pr-3">
                      {u.organizations.map((o) => o.nombre).join(', ') || 'General'}
                    </td>
                    <td className="py-2.5 pr-3">{u.mfa_enabled ? 'Activo' : 'Inactivo'}</td>
                    <td className="py-2.5 pr-3 font-mono">{formatDateTimeEC(u.last_login_at)}</td>
                    <td className="py-2.5 text-right">
                      <Button size="sm" variant="secondary" onClick={() => toggleUserActive(u)}>
                        {u.activo ? 'Activo (Desactivar)' : 'Inactivo (Activar)'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {tab === 'rules' && (
        <Surface className="space-y-4">
          <h2 className="text-base font-semibold">Reglas y umbrales clínicos configurables</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="py-2 pr-3 font-medium">Regla / Población</th>
                  <th className="py-2 pr-3 font-medium">Fuente clínica / Versión</th>
                  <th className="py-2 pr-3 font-medium">Rango Verde</th>
                  <th className="py-2 pr-3 font-medium">Aprobado por</th>
                  <th className="py-2 pr-3 font-medium">Actualización</th>
                  <th className="py-2 text-right font-medium">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium">{r.nombre}</div>
                      <div className="text-slate-500">{r.poblacion_aplicable}</div>
                    </td>
                    <td className="py-2.5 pr-3">
                      {r.fuente_clinica} · <span className="font-mono">{r.version_guia}</span>
                    </td>
                    <td className="py-2.5 pr-3 font-mono">
                      {r.rango_verde_min} – {r.rango_verde_max} {r.unidad}
                    </td>
                    <td className="py-2.5 pr-3">{r.responsable_aprobacion}</td>
                    <td className="py-2.5 pr-3 font-mono">{formatDateEC(r.fecha_actualizacion)}</td>
                    <td className="py-2.5 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setEditingRule(r)}>
                        <Sliders className="h-3.5 w-3.5" />
                        <span>Configurar</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {tab === 'audit' && (
        <Surface className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Bitácora de auditoría clínica y seguridad</h2>
            <Button size="sm" variant="secondary" onClick={loadAll}>
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Actualizar</span>
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <tr>
                  <th className="py-2 pr-3 font-medium">Fecha/Hora</th>
                  <th className="py-2 pr-3 font-medium">Actor</th>
                  <th className="py-2 pr-3 font-medium">Acción</th>
                  <th className="py-2 pr-3 font-medium">Recurso</th>
                  <th className="py-2 pr-3 font-medium">Resultado</th>
                  <th className="py-2 font-medium">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {auditLogs.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 pr-3 font-mono">{formatDateTimeEC(l.created_at)}</td>
                    <td className="py-2 pr-3">{l.actor_email || 'Sistema'} ({l.actor_role || '—'})</td>
                    <td className="py-2 pr-3 font-mono font-medium">{l.accion}</td>
                    <td className="py-2 pr-3 font-mono">{l.recurso}</td>
                    <td className="py-2 pr-3 capitalize">{l.resultado}</td>
                    <td className="py-2 font-mono">{l.ip_address || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {tab === 'backups' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Surface className="space-y-4">
            <div className="flex items-center gap-2 text-sky-700 dark:text-sky-400">
              <Shield className="h-5 w-5" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Copia de seguridad cifrada (AES-256-GCM)
              </h2>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Genera un paquete JSON cifrado con firma de integridad SHA-256 incluyendo pacientes, signos vitales,
              reglas clínicas y configuración del sistema.
            </p>
            <Button onClick={handleGenerateBackup}>
              <Download className="h-4 w-4" />
              <span>Generar y descargar respaldo cifrado</span>
            </Button>
            {backupOutput && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/50">
                <p className="font-semibold">SHA-256 generado:</p>
                <p className="mt-1 font-mono break-all">{backupOutput.checksum}</p>
              </div>
            )}
          </Surface>

          <Surface className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Verificación y restauración de respaldo
            </h2>
            <form onSubmit={handleRestoreBackup} className="space-y-3">
              <Textarea
                required
                rows={5}
                className="font-mono text-xs"
                value={restoreJson}
                onChange={(e) => setRestoreJson(e.target.value)}
                placeholder='Pegue el contenido del archivo vitalcontrol_backup_*.json...'
              />
              <Button type="submit" variant="secondary">
                <Upload className="h-4 w-4" />
                <span>Verificar integridad y restaurar ajustes</span>
              </Button>
            </form>
          </Surface>
        </div>
      )}

      {tab === 'settings' && (
        <Surface className="space-y-4 max-w-2xl">
          <h2 className="text-base font-semibold">Parámetros institucionales y retención de datos</h2>
          <form onSubmit={handleSaveSettings} className="space-y-4">
            {settings.map((s, idx) => (
              <div key={s.clave}>
                <label className="mb-1 block text-xs font-medium">{s.descripcion}</label>
                <Input
                  value={s.valor}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSettings((prev) => prev.map((it, i) => (i === idx ? { ...it, valor: val } : it)));
                  }}
                />
              </div>
            ))}
            <Button type="submit">Guardar configuración</Button>
          </form>
        </Surface>
      )}

      {/* Modal crear usuario */}
      <Modal open={userModal} onClose={() => setUserModal(false)} title="Crear usuario institucional">
        <form onSubmit={handleCreateUser} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Nombres</label>
              <Input required value={nombres} onChange={(e) => setNombres(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Apellidos</label>
              <Input required value={apellidos} onChange={(e) => setApellidos(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Correo electrónico</label>
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Rol (asignado en servidor)</label>
              <Select value={roleCodigo} onChange={(e) => setRoleCodigo(e.target.value as typeof roleCodigo)}>
                <option value="medico">Médico</option>
                <option value="enfermeria">Enfermería</option>
                <option value="consulta">Consulta (solo lectura)</option>
                <option value="administrador">Administrador</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Establecimiento</label>
              <Select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Registro profesional (opcional)</label>
              <Input value={registroProf} onChange={(e) => setRegistroProf(e.target.value)} placeholder="MSP-12345" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Contraseña temporal</label>
              <Input
                type="password"
                required
                minLength={10}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mín. 10 car., 1 mayús., 1 núm."
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setUserModal(false)}>
              Cancelar
            </Button>
            <Button type="submit">Crear usuario</Button>
          </div>
        </form>
      </Modal>

      {/* Modal editar regla clínica */}
      <Modal
        open={Boolean(editingRule)}
        onClose={() => setEditingRule(null)}
        title={`Configurar regla clínica · ${editingRule?.nombre || ''}`}
      >
        {editingRule && (
          <form onSubmit={handleSaveRule} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Fuente clínica</label>
                <Input
                  value={editingRule.fuente_clinica}
                  onChange={(e) => setEditingRule({ ...editingRule, fuente_clinica: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Versión de guía</label>
                <Input
                  value={editingRule.version_guia}
                  onChange={(e) => setEditingRule({ ...editingRule, version_guia: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Verde mínimo ({editingRule.unidad})</label>
                <Input
                  type="number"
                  step="0.1"
                  className="font-mono"
                  value={editingRule.rango_verde_min ?? ''}
                  onChange={(e) =>
                    setEditingRule({ ...editingRule, rango_verde_min: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Verde máximo ({editingRule.unidad})</label>
                <Input
                  type="number"
                  step="0.1"
                  className="font-mono"
                  value={editingRule.rango_verde_max ?? ''}
                  onChange={(e) =>
                    setEditingRule({ ...editingRule, rango_verde_max: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Responsable de aprobación</label>
              <Input
                value={editingRule.responsable_aprobacion}
                onChange={(e) =>
                  setEditingRule({ ...editingRule, responsable_aprobacion: e.target.value })
                }
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setEditingRule(null)}>
                Cancelar
              </Button>
              <Button type="submit">Guardar regla</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
