import React, { useState } from 'react';
import { Activity, KeyRound, Lock, Mail, Moon, ShieldCheck, Sun, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { useTheme } from '../../context/ThemeContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { Button, Input, Surface, useToast } from '../ui/Primitives.tsx';

export function LoginView() {
  const { requiresInitialSetup, requiresBootstrapPasscode, refreshSession } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { notify } = useToast();

  const [mode, setMode] = useState<'login' | 'recover' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nombres, setNombres] = useState('');
  const [apellidos, setApellidos] = useState('');
  const [passcode, setPasscode] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [mfaStep, setMfaStep] = useState(false);
  const [recoveryToken, setRecoveryToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [previewTokenHint, setPreviewTokenHint] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSetupAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await apiRequest('/api/auth/setup-admin', {
        method: 'POST',
        body: JSON.stringify({ email, password, nombres, apellidos, passcode }),
      });
      notify('success', 'Administrador inicial configurado y datos de demostración listos.');
      await refreshSession();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error al crear administrador.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ ok?: boolean; mfaRequired?: boolean; message?: string }>(
        '/api/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({
            email,
            password,
            totpCode: mfaStep ? totpCode : undefined,
          }),
        }
      );
      if (res.mfaRequired) {
        setMfaStep(true);
        notify('info', res.message || 'Ingrese su código de verificación MFA.');
      } else {
        notify('success', 'Sesión clínica iniciada.');
        await refreshSession();
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Credenciales incorrectas.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ message: string; previewRecoveryToken?: string }>('/api/auth/recover', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      notify('info', res.message);
      if (res.previewRecoveryToken) {
        setPreviewTokenHint(res.previewRecoveryToken);
        setRecoveryToken(res.previewRecoveryToken);
      }
      setMode('reset');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error solicitando recuperación.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ email, token: recoveryToken, newPassword }),
      });
      notify('success', 'Contraseña restablecida. Ya puede iniciar sesión.');
      setPreviewTokenHint(null);
      setMode('login');
      setPassword('');
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'No se pudo restablecer la contraseña.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col justify-between px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between border-b border-slate-200 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-700 text-white dark:bg-sky-600">
              <Activity className="h-5 w-5" />
            </div>
            <span className="font-display text-lg font-bold tracking-tight whitespace-nowrap">VitalControl</span>
          </div>
          <Button variant="secondary" size="sm" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            <span>{theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}</span>
          </Button>
        </header>

        <div className="my-8 grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12">
          <div className="flex flex-col justify-center space-y-5 lg:col-span-6">
            <p className="text-xs font-semibold tracking-wider text-sky-700 uppercase dark:text-sky-400">
              Sistema de Información Sanitaria · America/Guayaquil
            </p>
            <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl dark:text-white [text-wrap:balance]">
              Registro y monitoreo clínico de signos vitales e hipertensión arterial
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Plataforma institucional orientada a equipos médicos y de enfermería para la captura estructurada de
              constantes vitales, alertas semaforizadas basadas en guías clínicas, trazabilidad no destructiva y
              exportación estadística conforme a la LOPDP.
            </p>
            <div className="grid grid-cols-1 gap-3 border-t border-slate-200 pt-5 sm:grid-cols-3 dark:border-slate-800">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Trazabilidad clínica</p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">Registros inmutables</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Control de acceso</p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">RBAC + MFA TOTP</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Soporte decisional</p>
                <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">Alertas configurables</p>
              </div>
            </div>
          </div>

          <div className="flex items-center lg:col-span-6">
            <Surface className="w-full p-6 sm:p-8">
              {requiresInitialSetup ? (
                <form onSubmit={handleSetupAdmin} className="space-y-4">
                  <div className="flex items-center gap-2 text-sky-700 dark:text-sky-400">
                    <UserPlus className="h-5 w-5" />
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                      Configuración inicial del Administrador
                    </h2>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Cree la cuenta administradora principal para habilitar VitalControl y cargar pacientes ficticios de
                    demostración.
                  </p>

                  {errorMsg && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                      {errorMsg}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Nombres
                      </label>
                      <Input required value={nombres} onChange={(e) => setNombres(e.target.value)} placeholder="Dra. Ana" />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Apellidos
                      </label>
                      <Input required value={apellidos} onChange={(e) => setApellidos(e.target.value)} placeholder="Vega Torres" />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Correo institucional
                    </label>
                    <Input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@vitalcontrol.ec"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Contraseña (mín. 10 caracteres, 1 mayúscula y 1 número)
                    </label>
                    <Input
                      type="password"
                      required
                      minLength={10}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                    />
                  </div>

                  {requiresBootstrapPasscode && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Código maestro de autorización
                      </label>
                      <Input
                        type="password"
                        required
                        value={passcode}
                        onChange={(e) => setPasscode(e.target.value)}
                        placeholder="Código configurado en variables de entorno"
                      />
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? 'Configurando...' : 'Crear cuenta administradora e ingresar'}
                  </Button>
                </form>
              ) : mode === 'login' ? (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div className="flex items-center gap-2 text-sky-700 dark:text-sky-400">
                    <ShieldCheck className="h-5 w-5" />
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                      {mfaStep ? 'Verificación multifactor (MFA)' : 'Acceso para personal sanitario'}
                    </h2>
                  </div>

                  {errorMsg && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                      {errorMsg}
                    </div>
                  )}

                  {!mfaStep ? (
                    <>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                          Correo electrónico
                        </label>
                        <div className="relative">
                          <Mail className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                          <Input
                            type="email"
                            required
                            className="pl-9"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="usuario@establecimiento.ec"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                          Contraseña
                        </label>
                        <div className="relative">
                          <Lock className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
                          <Input
                            type="password"
                            required
                            className="pl-9"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••••••"
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Código TOTP de 6 dígitos
                      </label>
                      <Input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        required
                        className="font-mono text-center text-lg tracking-widest"
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value)}
                        placeholder="000000"
                      />
                    </div>
                  )}

                  <Button type="submit" className="w-full" disabled={submitting}>
                    {submitting ? 'Verificando...' : mfaStep ? 'Validar código MFA' : 'Iniciar sesión'}
                  </Button>

                  <div className="flex items-center justify-between pt-2 text-xs">
                    {mfaStep ? (
                      <button
                        type="button"
                        onClick={() => {
                          setMfaStep(false);
                          setTotpCode('');
                        }}
                        className="text-sky-700 hover:underline dark:text-sky-400 cursor-pointer"
                      >
                        Volver al inicio
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setErrorMsg(null);
                          setMode('recover');
                        }}
                        className="text-sky-700 hover:underline dark:text-sky-400 cursor-pointer"
                      >
                        ¿Olvidó su contraseña?
                      </button>
                    )}
                    <span className="text-slate-500 dark:text-slate-400">Sesión cifrada HttpOnly</span>
                  </div>
                </form>
              ) : mode === 'recover' ? (
                <form onSubmit={handleRecover} className="space-y-4">
                  <div className="flex items-center gap-2 text-sky-700 dark:text-sky-400">
                    <KeyRound className="h-5 w-5" />
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                      Recuperación de contraseña
                    </h2>
                  </div>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Ingrese su correo registrado para generar un código temporal de restablecimiento.
                  </p>
                  {errorMsg && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                      {errorMsg}
                    </div>
                  )}
                  <Input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="usuario@establecimiento.ec"
                  />
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" onClick={() => setMode('login')}>
                      Cancelar
                    </Button>
                    <Button type="submit" className="flex-1" disabled={submitting}>
                      Solicitar recuperación
                    </Button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleResetPassword} className="space-y-4">
                  <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                    Restablecer contraseña
                  </h2>
                  {previewTokenHint && (
                    <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
                      Código temporal de verificación (entorno local): <span className="font-mono font-semibold">{previewTokenHint}</span>
                    </div>
                  )}
                  {errorMsg && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                      {errorMsg}
                    </div>
                  )}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Código de verificación
                    </label>
                    <Input
                      required
                      value={recoveryToken}
                      onChange={(e) => setRecoveryToken(e.target.value)}
                      className="font-mono"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300">
                      Nueva contraseña
                    </label>
                    <Input
                      type="password"
                      required
                      minLength={10}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Mín. 10 caracteres, 1 mayúscula y 1 número"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" onClick={() => setMode('login')}>
                      Volver
                    </Button>
                    <Button type="submit" className="flex-1" disabled={submitting}>
                      Actualizar contraseña
                    </Button>
                  </div>
                </form>
              )}
            </Surface>
          </div>
        </div>

        <footer className="border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          VitalControl · Sistema de Registro y Monitoreo de Signos Vitales · Datos clínicos ficticios para evaluación técnica.
        </footer>
      </div>
    </div>
  );
}
