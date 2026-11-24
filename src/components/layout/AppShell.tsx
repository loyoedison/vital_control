import React, { useState } from 'react';
import {
  Activity,
  BellRing,
  FileBarChart2,
  HeartPulse,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  Shield,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { cn } from '../../lib/utils.ts';
import { Button, Input, Modal, useToast } from '../ui/Primitives.tsx';

export type NavSection =
  | 'dashboard'
  | 'patients'
  | 'vitals'
  | 'hypertension'
  | 'alerts'
  | 'reports'
  | 'admin';

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: string[];
}> = [
  { id: 'dashboard', label: 'Panel Principal', icon: LayoutDashboard },
  { id: 'patients', label: 'Pacientes', icon: Users },
  { id: 'vitals', label: 'Signos Vitales', icon: HeartPulse },
  { id: 'hypertension', label: 'Seguimiento HTA', icon: Activity },
  { id: 'alerts', label: 'Alertas Clínicas', icon: BellRing },
  { id: 'reports', label: 'Reportes', icon: FileBarChart2 },
  { id: 'admin', label: 'Administración', icon: Settings, roles: ['administrador'] },
];

export function AppShell({
  activeSection,
  onNavigate,
  breadcrumb,
  children,
}: {
  activeSection: NavSection;
  onNavigate: (s: NavSection) => void;
  breadcrumb: string;
  children: React.ReactNode;
}) {
  const { user, organizations, logout, refreshSession } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { notify } = useToast();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [mfaSecret, setMfaSecret] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');

  const visibleNav = NAV_ITEMS.filter((item) => !item.roles || (user && item.roles.includes(user.role)));

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      notify('success', 'Contraseña actualizada correctamente.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error actualizando contraseña.');
    }
  };

  const handleStartMfa = async () => {
    try {
      const res = await apiRequest<{ secret: string }>('/api/auth/mfa/enroll', { method: 'POST' });
      setMfaSecret(res.secret);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error generando secreto MFA.');
    }
  };

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiRequest('/api/auth/mfa/verify', {
        method: 'POST',
        body: JSON.stringify({ code: mfaCode }),
      });
      notify('success', 'Autenticación multifactor activada.');
      setMfaSecret(null);
      setMfaCode('');
      await refreshSession();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Código TOTP incorrecto.');
    }
  };

  const handleDisableMfa = async () => {
    try {
      await apiRequest('/api/auth/mfa/disable', { method: 'POST' });
      notify('info', 'MFA desactivado.');
      await refreshSession();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error desactivando MFA.');
    }
  };

  const SidebarContent = (
    <div className="flex h-full flex-col justify-between bg-white px-3 py-4 dark:bg-slate-900">
      <div>
        <div className="mb-6 flex items-center justify-between px-2">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-700 text-white dark:bg-sky-600">
              <Activity className="h-4 w-4" />
            </div>
            <span className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap">
              VitalControl
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 lg:hidden dark:text-slate-400 dark:hover:bg-slate-800 cursor-pointer"
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="space-y-1">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onNavigate(item.id);
                  setSidebarOpen(false);
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors cursor-pointer',
                  active
                    ? 'bg-sky-50 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300'
                    : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/70'
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-sky-700 dark:text-sky-400' : 'text-slate-500 dark:text-slate-400')} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <div className="px-2 text-xs text-slate-500 dark:text-slate-400">
          <p className="font-medium text-slate-800 dark:text-slate-200 truncate">
            {user?.nombres} {user?.apellidos}
          </p>
          <p className="truncate">
            {user?.roleNombre} · {organizations[0]?.nombre || 'Red Sanitaria'}
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            onClick={() => setProfileModalOpen(true)}
          >
            <Shield className="h-3.5 w-3.5" />
            <span>Seguridad</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={logout} title="Cerrar sesión">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Sidebar escritorio */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 lg:block dark:border-slate-800">
        <div className="sticky top-0 h-screen">{SidebarContent}</div>
      </aside>

      {/* Drawer móvil/tablet */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="fixed inset-0 bg-slate-950/50" onClick={() => setSidebarOpen(false)} />
          <aside className="relative z-50 w-64 border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            {SidebarContent}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar de 3 zonas */}
        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-xs sm:px-6 dark:border-slate-800 dark:bg-slate-900/95">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden dark:text-slate-300 dark:hover:bg-slate-800 cursor-pointer"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 text-sm text-slate-600 dark:text-slate-400 truncate">
              <span className="font-medium text-slate-900 dark:text-slate-100">VitalControl</span>
              <span className="mx-2" aria-hidden="true">/</span>
              <span>{breadcrumb}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden text-xs text-slate-500 sm:inline dark:text-slate-400">
              {user?.nombres} {user?.apellidos} · {user?.roleNombre}
            </span>
            <Button variant="secondary" size="sm" onClick={toggleTheme}>
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              <span className="hidden sm:inline">{theme === 'dark' ? 'Claro' : 'Oscuro'}</span>
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 sm:p-6">{children}</main>
      </div>

      <Modal
        open={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        title="Seguridad de cuenta y contraseña"
      >
        <div className="space-y-6">
          <form onSubmit={handleChangePassword} className="space-y-3 border-b border-slate-200 pb-5 dark:border-slate-800">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Cambiar contraseña</h4>
            <div>
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">Contraseña actual</label>
              <Input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">
                Nueva contraseña (mín. 10 caracteres, 1 mayúscula y 1 número)
              </label>
              <Input
                type="password"
                required
                minLength={10}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <Button type="submit" size="sm">
              Actualizar contraseña
            </Button>
          </form>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Autenticación multifactor (TOTP)
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Estado actual: {user?.mfaEnabled ? 'Activada en esta cuenta' : 'No activada'}
            </p>
            {user?.mfaEnabled ? (
              <Button variant="danger" size="sm" onClick={handleDisableMfa}>
                Desactivar MFA
              </Button>
            ) : mfaSecret ? (
              <form onSubmit={handleVerifyMfa} className="space-y-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800">
                  <p className="mb-1 text-slate-600 dark:text-slate-300">
                    Agregue esta clave secreta en Google Authenticator o Authy:
                  </p>
                  <p className="font-mono text-sm font-semibold text-slate-900 dark:text-white select-all">
                    {mfaSecret}
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">
                    Ingrese el código de 6 dígitos generado
                  </label>
                  <Input
                    required
                    maxLength={6}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value)}
                    className="font-mono"
                    placeholder="123456"
                  />
                </div>
                <Button type="submit" size="sm">
                  Confirmar y activar MFA
                </Button>
              </form>
            ) : (
              <Button variant="secondary" size="sm" onClick={handleStartMfa}>
                Configurar MFA TOTP
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
