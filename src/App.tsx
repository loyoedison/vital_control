/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useState } from 'react';
import { AdminView } from './components/admin/AdminView.tsx';
import { AlertsView } from './components/alerts/AlertsView.tsx';
import { LoginView } from './components/auth/LoginView.tsx';
import { DashboardView } from './components/dashboard/DashboardView.tsx';
import { HypertensionView } from './components/hypertension/HypertensionView.tsx';
import { AppShell, NavSection } from './components/layout/AppShell.tsx';
import { PatientDetailView } from './components/patients/PatientDetailView.tsx';
import { PatientsView } from './components/patients/PatientsView.tsx';
import { ReportsView } from './components/reports/ReportsView.tsx';
import { ToastProvider } from './components/ui/Primitives.tsx';
import { VitalsFormView } from './components/vitals/VitalsFormView.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { ThemeProvider } from './context/ThemeContext.tsx';

function VitalControlWorkspace() {
  const { loading, user } = useAuth();
  const [section, setSection] = useState<NavSection>('dashboard');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [vitalsPatientId, setVitalsPatientId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-400">
        Verificando sesión clínica...
      </div>
    );
  }

  if (!user) {
    return <LoginView />;
  }

  const openPatientDetail = (id: string) => {
    setSelectedPatientId(id);
    setSection('patients');
  };

  const openVitalsForPatient = (id: string) => {
    setVitalsPatientId(id);
    setSection('vitals');
  };

  const handleNavigate = (next: NavSection) => {
    if (next !== 'patients') setSelectedPatientId(null);
    if (next !== 'vitals') setVitalsPatientId(null);
    setSection(next);
  };

  const breadcrumbs: Record<NavSection, string> = {
    dashboard: 'Panel Principal',
    patients: selectedPatientId ? 'Pacientes / Ficha Clínica Individual' : 'Pacientes',
    vitals: 'Registro de Signos Vitales',
    hypertension: 'Seguimiento de Hipertensión Arterial',
    alerts: 'Alertas Clínicas',
    reports: 'Reportes y Estadísticas',
    admin: 'Administración y Seguridad',
  };

  return (
    <AppShell
      activeSection={section}
      onNavigate={handleNavigate}
      breadcrumb={breadcrumbs[section]}
    >
      {section === 'dashboard' && (
        <DashboardView onNavigate={handleNavigate} onSelectPatient={openPatientDetail} />
      )}
      {section === 'patients' &&
        (selectedPatientId ? (
          <PatientDetailView
            patientId={selectedPatientId}
            onBack={() => setSelectedPatientId(null)}
            onRecordVitals={openVitalsForPatient}
          />
        ) : (
          <PatientsView onOpenPatient={openPatientDetail} />
        ))}
      {section === 'vitals' && (
        <VitalsFormView
          preselectedPatientId={vitalsPatientId}
          onSuccessPatient={openPatientDetail}
        />
      )}
      {section === 'hypertension' && <HypertensionView />}
      {section === 'alerts' && <AlertsView onOpenPatient={openPatientDetail} />}
      {section === 'reports' && <ReportsView />}
      {section === 'admin' && user.role === 'administrador' && <AdminView />}
    </AppShell>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <VitalControlWorkspace />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
