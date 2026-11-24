import React, { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowLeft, Download, FileEdit, HeartPulse, Printer } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { exportPatientIndividualPdf } from '../../lib/exports.ts';
import { classifyBmiText, formatDateEC, formatDateTimeEC } from '../../lib/utils.ts';
import {
  ClinicalAlertRecord,
  HypertensionFollowupRecord,
  Patient,
  VitalSignRecord,
} from '../../types/clinical.ts';
import { AlertIndicator, Button, Input, Modal, Select, Surface, Textarea, useToast } from '../ui/Primitives.tsx';

interface PatientDetailPayload {
  patient: Patient;
  medicalHistory: Array<{
    id: string;
    tipo_registro: string;
    titulo: string;
    detalle: string;
    recorder_nombre: string;
    created_at: string;
  }>;
  vitalSigns: VitalSignRecord[];
  alerts: ClinicalAlertRecord[];
  hypertensionFollowups: HypertensionFollowupRecord[];
  appointments: Array<{
    id: string;
    fecha_programada: string;
    motivo: string;
    estado: string;
  }>;
}

export function PatientDetailView({
  patientId,
  onBack,
  onRecordVitals,
}: {
  patientId: string;
  onBack: () => void;
  onRecordVitals: (patientId: string) => void;
}) {
  const { user } = useAuth();
  const { notify } = useToast();
  const [data, setData] = useState<PatientDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [paramFilter, setParamFilter] = useState<'pa' | 'fc' | 'spo2' | 'imc'>('pa');

  const [amendModal, setAmendModal] = useState<VitalSignRecord | null>(null);
  const [amendField, setAmendField] = useState('observaciones_clinicas');
  const [amendValue, setAmendValue] = useState('');
  const [amendReason, setAmendReason] = useState('');

  const canWrite = user && user.role !== 'consulta';
  const canAmend = user && (user.role === 'administrador' || user.role === 'medico');

  const loadDetail = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<PatientDetailPayload>(`/api/patients/${patientId}`);
      setData(res);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error cargando ficha clínica.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
  }, [patientId]);

  const submitAmendment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amendModal) return;
    try {
      await apiRequest(`/api/vitals/${amendModal.id}/amend`, {
        method: 'POST',
        body: JSON.stringify({
          campoModificado: amendField,
          valorNuevo: amendValue,
          motivoCorreccion: amendReason,
        }),
      });
      notify('success', 'Enmienda clínica registrada preservando el valor original.');
      setAmendModal(null);
      setAmendValue('');
      setAmendReason('');
      loadDetail();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error registrando enmienda.');
    }
  };

  if (loading || !data) {
    return (
      <Surface className="py-12 text-center text-sm text-slate-500">
        Cargando ficha individual del paciente...
      </Surface>
    );
  }

  const { patient, medicalHistory, vitalSigns, alerts, hypertensionFollowups, appointments } = data;
  const filteredVitals = vitalSigns.filter((v) => !dateFrom || v.fecha_medicion.slice(0, 10) >= dateFrom);
  const latest = vitalSigns[0] || null;

  const chartSeries = [...filteredVitals]
    .reverse()
    .map((v) => ({
      fecha: formatDateEC(v.fecha_medicion),
      pas: v.pas_promedio,
      pad: v.pad_promedio,
      fc: v.frecuencia_cardiaca,
      spo2: v.saturacion_o2,
      imc: v.imc,
      peso: v.peso_kg,
    }));

  const calcAvg = (vals: Array<number | null>) => {
    const clean = vals.filter((x): x is number => x !== null);
    if (!clean.length) return '—';
    return (clean.reduce((a, b) => a + b, 0) / clean.length).toFixed(1);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 no-print">
        <Button variant="secondary" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          <span>Volver a pacientes</span>
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            <span>Imprimir ficha</span>
          </Button>
          {user?.permisos.includes('reports:export_identifiable') && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => exportPatientIndividualPdf(patient, filteredVitals)}
            >
              <Download className="h-4 w-4" />
              <span>Exportar PDF</span>
            </Button>
          )}
          {canWrite && (
            <Button size="sm" onClick={() => onRecordVitals(patient.id)}>
              <HeartPulse className="h-4 w-4" />
              <span>Nuevo control</span>
            </Button>
          )}
        </div>
      </div>

      {/* Cabecera clínica del paciente */}
      <Surface>
        <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-start dark:border-slate-800">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono font-semibold text-sky-700 dark:text-sky-400">{patient.codigoInterno}</span>
              <span>·</span>
              <span className="font-mono">HC: {patient.numeroHistoriaClinica}</span>
              <span>·</span>
              <span className="font-mono">ID: {patient.numeroIdentificacion}</span>
              <span>·</span>
              <span>{patient.activo ? 'Activo' : 'Inactivo'}</span>
            </div>
            <h1 className="mt-1 font-display text-2xl font-bold text-slate-900 dark:text-white">
              {patient.nombres} {patient.apellidos}
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              {patient.edadAnios} años ({formatDateEC(patient.fechaNacimiento)}) · Sexo:{' '}
              <span className="capitalize">{patient.sexo}</span> · {patient.organizationNombre} ({patient.altitudMsnm} msnm)
            </p>
          </div>
          {latest && <AlertIndicator level={latest.nivel_alerta_global} />}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Antecedentes clave</p>
            <p className="mt-1 font-medium">
              {[
                patient.antecedenteHta ? 'Hipertensión arterial' : null,
                patient.antecedenteDiabetes ? 'Diabetes mellitus' : null,
                patient.embarazoActual ? 'Gestación actual' : null,
                patient.condicionClinicaEspecial,
              ]
                .filter(Boolean)
                .join(' · ') || 'Ninguno registrado'}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Último control registrado</p>
            <p className="mt-1 font-mono tabular-nums">
              {latest
                ? `${formatDateTimeEC(latest.fecha_medicion)} · PA ${latest.pas_promedio ?? '—'}/${latest.pad_promedio ?? '—'} mmHg`
                : 'Sin controles previos'}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Promedios del periodo</p>
            <p className="mt-1 font-mono tabular-nums">
              PAS {calcAvg(filteredVitals.map((v) => v.pas_promedio))} · PAD{' '}
              {calcAvg(filteredVitals.map((v) => v.pad_promedio))} · FC{' '}
              {calcAvg(filteredVitals.map((v) => v.frecuencia_cardiaca))}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Próximo control programado</p>
            <p className="mt-1 font-mono tabular-nums">
              {appointments[0] ? `${formatDateEC(appointments[0].fecha_programada)} (${appointments[0].estado})` : 'No programado'}
            </p>
          </div>
        </div>
      </Surface>

      {/* Evolución clínica */}
      <Surface>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Evolución de parámetros vitales
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Seleccione el parámetro y fecha de corte para analizar tendencias
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 no-print">
            <Input
              type="date"
              className="w-40"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
              {(
                [
                  { id: 'pa', label: 'PAS / PAD' },
                  { id: 'fc', label: 'FC' },
                  { id: 'spo2', label: 'SpO₂' },
                  { id: 'imc', label: 'Peso / IMC' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setParamFilter(t.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer ${
                    paramFilter === t.id
                      ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="h-72 w-full">
          {chartSeries.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              No hay registros para graficar.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartSeries} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
                <XAxis dataKey="fecha" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                {paramFilter === 'pa' && (
                  <>
                    <Line type="monotone" dataKey="pas" name="PAS (mmHg)" stroke="#0284c7" strokeWidth={2.2} />
                    <Line type="monotone" dataKey="pad" name="PAD (mmHg)" stroke="#0d9488" strokeWidth={2.2} />
                  </>
                )}
                {paramFilter === 'fc' && (
                  <Line type="monotone" dataKey="fc" name="Frecuencia cardíaca (lpm)" stroke="#dc2626" strokeWidth={2.2} />
                )}
                {paramFilter === 'spo2' && (
                  <Line type="monotone" dataKey="spo2" name="SpO₂ (%)" stroke="#0369a1" strokeWidth={2.2} />
                )}
                {paramFilter === 'imc' && (
                  <>
                    <Line type="monotone" dataKey="peso" name="Peso (kg)" stroke="#0284c7" strokeWidth={2.2} />
                    <Line type="monotone" dataKey="imc" name="IMC (kg/m²)" stroke="#059669" strokeWidth={2.2} />
                  </>
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Surface>

      {/* Historial cronológico inmutable de controles */}
      <Surface>
        <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">
          Historial cronológico de signos vitales
        </h2>
        <div className="space-y-3">
          {filteredVitals.map((v) => (
            <div
              key={v.id}
              className="rounded-lg border border-slate-200 p-4 dark:border-slate-800"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">
                    {formatDateTimeEC(v.fecha_medicion)}
                  </span>{' '}
                  · {v.recorder_nombre} · {v.organization_nombre}
                </div>
                <div className="flex items-center gap-2">
                  <AlertIndicator level={v.nivel_alerta_global} compact />
                  {canAmend && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="no-print"
                      onClick={() => {
                        setAmendModal(v);
                        setAmendValue(v.observaciones_clinicas || '');
                      }}
                    >
                      <FileEdit className="h-3.5 w-3.5" />
                      <span>Enmendar nota</span>
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 lg:grid-cols-8">
                <div>
                  <span className="text-slate-500">PA Promedio</span>
                  <p className="font-mono font-semibold tabular-nums">
                    {v.pas_promedio !== null ? `${v.pas_promedio}/${v.pad_promedio} mmHg` : '—'}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">PAM / P. Pulso</span>
                  <p className="font-mono tabular-nums">
                    {v.pam_estimada ?? '—'} / {v.presion_pulso ?? '—'} mmHg
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">FC / FR</span>
                  <p className="font-mono tabular-nums">
                    {v.frecuencia_cardiaca ?? '—'} lpm · {v.frecuencia_respiratoria ?? '—'} rpm
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Temp / SpO₂</span>
                  <p className="font-mono tabular-nums">
                    {v.temperatura_c ?? '—'} °C · {v.saturacion_o2 !== null ? `${v.saturacion_o2}%` : '—'}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Peso / Talla</span>
                  <p className="font-mono tabular-nums">
                    {v.peso_kg ?? '—'} kg · {v.talla_cm ?? '—'} cm
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">IMC (Calc.)</span>
                  <p className="font-mono tabular-nums">
                    {v.imc ?? '—'} ({classifyBmiText(v.imc)})
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Glucemia</span>
                  <p className="font-mono tabular-nums">
                    {v.glucemia_mg_dl !== null ? `${v.glucemia_mg_dl} mg/dL` : '—'}
                  </p>
                </div>
                <div>
                  <span className="text-slate-500">Dolor</span>
                  <p className="font-mono tabular-nums">
                    {v.escala_dolor !== null ? `${v.escala_dolor}/10` : '—'}
                  </p>
                </div>
              </div>

              {v.bpReadings && v.bpReadings.length > 0 && (
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Tomas originales:{' '}
                  {v.bpReadings
                    .map(
                      (b) =>
                        `#${b.numero_medicion}: ${b.pas_mmhg}/${b.pad_mmhg} mmHg (${b.brazo}, ${b.posicion}, ${b.lugar_medicion}${
                          b.incluida_en_promedio ? '' : ' · excluida del promedio'
                        })`
                    )
                    .join(' | ')}
                </div>
              )}

              {(v.sintomas_referidos || v.observaciones_clinicas || v.conducta_profesional) && (
                <div className="mt-2 space-y-1 border-t border-slate-100 pt-2 text-xs dark:border-slate-800">
                  {v.sintomas_referidos && (
                    <p>
                      <strong className="text-slate-700 dark:text-slate-300">Síntomas:</strong> {v.sintomas_referidos}
                    </p>
                  )}
                  {v.observaciones_clinicas && (
                    <p>
                      <strong className="text-slate-700 dark:text-slate-300">Observaciones:</strong>{' '}
                      {v.observaciones_clinicas}
                    </p>
                  )}
                  {v.conducta_profesional && (
                    <p>
                      <strong className="text-slate-700 dark:text-slate-300">Conducta:</strong> {v.conducta_profesional}
                    </p>
                  )}
                </div>
              )}

              {v.amendments && v.amendments.length > 0 && (
                <div className="mt-2 space-y-1 rounded bg-slate-50 p-2 text-xs dark:bg-slate-800/60">
                  <p className="font-semibold text-slate-700 dark:text-slate-200">Enmiendas auditadas:</p>
                  {v.amendments.map((a) => (
                    <p key={a.id} className="text-slate-600 dark:text-slate-400">
                      {formatDateTimeEC(a.created_at)} · {a.amended_by_nombre} ({a.campo_modificado}): &ldquo;{a.valor_nuevo}&rdquo; · Motivo: {a.motivo_correccion}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Surface>

      {/* Antecedentes, alertas e historial HTA */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Surface>
          <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">
            Alertas clínicas asociadas
          </h2>
          {alerts.length === 0 ? (
            <p className="text-sm text-slate-500">Sin alertas clínicas registradas para este paciente.</p>
          ) : (
            <div className="space-y-2.5">
              {alerts.map((a) => (
                <div key={a.id} className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <AlertIndicator level={a.nivel} compact />
                    <span className="font-mono text-slate-500">{formatDateTimeEC(a.created_at)}</span>
                  </div>
                  <p className="mt-1.5 font-medium text-slate-900 dark:text-slate-100">{a.mensaje}</p>
                  <p className="mt-1 text-slate-600 dark:text-slate-400">{a.recomendacion}</p>
                  {a.estado === 'revisada' && (
                    <p className="mt-1 text-emerald-700 dark:text-emerald-400">
                      Revisada por {a.revisado_por_nombre}: {a.conducta_adoptada}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Surface>

        <Surface>
          <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">
            Historial clínico y cambios demográficos
          </h2>
          {medicalHistory.length === 0 && hypertensionFollowups.length === 0 ? (
            <p className="text-sm text-slate-500">Sin anotaciones adicionales.</p>
          ) : (
            <div className="space-y-2.5 text-xs">
              {hypertensionFollowups.map((hf) => (
                <div key={hf.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <p className="font-semibold text-sky-700 dark:text-sky-400">
                    Seguimiento HTA · {formatDateEC(hf.fecha_registro)}
                  </p>
                  <p className="mt-1">
                    Meta PA: <span className="font-mono">{hf.meta_pas_mmhg ?? '—'}/{hf.meta_pad_mmhg ?? '—'} mmHg</span> · Adherencia: {hf.adherencia_tratamiento}
                  </p>
                  {hf.tratamiento_antihipertensivo && <p className="mt-1 text-slate-600 dark:text-slate-400">{hf.tratamiento_antihipertensivo}</p>}
                </div>
              ))}
              {medicalHistory.map((h) => (
                <div key={h.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex justify-between text-slate-500">
                    <span className="font-semibold text-slate-800 dark:text-slate-200">{h.titulo}</span>
                    <span className="font-mono">{formatDateTimeEC(h.created_at)}</span>
                  </div>
                  <p className="mt-1 text-slate-600 dark:text-slate-400">{h.detalle}</p>
                </div>
              ))}
            </div>
          )}
        </Surface>
      </div>

      <Modal
        open={Boolean(amendModal)}
        onClose={() => setAmendModal(null)}
        title="Registrar enmienda clínica auditada"
      >
        <form onSubmit={submitAmendment} className="space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Los valores numéricos originales se conservan intactos. La enmienda queda vinculada con fecha, usuario y
            motivo clínico.
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium">Campo a enmendar</label>
            <Select value={amendField} onChange={(e) => setAmendField(e.target.value)}>
              <option value="observaciones_clinicas">Observaciones clínicas</option>
              <option value="conducta_profesional">Conducta profesional</option>
              <option value="sintomas_referidos">Síntomas referidos</option>
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Nuevo texto</label>
            <Textarea required rows={3} value={amendValue} onChange={(e) => setAmendValue(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Motivo de la corrección</label>
            <Input required value={amendReason} onChange={(e) => setAmendReason(e.target.value)} placeholder="Aclaración clínica documentada" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAmendModal(null)}>
              Cancelar
            </Button>
            <Button type="submit">Guardar enmienda</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
