import React, { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, FileText } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { exportReportCsv, exportReportExcel, exportReportPdf, ReportRow } from '../../lib/exports.ts';
import { formatDateTimeEC } from '../../lib/utils.ts';
import { Organization, Patient } from '../../types/clinical.ts';
import { AlertIndicator, Button, Input, Select, Surface, useToast } from '../ui/Primitives.tsx';

interface StatSummary {
  count: number;
  mean: number | null;
  median: number | null;
  stdDev: number | null;
  min: number | null;
  max: number | null;
}

interface ReportResponse {
  reportType: string;
  anonymized: boolean;
  rows: ReportRow[];
  stats: {
    indicadoresPorPaciente: {
      pacientesUnicosEvaluados: number;
      pacientesConAntecedenteHta: number;
      porcentajeHtaEnPoblacion: number;
    };
    indicadoresPorMedicion: {
      totalMediciones: number;
      pas: StatSummary;
      pad: StatSummary;
      fc: StatSummary;
      spo2: StatSummary;
      imc: StatSummary;
    };
    distribucionAlertas: Array<{
      nivel: string;
      frecuenciaAbsoluta: number;
      frecuenciaRelativa: number;
      porcentaje: number;
    }>;
    productividadPorProfesional: Array<{
      profesional: string;
      controles: number;
      porcentaje: number;
    }>;
  };
}

