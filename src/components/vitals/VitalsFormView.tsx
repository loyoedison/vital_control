import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eraser, HeartPulse, Plus, Printer, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { classifyBmiText, getGuayaquilNowInputValue } from '../../lib/utils.ts';
import { Patient } from '../../types/clinical.ts';
import { AlertIndicator, Button, Input, Modal, Select, Surface, Textarea, useToast } from '../ui/Primitives.tsx';

interface BpEntry {
  numeroMedicion: number;
  pasMmhg: string;
  padMmhg: string;
  brazo: 'izquierdo' | 'derecho';
  posicion: 'sentado' | 'acostado' | 'de_pie';
  tamanoManguito: 'pediatrico' | 'estandar_adulto' | 'adulto_grande' | 'muslo';
  tiempoReposoMin: string;
  tipoDispositivo: string;
  lugarMedicion: 'establecimiento' | 'domicilio';
}

const createDefaultReading = (num: number): BpEntry => ({
  numeroMedicion: num,
  pasMmhg: '',
  padMmhg: '',
  brazo: 'izquierdo',
  posicion: 'sentado',
  tamanoManguito: 'estandar_adulto',
  tiempoReposoMin: '5',
  tipoDispositivo: 'Oscilométrico validado',
  lugarMedicion: 'establecimiento',
});

