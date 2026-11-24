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
import { Activity, Plus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatDateEC } from '../../lib/utils.ts';
import { HypertensionFollowupRecord, Patient, VitalSignRecord } from '../../types/clinical.ts';
import { Button, Input, Modal, Select, Surface, Textarea, useToast } from '../ui/Primitives.tsx';

export function HypertensionView() {
  const { user } = useAuth();
  const { notify } = useToast();

  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [followups, setFollowups] = useState<HypertensionFollowupRecord[]>([]);
  const [vitals, setVitals] = useState<VitalSignRecord[]>([]);
  const [granularity, setGranularity] = useState<'diario' | 'semanal' | 'mensual' | 'anual'>('diario');
  const [modalOpen, setModalOpen] = useState(false);

  // Campos formulario HTA
  const [fechaDiagnostico, setFechaDiagnostico] = useState('');
  const [antecedentesFamiliaresHta, setAntecedentesFamiliaresHta] = useState(true);
  const [tratamientoAntihipertensivo, setTratamientoAntihipertensivo] = useState('');
  const [adherenciaTratamiento, setAdherenciaTratamiento] = useState<'alta' | 'media' | 'baja' | 'sin_tratamiento'>('alta');
  const [actividadFisica, setActividadFisica] = useState('moderada');
  const [consumoTabaco, setConsumoTabaco] = useState('no_fuma');
  const [consumoAlcohol, setConsumoAlcohol] = useState('ninguno');
  const [consumoSal, setConsumoSal] = useState('moderado');
  const [factoresRiesgoText, setFactoresRiesgoText] = useState('Sedentarismo, Dislipidemia');
  const [controlesDomiciliariosTexto, setControlesDomiciliariosTexto] = useState('');
  const [metaPasMmhg, setMetaPasMmhg] = useState('130');
  const [metaPadMmhg, setMetaPadMmhg] = useState('80');
  const [proximaCita, setProximaCita] = useState('');
  const [observaciones, setObservaciones] = useState('');

  const canWrite = user && user.role !== 'consulta';

  const loadData = async (pid?: string) => {
    try {
      const [pRes, fRes, vRes] = await Promise.all([
        apiRequest<{ items: Patient[] }>('/api/patients?pageSize=100'),
        apiRequest<{ items: HypertensionFollowupRecord[] }>(
          `/api/hypertension${pid ? `?patientId=${pid}` : ''}`
        ),
        apiRequest<{ items: VitalSignRecord[] }>(`/api/vitals${pid ? `?patientId=${pid}` : ''}`),
      ]);
      setPatients(pRes.items);
      setFollowups(fRes.items);
      setVitals(vRes.items);
      if (!selectedPatientId && pRes.items.length > 0) {
        const firstHta = pRes.items.find((x) => x.antecedenteHta) || pRes.items[0];
        setSelectedPatientId(firstHta.id);
      }
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error cargando seguimiento HTA.');
    }
  };

  useEffect(() => {
    loadData(selectedPatientId || undefined);
  }, [selectedPatientId]);

  const handleSaveFollowup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatientId) return;
    try {
      await apiRequest('/api/hypertension', {
        method: 'POST',
        body: JSON.stringify({
          patientId: selectedPatientId,
          fechaDiagnostico: fechaDiagnostico || null,
          antecedentesFamiliaresHta,
          tratamientoAntihipertensivo: tratamientoAntihipertensivo || null,
          adherenciaTratamiento,
          actividadFisica,
          consumoTabaco,
          consumoAlcohol,
          consumoSal,
          factoresRiesgoCv: factoresRiesgoText
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          controlesDomiciliariosTexto: controlesDomiciliariosTexto || null,
          metaPasMmhg: metaPasMmhg ? Number(metaPasMmhg) : null,
          metaPadMmhg: metaPadMmhg ? Number(metaPadMmhg) : null,
          proximaCita: proximaCita || null,
          observaciones: observaciones || null,
        }),
      });
      notify('success', 'Seguimiento de hipertensión guardado.');
      setModalOpen(false);
      loadData(selectedPatientId);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error guardando seguimiento.');
    }
  };

  const chartData = React.useMemo(() => {
    const groups = new Map<string, { pas: number[]; pad: number[] }>();
    for (const v of [...vitals].reverse()) {
      if (v.pas_promedio === null || v.pad_promedio === null) continue;
      const isoDate = v.fecha_medicion.slice(0, 10);
      let key = formatDateEC(isoDate);
      if (granularity === 'mensual') key = isoDate.slice(0, 7);
      else if (granularity === 'anual') key = isoDate.slice(0, 4);
      else if (granularity === 'semanal') {
        const dt = new Date(`${isoDate}T12:00:00Z`);
        const day = dt.getUTCDay() || 7;
        dt.setUTCDate(dt.getUTCDate() - day + 1);
        key = `Sem ${dt.toISOString().slice(5, 10)}`;
      }
      const curr = groups.get(key) || { pas: [], pad: [] };
      curr.pas.push(Number(v.pas_promedio));
      curr.pad.push(Number(v.pad_promedio));
      groups.set(key, curr);
    }
    return Array.from(groups.entries()).map(([label, d]) => ({
      label,
      pas: Number((d.pas.reduce((a, b) => a + b, 0) / d.pas.length).toFixed(1)),
      pad: Number((d.pad.reduce((a, b) => a + b, 0) / d.pad.length).toFixed(1)),
    }));
  }, [vitals, granularity]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Seguimiento de Hipertensión Arterial
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Control longitudinal de metas terapéuticas, adherencia, factores de riesgo y evolución de presión arterial
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="w-64"
            value={selectedPatientId}
            onChange={(e) => setSelectedPatientId(e.target.value)}
          >
            <option value="">Todos los pacientes</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.apellidos}, {p.nombres} {p.antecedenteHta ? '(HTA)' : ''}
              </option>
            ))}
          </Select>
          {canWrite && selectedPatientId && (
            <Button onClick={() => setModalOpen(true)}>
              <Plus className="h-4 w-4" />
              <span>Registrar evaluación HTA</span>
            </Button>
          )}
        </div>
      </div>

      <Surface>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Evolución de presión arterial sistólica y diastólica
          </h2>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(['diario', 'semanal', 'mensual', 'anual'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGranularity(g)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize cursor-pointer ${
                  granularity === g
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div className="h-72 w-full">
          {chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">
              Sin mediciones de presión arterial para el paciente seleccionado.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" opacity={0.2} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} domain={[50, 200]} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="pas" name="PAS (mmHg)" stroke="#0284c7" strokeWidth={2.3} />
                <Line type="monotone" dataKey="pad" name="PAD (mmHg)" stroke="#0d9488" strokeWidth={2.3} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Surface>

      <Surface>
        <h2 className="mb-3 text-base font-semibold text-slate-900 dark:text-white">
          Evaluaciones de seguimiento registradas
        </h2>
        {followups.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            No existen evaluaciones de seguimiento de HTA registradas para este filtro.
          </p>
        ) : (
          <div className="space-y-3">
            {followups.map((f) => (
              <div key={f.id} className="rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {f.patient_nombres} {f.patient_apellidos}
                    </span>
                    <span className="font-mono text-xs text-slate-500">{f.codigo_interno}</span>
                  </div>
                  <span className="font-mono text-xs text-slate-500">
                    {formatDateEC(f.fecha_registro)} · {f.recorder_nombre}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <div>
                    <span className="text-slate-500">Meta individual PA</span>
                    <p className="font-mono font-semibold">
                      {f.meta_pas_mmhg ?? '—'}/{f.meta_pad_mmhg ?? '—'} mmHg
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Adherencia</span>
                    <p className="capitalize font-medium">{f.adherencia_tratamiento}</p>
                  </div>
                  <div>
                    <span className="text-slate-500">Estilo de vida</span>
                    <p className="capitalize">
                      Act: {f.actividad_fisica} · Sal: {f.consumo_sal}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-500">Próxima cita</span>
                    <p className="font-mono">{formatDateEC(f.proxima_cita)}</p>
                  </div>
                </div>

                {f.tratamiento_antihipertensivo && (
                  <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                    <strong>Esquema registrado:</strong> {f.tratamiento_antihipertensivo}
                  </p>
                )}
                {f.factores_riesgo_cv.length > 0 && (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Factores de riesgo CV: {f.factores_riesgo_cv.join(' · ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Surface>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Registrar seguimiento de hipertensión arterial"
        maxWidth="max-w-3xl"
      >
        <form onSubmit={handleSaveFollowup} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Fecha diagnóstico HTA</label>
              <Input type="date" value={fechaDiagnostico} onChange={(e) => setFechaDiagnostico(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Meta PAS (mmHg)</label>
              <Input type="number" className="font-mono" value={metaPasMmhg} onChange={(e) => setMetaPasMmhg(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Meta PAD (mmHg)</label>
              <Input type="number" className="font-mono" value={metaPadMmhg} onChange={(e) => setMetaPadMmhg(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Tratamiento antihipertensivo vigente</label>
            <Input
              value={tratamientoAntihipertensivo}
              onChange={(e) => setTratamientoAntihipertensivo(e.target.value)}
              placeholder="Ej. Losartán 50 mg c/12h"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div>
              <label className="mb-1 block text-xs font-medium">Adherencia</label>
              <Select value={adherenciaTratamiento} onChange={(e) => setAdherenciaTratamiento(e.target.value as typeof adherenciaTratamiento)}>
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
                <option value="sin_tratamiento">Sin tratamiento</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Actividad física</label>
              <Select value={actividadFisica} onChange={(e) => setActividadFisica(e.target.value)}>
                <option value="sedentario">Sedentario</option>
                <option value="ligera">Ligera</option>
                <option value="moderada">Moderada</option>
                <option value="intensa">Intensa</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Tabaco</label>
              <Select value={consumoTabaco} onChange={(e) => setConsumoTabaco(e.target.value)}>
                <option value="no_fuma">No fuma</option>
                <option value="exfumador">Exfumador</option>
                <option value="ocasional">Ocasional</option>
                <option value="diario">Diario</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Alcohol</label>
              <Select value={consumoAlcohol} onChange={(e) => setConsumoAlcohol(e.target.value)}>
                <option value="ninguno">Ninguno</option>
                <option value="ocasional">Ocasional</option>
                <option value="moderado">Moderado</option>
                <option value="frecuente">Frecuente</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Consumo de sal</label>
              <Select value={consumoSal} onChange={(e) => setConsumoSal(e.target.value)}>
                <option value="bajo">Bajo</option>
                <option value="moderado">Moderado</option>
                <option value="alto">Alto</option>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Factores de riesgo CV (separados por coma)</label>
              <Input value={factoresRiesgoText} onChange={(e) => setFactoresRiesgoText(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Próxima cita</label>
              <Input type="date" value={proximaCita} onChange={(e) => setProximaCita(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Resumen de controles domiciliarios</label>
            <Input
              value={controlesDomiciliariosTexto}
              onChange={(e) => setControlesDomiciliariosTexto(e.target.value)}
              placeholder="Promedio AMPA última semana..."
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium">Observaciones</label>
            <Textarea rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
          </div>

          <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={antecedentesFamiliaresHta}
              onChange={(e) => setAntecedentesFamiliaresHta(e.target.checked)}
            />
            <span>Antecedentes familiares de hipertensión arterial</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit">Guardar seguimiento</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
