import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, HeartPulse, Plus, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatDateTimeEC } from '../../lib/utils.ts';
import { VitalSignRecord } from '../../types/clinical.ts';
import { AlertIndicator, Button, Input, Select, Surface } from '../ui/Primitives.tsx';
import { NavSection } from '../layout/AppShell.tsx';

interface DashboardData {
  kpis: {
    totalPatients: number;
    attendedToday: number;
    totalControls: number;
    hypertensivePatients: number;
    pendingAlerts: number;
    pendingFollowups: number;
    avgPas: number | null;
    avgPad: number | null;
  };
  sexDistribution: Array<{ name: string; value: number }>;
  ageDistribution: Array<{ grupo: string; total: number }>;
  bpTrend: Array<{ label: string; pasPromedio: number | null; padPromedio: number | null; controles: number }>;
  recentControls: VitalSignRecord[];
  filtersData: {
    professionals: Array<{ id: string; nombre: string }>;
    organizations: Array<{ id: string; nombre: string }>;
  };
}

const PIE_COLORS = ['#0284c7', '#0d9488', '#64748b'];

export function DashboardView({
  onNavigate,
  onSelectPatient,
}: {
  onNavigate: (section: NavSection) => void;
  onSelectPatient: (patientId: string) => void;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [professionalId, setProfessionalId] = useState('');
  const [period, setPeriod] = useState<'diario' | 'semanal' | 'mensual'>('diario');

  const canWrite = user && user.role !== 'consulta';

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (organizationId) params.set('organizationId', organizationId);
      if (professionalId) params.set('professionalId', professionalId);
      params.set('period', period);
      const res = await apiRequest<DashboardData>(`/api/dashboard/summary?${params.toString()}`);
      setData(res);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [startDate, endDate, organizationId, professionalId, period]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Panel de Monitoreo Clínico
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Resumen operativo de signos vitales, hipertensión arterial y alertas activas · Zona horaria America/Guayaquil
          </p>
        </div>

        {canWrite && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button variant="secondary" onClick={() => onNavigate('patients')}>
              <UserPlus className="h-4 w-4" />
              <span>Nuevo paciente</span>
            </Button>
            <Button onClick={() => onNavigate('vitals')}>
              <HeartPulse className="h-4 w-4" />
              <span>Registrar signos vitales</span>
            </Button>
          </div>
        )}
      </div>

      {/* Filtros de panel */}
      <Surface className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Desde</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Hasta</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Establecimiento</label>
            <Select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
              <option value="">Todos los autorizados</option>
              {data?.filtersData.organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Profesional</label>
            <Select value={professionalId} onChange={(e) => setProfessionalId(e.target.value)}>
              <option value="">Todos los profesionales</option>
              {data?.filtersData.professionals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">Agrupación temporal</label>
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {(['diario', 'semanal', 'mensual'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer ${
                    period === p
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Surface>

      {/* Indicadores principales */}
      {loading && !data ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="h-24 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            />
          ))}
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <Surface className="p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Pacientes registrados</p>
              <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-white">
                {data.kpis.totalPatients}
              </p>
            </Surface>
            <Surface className="p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Atendidos hoy</p>
              <p className="mt-2 font-mono text-2xl font-semibold text-sky-700 tabular-nums dark:text-sky-400">
                {data.kpis.attendedToday}
              </p>
            </Surface>
            <Surface className="p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Controles realizados</p>
              <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-white">
                {data.kpis.totalControls}
              </p>
            </Surface>
            <Surface className="p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Antecedente de HTA</p>
              <p className="mt-2 font-mono text-2xl font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                {data.kpis.hypertensivePatients}
              </p>
            </Surface>
            <Surface className="p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">Alertas pendientes</p>
              <p className="mt-2 font-mono text-2xl font-semibold text-amber-700 tabular-nums dark:text-amber-400">
                {data.kpis.pendingAlerts}
              </p>
            </Surface>
            <Surface className="p-4">
              <p className="text-xs text-slate-500 dark:text-slate-400">PA promedio (mmHg)</p>
              <p className="mt-2 font-mono text-2xl font-semibold text-slate-900 tabular-nums dark:text-white">
                {data.kpis.avgPas !== null && data.kpis.avgPad !== null
                  ? `${data.kpis.avgPas}/${data.kpis.avgPad}`
                  : '—'}
              </p>
            </Surface>
          </div>

          {/* Gráficos principales */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <Surface className="lg:col-span-8">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                    Tendencia de presión arterial promedio y volumen de controles
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    PAS y PAD promedio (mmHg) según filtro seleccionado
                  </p>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Pendientes seguimiento: <strong className="font-mono">{data.kpis.pendingFollowups}</strong>
                </span>
              </div>
              <div className="h-72 w-full">
                {data.bpTrend.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    No existen mediciones en el rango seleccionado.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.bpTrend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} domain={[50, 200]} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="pasPromedio" name="PAS (mmHg)" stroke="#0284c7" strokeWidth={2.2} dot={{ r: 3 }} />
                      <Line type="monotone" dataKey="padPromedio" name="PAD (mmHg)" stroke="#0d9488" strokeWidth={2.2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Surface>

            <Surface className="lg:col-span-4">
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Distribución por sexo y grupo etario
              </h2>
              <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                Población única de pacientes autorizados
              </p>
              <div className="h-36 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.sexDistribution}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={32}
                      outerRadius={54}
                      paddingAngle={2}
                    >
                      {data.sexDistribution.map((_entry, index) => (
                        <Cell key={index} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 h-32 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.ageDistribution} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
                    <XAxis dataKey="grupo" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="total" name="Pacientes" fill="#0369a1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Surface>
          </div>

          {/* Últimos controles */}
          <Surface>
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  Últimos controles registrados
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Haga clic en un paciente para abrir su ficha clínica completa
                </p>
              </div>
              {canWrite && (
                <Button variant="secondary" size="sm" onClick={() => onNavigate('vitals')}>
                  <Plus className="h-3.5 w-3.5" />
                  <span>Nuevo control</span>
                </Button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="py-2.5 pr-4 font-medium">Fecha / Hora</th>
                    <th className="py-2.5 pr-4 font-medium">Paciente</th>
                    <th className="py-2.5 pr-4 font-medium text-right">PA (mmHg)</th>
                    <th className="py-2.5 pr-4 font-medium text-right">FC (lpm)</th>
                    <th className="py-2.5 pr-4 font-medium text-right">SpO₂ (%)</th>
                    <th className="py-2.5 pr-4 font-medium">Profesional</th>
                    <th className="py-2.5 font-medium">Clasificación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.recentControls.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        Sin controles registrados en este criterio.
                      </td>
                    </tr>
                  ) : (
                    data.recentControls.map((c) => (
                      <tr
                        key={c.id}
                        className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      >
                        <td className="py-2.5 pr-4 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                          {formatDateTimeEC(c.fecha_medicion)}
                        </td>
                        <td className="py-2.5 pr-4">
                          <button
                            type="button"
                            onClick={() => onSelectPatient(c.patient_id)}
                            className="font-medium text-sky-700 hover:underline dark:text-sky-400 text-left cursor-pointer"
                          >
                            {c.patient_nombres} {c.patient_apellidos}
                          </button>
                          <div className="text-xs text-slate-500 dark:text-slate-400">
                            {c.codigo_interno} · {c.organization_nombre}
                          </div>
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                          {c.pas_promedio !== null && c.pad_promedio !== null
                            ? `${c.pas_promedio}/${c.pad_promedio}`
                            : '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                          {c.frecuencia_cardiaca ?? '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-mono tabular-nums">
                          {c.saturacion_o2 !== null ? `${c.saturacion_o2}%` : '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-xs text-slate-600 dark:text-slate-300">
                          {c.recorder_nombre}
                        </td>
                        <td className="py-2.5">
                          <AlertIndicator level={c.nivel_alerta_global} compact />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Surface>
        </>
      ) : null}
    </div>
  );
}