export function ReportsView() {
  const { user } = useAuth();
  const { notify } = useToast();

  const [reportType, setReportType] = useState('diario');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [patientId, setPatientId] = useState('');
  const [anonymized, setAnonymized] = useState(
    !user?.permisos.includes('reports:export_identifiable')
  );

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [data, setData] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const canIdentifiable = Boolean(user?.permisos.includes('reports:export_identifiable'));

  const loadReport = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        type: reportType,
        anonymized: String(anonymized || !canIdentifiable),
      });
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (organizationId) params.set('organizationId', organizationId);
      if (patientId) params.set('patientId', patientId);
      const res = await apiRequest<ReportResponse>(`/api/reports/generate?${params.toString()}`);
      setData(res);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error generando reporte.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    Promise.all([
      apiRequest<{ items: Organization[] }>('/api/admin/organizations'),
      apiRequest<{ items: Patient[] }>('/api/patients?pageSize=100'),
    ])
      .then(([oRes, pRes]) => {
        setOrgs(oRes.items);
        setPatients(pRes.items);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadReport();
  }, [reportType, startDate, endDate, organizationId, patientId, anonymized]);

  const handleExport = async (fmt: 'pdf' | 'excel' | 'csv') => {
    if (!data) return;
    try {
      if (fmt === 'pdf') await exportReportPdf(data.rows, reportType, data.anonymized);
      else if (fmt === 'excel') await exportReportExcel(data.rows, reportType, data.anonymized);
      else await exportReportCsv(data.rows, reportType, data.anonymized);
      notify('success', `Reporte exportado en formato ${fmt.toUpperCase()} y registrado en auditoría.`);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error al exportar reporte.');
    }
  };

  const renderStatRow = (label: string, unit: string, s: StatSummary) => (
    <tr key={label} className="border-b border-slate-100 dark:border-slate-800">
      <td className="py-2 pr-4 font-medium">{label} ({unit})</td>
      <td className="py-2 pr-4 text-right font-mono tabular-nums">{s.count}</td>
      <td className="py-2 pr-4 text-right font-mono tabular-nums">{s.mean ?? '—'}</td>
      <td className="py-2 pr-4 text-right font-mono tabular-nums">{s.median ?? '—'}</td>
      <td className="py-2 pr-4 text-right font-mono tabular-nums">{s.stdDev ?? '—'}</td>
      <td className="py-2 pr-4 text-right font-mono tabular-nums">{s.min ?? '—'}</td>
      <td className="py-2 text-right font-mono tabular-nums">{s.max ?? '—'}</td>
    </tr>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Reportes Clínicos y Bioestadística
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Indicadores diferenciados por paciente y por medición · Exportación auditada y modalidad anonimizada (LOPDP)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => handleExport('csv')} disabled={!data?.rows.length}>
            <Download className="h-4 w-4" />
            <span>CSV</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={() => handleExport('excel')} disabled={!data?.rows.length}>
            <FileSpreadsheet className="h-4 w-4" />
            <span>Excel</span>
          </Button>
          <Button size="sm" onClick={() => handleExport('pdf')} disabled={!data?.rows.length}>
            <FileText className="h-4 w-4" />
            <span>PDF</span>
          </Button>
        </div>
      </div>

      <Surface className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="mb-1 block text-xs font-medium">Tipo de reporte</label>
            <Select value={reportType} onChange={(e) => setReportType(e.target.value)}>
              <option value="diario">Diario de atenciones</option>
              <option value="mensual">Mensual / Anual consolidado</option>
              <option value="hipertensos">Pacientes con HTA</option>
              <option value="fuera_de_rango">Mediciones fuera de rango</option>
              <option value="individual">Individual por paciente</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Desde</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Hasta</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Establecimiento</label>
            <Select value={organizationId} onChange={(e) => setOrganizationId(e.target.value)}>
              <option value="">Todos</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Paciente específico</label>
            <Select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              <option value="">Todos</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.apellidos}, {p.nombres}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={anonymized || !canIdentifiable}
              disabled={!canIdentifiable}
              onChange={(e) => setAnonymized(e.target.checked)}
              className="h-4 w-4 rounded"
            />
            <span>
              Exportación anonimizada para análisis epidemiológico e investigación
              {!canIdentifiable && ' (obligatoria para su rol)'}
            </span>
          </label>
          <span className="text-slate-500">
            Toda descarga queda registrada con usuario, fecha y alcance en auditoría.
          </span>
        </div>
      </Surface>

      {data && (
        <>
          {/* Indicadores separados: por paciente vs por medición */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <Surface className="lg:col-span-4 space-y-3">
              <h2 className="text-sm font-semibold text-sky-700 uppercase tracking-wider dark:text-sky-400">
                Indicadores por Paciente Único
              </h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Pacientes únicos evaluados</span>
                  <span className="font-mono font-semibold">{data.stats.indicadoresPorPaciente.pacientesUnicosEvaluados}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Con antecedente HTA</span>
                  <span className="font-mono font-semibold">{data.stats.indicadoresPorPaciente.pacientesConAntecedenteHta}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600 dark:text-slate-400">Prevalencia HTA en muestra</span>
                  <span className="font-mono font-semibold">{data.stats.indicadoresPorPaciente.porcentajeHtaEnPoblacion}%</span>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-3 dark:border-slate-800">
                <h3 className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Productividad por profesional (controles)
                </h3>
                <div className="space-y-1 text-xs">
                  {data.stats.productividadPorProfesional.map((pr) => (
                    <div key={pr.profesional} className="flex justify-between">
                      <span className="truncate pr-2">{pr.profesional}</span>
                      <span className="font-mono tabular-nums">
                        {pr.controles} ({pr.porcentaje}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </Surface>

            <Surface className="lg:col-span-8">
              <h2 className="mb-3 text-sm font-semibold text-sky-700 uppercase tracking-wider dark:text-sky-400">
                Estadística Descriptiva por Medición (N = {data.stats.indicadoresPorMedicion.totalMediciones} controles)
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Parámetro</th>
                      <th className="py-2 pr-4 text-right font-medium">n</th>
                      <th className="py-2 pr-4 text-right font-medium">Media</th>
                      <th className="py-2 pr-4 text-right font-medium">Mediana</th>
                      <th className="py-2 pr-4 text-right font-medium">DE</th>
                      <th className="py-2 pr-4 text-right font-medium">Mín</th>
                      <th className="py-2 text-right font-medium">Máx</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renderStatRow('PAS promedio', 'mmHg', data.stats.indicadoresPorMedicion.pas)}
                    {renderStatRow('PAD promedio', 'mmHg', data.stats.indicadoresPorMedicion.pad)}
                    {renderStatRow('Frecuencia cardíaca', 'lpm', data.stats.indicadoresPorMedicion.fc)}
                    {renderStatRow('Saturación O₂', '%', data.stats.indicadoresPorMedicion.spo2)}
                    {renderStatRow('IMC', 'kg/m²', data.stats.indicadoresPorMedicion.imc)}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-200 pt-3 text-xs sm:grid-cols-5 dark:border-slate-800">
                {data.stats.distribucionAlertas.map((d) => (
                  <div key={d.nivel} className="rounded border border-slate-200 p-2 dark:border-slate-800">
                    <div className="capitalize font-medium">{d.nivel}</div>
                    <div className="mt-1 font-mono text-slate-600 dark:text-slate-300">
                      {d.frecuenciaAbsoluta} ({d.porcentaje}%) · fr {d.frecuenciaRelativa}
                    </div>
                  </div>
                ))}
              </div>
            </Surface>
          </div>

          {/* Tabla detallada */}
          <Surface>
            <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">
              Detalle de mediciones ({data.rows.length})
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Código</th>
                    <th className="py-2 pr-3 font-medium">Paciente</th>
                    <th className="py-2 pr-3 font-medium">Edad/Sexo</th>
                    <th className="py-2 pr-3 font-medium">Fecha/Hora</th>
                    <th className="py-2 pr-3 text-right font-medium">PAS/PAD</th>
                    <th className="py-2 pr-3 text-right font-medium">PAM</th>
                    <th className="py-2 pr-3 text-right font-medium">FC</th>
                    <th className="py-2 pr-3 text-right font-medium">SpO₂</th>
                    <th className="py-2 pr-3 text-right font-medium">IMC</th>
                    <th className="py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {loading ? (
                    <tr>
                      <td colSpan={10} className="py-6 text-center text-slate-500">
                        Calculando reporte...
                      </td>
                    </tr>
                  ) : data.rows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-6 text-center text-slate-500">
                        Sin registros para los criterios seleccionados.
                      </td>
                    </tr>
                  ) : (
                    data.rows.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2 pr-3 font-mono">{r.pacienteCodigo}</td>
                        <td className="py-2 pr-3 font-medium">{r.pacienteNombre}</td>
                        <td className="py-2 pr-3 font-mono">
                          {r.edadAnios}a · {r.sexo[0].toUpperCase()}
                        </td>
                        <td className="py-2 pr-3 font-mono">{formatDateTimeEC(r.fechaMedicion)}</td>
                        <td className="py-2 pr-3 text-right font-mono">
                          {r.pas !== null && r.pad !== null ? `${r.pas}/${r.pad}` : '—'}
                        </td>
                        <td className="py-2 pr-3 text-right font-mono">{r.pam ?? '—'}</td>
                        <td className="py-2 pr-3 text-right font-mono">{r.fc ?? '—'}</td>
                        <td className="py-2 pr-3 text-right font-mono">{r.spo2 !== null ? `${r.spo2}%` : '—'}</td>
                        <td className="py-2 pr-3 text-right font-mono">{r.imc ?? '—'}</td>
                        <td className="py-2">
                          <AlertIndicator level={r.nivelAlerta as 'verde' | 'amarillo' | 'naranja' | 'rojo' | 'gris'} compact />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Surface>
        </>
      )}
    </div>
  );
}
