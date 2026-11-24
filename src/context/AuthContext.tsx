import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { apiRequest, setUnauthorizedHandler } from '../lib/api.ts';
import { AuthUser, Organization } from '../types/clinical.ts';
import { useToast } from '../components/ui/Primitives.tsx';

interface AuthContextValue {
  loading: boolean;
  requiresInitialSetup: boolean;
  requiresBootstrapPasscode: boolean;
  user: AuthUser | null;
  organizations: Organization[];
  settings: Record<string, string>;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  loading: true,
  requiresInitialSetup: false,
  requiresBootstrapPasscode: false,
  user: null,
  organizations: [],
  settings: {},
  refreshSession: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { notify } = useToast();
  const [loading, setLoading] = useState(true);
  const [requiresInitialSetup, setRequiresInitialSetup] = useState(false);
  const [requiresBootstrapPasscode, setRequiresBootstrapPasscode] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const lastActivityRef = useRef(Date.now());

  const refreshSession = useCallback(async () => {
    try {
      const status = await apiRequest<{
        requiresInitialSetup: boolean;
        requiresBootstrapPasscode: boolean;
        authenticated: boolean;
      }>('/api/auth/status');

      setRequiresInitialSetup(status.requiresInitialSetup);
      setRequiresBootstrapPasscode(status.requiresBootstrapPasscode);

      if (status.authenticated) {
        const me = await apiRequest<{
          user: AuthUser;
          organizations: Organization[];
          settings: Record<string, string>;
        }>('/api/auth/me');
        setUser(me.user);
        setOrganizations(me.organizations);
        setSettings(me.settings);
        lastActivityRef.current = Date.now();
      } else {
        setUser(null);
        setOrganizations([]);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignorar si ya expiró
    }
    setUser(null);
    setOrganizations([]);
    await refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      notify('info', 'Su sesión ha expirado o fue cerrada por seguridad.');
    });
    refreshSession();
  }, [refreshSession, notify]);

  // Vigilancia de inactividad en el cliente alineada con el servidor
  useEffect(() => {
    if (!user) return;
    const idleMinutes = Math.max(5, Number(settings.sesion_inactividad_min || 30));
    const bump = () => {
      lastActivityRef.current = Date.now();
    };
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, bump, { passive: true }));

    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current > idleMinutes * 60 * 1000) {
        notify('info', 'Sesión cerrada automáticamente por inactividad.');
        logout();
      }
    }, 30000);

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, bump));
      clearInterval(interval);
    };
  }, [user, settings.sesion_inactividad_min, logout, notify]);

  return (
    <AuthContext.Provider
      value={{
        loading,
        requiresInitialSetup,
        requiresBootstrapPasscode,
        user,
        organizations,
        settings,
        refreshSession,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