export function VitalsFormView({
  preselectedPatientId,
  onSuccessPatient,
}: {
  preselectedPatientId?: string | null;
  onSuccessPatient: (patientId: string) => void;
}) {
  const { user } = useAuth();
  const { notify } = useToast();

  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientId, setPatientId] = useState(preselectedPatientId || '');
  const [fechaMedicion, setFechaMedicion] = useState(getGuayaquilNowInputValue());
  const [protocoloPa, setProtocoloPa] = useState<
    'promedio_todas' | 'descartar_primera_si_hay_2_o_3' | 'ultima_medicion'
  >('descartar_primera_si_hay_2_o_3');
  const [bpReadings, setBpReadings] = useState<BpEntry[]>([createDefaultReading(1), createDefaultReading(2)]);

  const [frecuenciaCardiaca, setFrecuenciaCardiaca] = useState('');
  const [frecuenciaRespiratoria, setFrecuenciaRespiratoria] = useState('');
  const [temperaturaC, setTemperaturaC] = useState('');
  const [saturacionO2, setSaturacionO2] = useState('');
  const [oxigenoSuplementario, setOxigenoSuplementario] = useState<'none' | 'no' | 'si'>('none');
  const [pesoKg, setPesoKg] = useState('');
  const [tallaCm, setTallaCm] = useState('');
  const [glucemiaMgDl, setGlucemiaMgDl] = useState('');
  const [condicionGlucemia, setCondicionGlucemia] = useState<'ayuno' | 'posprandial' | 'aleatoria'>('ayuno');
  const [escalaDolor, setEscalaDolor] = useState('');
  const [sintomasReferidos, setSintomasReferidos] = useState('');
  const [observacionesClinicas, setObservacionesClinicas] = useState('');
  const [conductaProfesional, setConductaProfesional] = useState('');
  const [proximoControlFecha, setProximoControlFecha] = useState('');

  const [submissionId, setSubmissionId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [unusualWarnings, setUnusualWarnings] = useState<string[] | null>(null);
  const [lastSavedResult, setLastSavedResult] = useState<{
    nivelAlertaGlobal: 'verde' | 'amarillo' | 'naranja' | 'rojo' | 'gris';
    calculated: {
      pasPromedio: number | null;
      padPromedio: number | null;
      pamEstimada: number | null;
      presionPulso: number | null;
      imc: number | null;
      variacionPas: number | null;
      variacionPad: number | null;
    };
  } | null>(null);

  const canWrite = user && user.role !== 'consulta';

  useEffect(() => {
    apiRequest<{ items: Patient[] }>('/api/patients?status=activos&pageSize=100')
      .then((res) => {
        setPatients(res.items);
        if (preselectedPatientId) setPatientId(preselectedPatientId);
        else if (!patientId && res.items[0]) setPatientId(res.items[0].id);
      })
      .catch(() => {});
  }, [preselectedPatientId]);

  const liveCalculations = useMemo(() => {
    const validBp = bpReadings
      .filter((r) => r.pasMmhg !== '' && r.padMmhg !== '')
      .map((r) => ({
        num: r.numeroMedicion,
        pas: Number(r.pasMmhg),
        pad: Number(r.padMmhg),
      }))
      .filter((r) => !Number.isNaN(r.pas) && !Number.isNaN(r.pad) && r.pas > r.pad);

    let selected = validBp;
    if (protocoloPa === 'ultima_medicion' && validBp.length > 0) {
      selected = [validBp[validBp.length - 1]];
    } else if (protocoloPa === 'descartar_primera_si_hay_2_o_3' && validBp.length >= 2) {
      selected = validBp.slice(1);
    }

    const pasAvg = selected.length
      ? Number((selected.reduce((a, b) => a + b.pas, 0) / selected.length).toFixed(1))
      : null;
    const padAvg = selected.length
      ? Number((selected.reduce((a, b) => a + b.pad, 0) / selected.length).toFixed(1))
      : null;

    const pam =
      pasAvg !== null && padAvg !== null ? Number(((pasAvg + 2 * padAvg) / 3).toFixed(1)) : null;
    const pp = pasAvg !== null && padAvg !== null ? Number((pasAvg - padAvg).toFixed(1)) : null;

    const w = pesoKg !== '' ? Number(pesoKg) : null;
    const h = tallaCm !== '' ? Number(tallaCm) : null;
    const imc = w && h && w > 0 && h > 0 ? Number((w / (h / 100) ** 2).toFixed(2)) : null;

    return { pasAvg, padAvg, pam, pp, imc };
  }, [bpReadings, protocoloPa, pesoKg, tallaCm]);

  const resetForm = () => {
    setFechaMedicion(getGuayaquilNowInputValue());
    setBpReadings([createDefaultReading(1), createDefaultReading(2)]);
    setFrecuenciaCardiaca('');
    setFrecuenciaRespiratoria('');
    setTemperaturaC('');
    setSaturacionO2('');
    setOxigenoSuplementario('none');
    setPesoKg('');
    setTallaCm('');
    setGlucemiaMgDl('');
    setEscalaDolor('');
    setSintomasReferidos('');
    setObservacionesClinicas('');
    setConductaProfesional('');
    setProximoControlFecha('');
    setSubmissionId(crypto.randomUUID());
    setLastSavedResult(null);
  };

  const handleSave = async (confirmUnusual = false) => {
    if (!patientId) {
      notify('error', 'Seleccione un paciente primero.');
      return;
    }
    if (saving) return;

    const cleanReadings = bpReadings
      .filter((r) => r.pasMmhg !== '' || r.padMmhg !== '')
      .map((r, idx) => ({
        numeroMedicion: idx + 1,
        pasMmhg: Number(r.pasMmhg),
        padMmhg: Number(r.padMmhg),
        brazo: r.brazo,
        posicion: r.posicion,
        tamanoManguito: r.tamanoManguito,
        tiempoReposoMin: Number(r.tiempoReposoMin || 5),
        tipoDispositivo: r.tipoDispositivo,
        lugarMedicion: r.lugarMedicion,
      }));

    setSaving(true);
    try {
      const payload = {
        clientSubmissionId: submissionId,
        patientId,
        fechaMedicion: `${fechaMedicion}:00-05:00`,
        protocoloPa,
        bpReadings: cleanReadings,
        frecuenciaCardiaca: frecuenciaCardiaca === '' ? null : Number(frecuenciaCardiaca),
        frecuenciaRespiratoria: frecuenciaRespiratoria === '' ? null : Number(frecuenciaRespiratoria),
        temperaturaC: temperaturaC === '' ? null : Number(temperaturaC),
        saturacionO2: saturacionO2 === '' ? null : Number(saturacionO2),
        oxigenoSuplementario:
          oxigenoSuplementario === 'none' ? null : oxigenoSuplementario === 'si',
        pesoKg: pesoKg === '' ? null : Number(pesoKg),
        tallaCm: tallaCm === '' ? null : Number(tallaCm),
        glucemiaMgDl: glucemiaMgDl === '' ? null : Number(glucemiaMgDl),
        condicionGlucemia: glucemiaMgDl === '' ? null : condicionGlucemia,
        escalaDolor: escalaDolor === '' ? null : Number(escalaDolor),
        sintomasReferidos: sintomasReferidos.trim() || null,
        observacionesClinicas: observacionesClinicas.trim() || null,
        conductaProfesional: conductaProfesional.trim() || null,
        proximoControlFecha: proximoControlFecha || null,
        confirmUnusualValues: confirmUnusual,
      };

      const res = await apiRequest<{
        ok: boolean;
        duplicatePrevented?: boolean;
        nivelAlertaGlobal: 'verde' | 'amarillo' | 'naranja' | 'rojo' | 'gris';
        calculated: {
          pasPromedio: number | null;
          padPromedio: number | null;
          pamEstimada: number | null;
          presionPulso: number | null;
          imc: number | null;
          variacionPas: number | null;
          variacionPad: number | null;
        };
      }>('/api/vitals', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setUnusualWarnings(null);
      setLastSavedResult({
        nivelAlertaGlobal: res.nivelAlertaGlobal,
        calculated: res.calculated,
      });
      setSubmissionId(crypto.randomUUID());
      notify(
        'success',
        res.duplicatePrevented
          ? 'El control ya había sido registrado.'
          : 'Control de signos vitales guardado correctamente.'
      );
    } catch (err: unknown) {
      const apiErr = err as Error & { payload?: { requiresConfirmation?: boolean; warnings?: string[] } };
      if (apiErr.payload?.requiresConfirmation && apiErr.payload.warnings) {
        setUnusualWarnings(apiErr.payload.warnings);
      } else {
        notify('error', apiErr.message || 'Error guardando signos vitales.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (!canWrite) {
    return (
      <Surface>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Su rol actual (Consulta) solo tiene permisos de lectura y no puede registrar nuevos controles.
        </p>
      </Surface>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Registro de Signos Vitales
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Captura estructurada con mediciones independientes de presión arterial y parámetros calculados
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            <span>Imprimir registro</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={resetForm}>
            <Eraser className="h-4 w-4" />
            <span>Limpiar formulario</span>
          </Button>
        </div>
      </div>

      {lastSavedResult && (
        <Surface className="border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  Control almacenado con cálculos automáticos y semaforización
                </p>
                <p className="font-mono text-xs text-slate-700 dark:text-slate-300">
                  PA Promedio: {lastSavedResult.calculated.pasPromedio ?? '—'}/
                  {lastSavedResult.calculated.padPromedio ?? '—'} mmHg · PAM:{' '}
                  {lastSavedResult.calculated.pamEstimada ?? '—'} mmHg · IMC:{' '}
                  {lastSavedResult.calculated.imc ?? '—'} kg/m² · Variación PAS:{' '}
                  {lastSavedResult.calculated.variacionPas !== null
                    ? `${lastSavedResult.calculated.variacionPas > 0 ? '+' : ''}${lastSavedResult.calculated.variacionPas} mmHg`
                    : 'Primer registro'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AlertIndicator level={lastSavedResult.nivelAlertaGlobal} />
              <Button size="sm" variant="secondary" onClick={() => onSuccessPatient(patientId)}>
                Ver ficha clínica
              </Button>
            </div>
          </div>
        </Surface>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-8">
          {/* Selección de paciente y contexto */}
          <Surface className="space-y-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              01. Paciente y contexto de la medición
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium">Paciente</label>
                <Select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                  <option value="">Seleccione un paciente...</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.apellidos}, {p.nombres} · {p.numeroIdentificacion} ({p.codigoInterno})
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Fecha y hora (Guayaquil)</label>
                <Input
                  type="datetime-local"
                  value={fechaMedicion}
                  onChange={(e) => setFechaMedicion(e.target.value)}
                />
              </div>
            </div>
          </Surface>

          {/* Presión arterial multi-toma */}
          <Surface className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                  02. Mediciones de presión arterial (mmHg)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Las tomas originales se conservan de forma independiente
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  className="w-60 text-xs"
                  value={protocoloPa}
                  onChange={(e) => setProtocoloPa(e.target.value as typeof protocoloPa)}
                >
                  <option value="descartar_primera_si_hay_2_o_3">Protocolo: descartar 1.ª toma si hay ≥2</option>
                  <option value="promedio_todas">Protocolo: promedio de todas las tomas</option>
                  <option value="ultima_medicion">Protocolo: considerar última medición</option>
                </Select>
                {bpReadings.length < 3 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      setBpReadings((prev) => [...prev, createDefaultReading(prev.length + 1)])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Agregar 3.ª toma</span>
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-4">
              {bpReadings.map((reading, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-slate-200 p-4 dark:border-slate-800"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-sky-700 dark:text-sky-400">
                      Medición #{idx + 1}
                    </span>
                    {bpReadings.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setBpReadings((prev) =>
                            prev
                              .filter((_, i) => i !== idx)
                              .map((r, newIdx) => ({ ...r, numeroMedicion: newIdx + 1 }))
                          )
                        }
                        className="text-xs text-slate-500 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div>
                      <label className="mb-1 block text-xs">PAS (mmHg)</label>
                      <Input
                        type="number"
                        step="1"
                        min="40"
                        max="320"
                        placeholder="120"
                        className="font-mono"
                        value={reading.pasMmhg}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBpReadings((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, pasMmhg: val } : r))
                          );
                        }}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs">PAD (mmHg)</label>
                      <Input
                        type="number"
                        step="1"
                        min="20"
                        max="220"
                        placeholder="80"
                        className="font-mono"
                        value={reading.padMmhg}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBpReadings((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, padMmhg: val } : r))
                          );
                        }}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs">Brazo</label>
                      <Select
                        value={reading.brazo}
                        onChange={(e) => {
                          const val = e.target.value as 'derecho' | 'izquierdo';
                          setBpReadings((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, brazo: val } : r))
                          );
                        }}
                      >
                        <option value="izquierdo">Izquierdo</option>
                        <option value="derecho">Derecho</option>
                      </Select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs">Posición</label>
                      <Select
                        value={reading.posicion}
                        onChange={(e) => {
                          const val = e.target.value as 'sentado' | 'acostado' | 'de_pie';
                          setBpReadings((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, posicion: val } : r))
                          );
                        }}
                      >
                        <option value="sentado">Sentado</option>
                        <option value="acostado">Acostado</option>
                        <option value="de_pie">De pie</option>
                      </Select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs">Tamaño del manguito</label>
                      <Select
                        value={reading.tamanoManguito}
                        onChange={(e) => {
                          const val = e.target.value as BpEntry['tamanoManguito'];
                          setBpReadings((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, tamanoManguito: val } : r))
                          );
                        }}
                      >
                        <option value="estandar_adulto">Estándar adulto</option>
                        <option value="adulto_grande">Adulto grande</option>
                        <option value="pediatrico">Pediátrico</option>
                        <option value="muslo">Muslo</option>
                      </Select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs">Reposo previo (min)</label>
                      <Input
                        type="number"
                        min="0"
                        max="120"
                        className="font-mono"
                        value={reading.tiempoReposoMin}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBpReadings((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, tiempoReposoMin: val } : r))
                          );
                        }}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs">Dispositivo</label>
                      <Input
                        value={reading.tipoDispositivo}
                        onChange={(e) => {
                          const val = e.target.value;
                          setBpReadings((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, tipoDispositivo: val } : r))
                          );
                        }}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs">Lugar de toma</label>
                      <Select
                        value={reading.lugarMedicion}
                        onChange={(e) => {
                          const val = e.target.value as 'establecimiento' | 'domicilio';
                          setBpReadings((prev) =>
                            prev.map((r, i) => (i === idx ? { ...r, lugarMedicion: val } : r))
                          );
                        }}
                      >
                        <option value="establecimiento">Establecimiento</option>
                        <option value="domicilio">Domicilio</option>
                      </Select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Surface>

          {/* Otros signos vitales (campos vacíos -> NULL) */}
          <Surface className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                03. Otros signos vitales y antropometría
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Deje en blanco cualquier parámetro no medido (se guardará como nulo, nunca como cero)
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs">Frec. Cardíaca (lpm)</label>
                <Input
                  type="number"
                  step="1"
                  placeholder="Opcional"
                  className="font-mono"
                  value={frecuenciaCardiaca}
                  onChange={(e) => setFrecuenciaCardiaca(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs">Frec. Respiratoria (rpm)</label>
                <Input
                  type="number"
                  step="1"
                  placeholder="Opcional"
                  className="font-mono"
                  value={frecuenciaRespiratoria}
                  onChange={(e) => setFrecuenciaRespiratoria(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs">Temperatura (°C)</label>
                <Input
                  type="number"
                  step="0.1"
                  placeholder="36.5"
                  className="font-mono"
                  value={temperaturaC}
                  onChange={(e) => setTemperaturaC(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs">Saturación O₂ (%)</label>
                <Input
                  type="number"
                  step="1"
                  placeholder="96"
                  className="font-mono"
                  value={saturacionO2}
                  onChange={(e) => setSaturacionO2(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs">Oxígeno suplementario</label>
                <Select
                  value={oxigenoSuplementario}
                  onChange={(e) => setOxigenoSuplementario(e.target.value as 'none' | 'no' | 'si')}
                >
                  <option value="none">No registrado</option>
                  <option value="no">Aire ambiente (No)</option>
                  <option value="si">Con oxígeno suplementario</option>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs">Peso (kg)</label>
                <Input
                  type="number"
                  step="0.1"
                  placeholder="Opcional"
                  className="font-mono"
                  value={pesoKg}
                  onChange={(e) => setPesoKg(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs">Talla (cm)</label>
                <Input
                  type="number"
                  step="0.1"
                  placeholder="Opcional"
                  className="font-mono"
                  value={tallaCm}
                  onChange={(e) => setTallaCm(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs">Escala de dolor (0–10)</label>
                <Input
                  type="number"
                  min="0"
                  max="10"
                  step="1"
                  placeholder="0 - 10"
                  className="font-mono"
                  value={escalaDolor}
                  onChange={(e) => setEscalaDolor(e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs">Glucemia capilar (mg/dL)</label>
                <Input
                  type="number"
                  step="1"
                  placeholder="Opcional"
                  className="font-mono"
                  value={glucemiaMgDl}
                  onChange={(e) => setGlucemiaMgDl(e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs">Condición de glucemia</label>
                <Select
                  value={condicionGlucemia}
                  onChange={(e) => setCondicionGlucemia(e.target.value as typeof condicionGlucemia)}
                >
                  <option value="ayuno">Ayuno</option>
                  <option value="posprandial">Posprandial</option>
                  <option value="aleatoria">Aleatoria</option>
                </Select>
              </div>
            </div>
          </Surface>

          {/* Valoración clínica y conducta */}
          <Surface className="space-y-3">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              04. Información clínica adicional y próximo control
            </h2>
            <div>
              <label className="mb-1 block text-xs font-medium">Síntomas referidos</label>
              <Input
                value={sintomasReferidos}
                onChange={(e) => setSintomasReferidos(e.target.value)}
                placeholder="Ej. Asintomático, cefalea leve, mareo..."
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium">Observaciones clínicas</label>
                <Textarea
                  rows={2}
                  value={observacionesClinicas}
                  onChange={(e) => setObservacionesClinicas(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Conducta registrada por el profesional</label>
                <Textarea
                  rows={2}
                  value={conductaProfesional}
                  onChange={(e) => setConductaProfesional(e.target.value)}
                />
              </div>
            </div>
            <div className="max-w-xs">
              <label className="mb-1 block text-xs font-medium">Fecha del próximo control (opcional)</label>
              <Input
                type="date"
                value={proximoControlFecha}
                onChange={(e) => setProximoControlFecha(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4 dark:border-slate-800 no-print">
              <Button variant="secondary" onClick={resetForm}>
                Cancelar / Limpiar
              </Button>
              <Button onClick={() => handleSave(false)} disabled={saving}>
                <HeartPulse className="h-4 w-4" />
                <span>{saving ? 'Guardando...' : 'Guardar signos vitales'}</span>
              </Button>
            </div>
          </Surface>
        </div>

        {/* Columna derecha: parámetros calculados diferenciados */}
        <div className="space-y-4 lg:col-span-4">
          <Surface className="sticky top-20 space-y-4">
            <div>
              <p className="text-xs font-semibold tracking-wider text-sky-700 uppercase dark:text-sky-400">
                Parámetros Calculados Automáticamente
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Diferenciados de las mediciones directas; se validan antes de computar
              </p>
            </div>

            <div className="space-y-3 border-t border-slate-200 pt-3 text-sm dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Promedio PA (según protocolo)</span>
                <span className="font-mono font-semibold tabular-nums">
                  {liveCalculations.pasAvg !== null && liveCalculations.padAvg !== null
                    ? `${liveCalculations.pasAvg}/${liveCalculations.padAvg} mmHg`
                    : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">PAM estimada</span>
                <span className="font-mono font-semibold tabular-nums">
                  {liveCalculations.pam !== null ? `${liveCalculations.pam} mmHg` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">Presión de pulso</span>
                <span className="font-mono font-semibold tabular-nums">
                  {liveCalculations.pp !== null ? `${liveCalculations.pp} mmHg` : '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-400">IMC calculado</span>
                <span className="font-mono font-semibold tabular-nums">
                  {liveCalculations.imc !== null
                    ? `${liveCalculations.imc} kg/m² (${classifyBmiText(liveCalculations.imc)})`
                    : '—'}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              Las alertas clínicas son herramientas de apoyo y no establecen diagnósticos automáticos ni prescripciones.
            </div>
          </Surface>
        </div>
      </div>

      {/* Confirmación de valores inusuales */}
      <Modal
        open={Boolean(unusualWarnings)}
        onClose={() => setUnusualWarnings(null)}
        title="Confirmación de valores clínicamente inusuales"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">Verifique las siguientes lecturas antes de confirmar:</p>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {unusualWarnings?.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setUnusualWarnings(null)}>
              Revisar datos
            </Button>
            <Button onClick={() => handleSave(true)}>
              Confirmar y guardar medición real
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
