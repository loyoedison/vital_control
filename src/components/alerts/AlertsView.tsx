import React, { useEffect, useState } from 'react';
import { CheckCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatDateTimeEC } from '../../lib/utils.ts';
import { ClinicalAlertRecord } from '../../types/clinical.ts';
import { AlertIndicator, Button, Modal, Surface, Textarea, useToast } from '../ui/Primitives.tsx';

export function AlertsView({ onOpenPatient }: { onOpenPatient: (id: string) => void }) {
  const { user } = useAuth();
  const { notify } = useToast();

  const [alerts, setAlerts] = useState<ClinicalAlertRecord[]>([]);
  const [estadoFilter, setEstadoFilter] = useState<'pendiente' | 'revisada' | 'todas'>('pendiente');
  const [nivelFilter, setNivelFilter] = useState('todos');
  const [reviewingAlert, setReviewingAlert] = useState<ClinicalAlertRecord | null>(null);
  const [conductaAdoptada, setConductaAdoptada] = useState('');

  const canReview = user && user.role !== 'consulta';

  const loadAlerts = async () => {
    try {
      const res = await apiRequest<{ items: ClinicalAlertRecord[] }>(
        `/api/alerts?estado=${estadoFilter}&nivel=${nivelFilter}`
      );
      setAlerts(res.items);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error cargando alertas.');
    }
  };

  useEffect(() => {
    loadAlerts();
  }, [estadoFilter, nivelFilter]);

  const handleConfirmReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reviewingAlert) return;
    try {
      await apiRequest(`/api/alerts/${reviewingAlert.id}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ conductaAdoptada }),
      });
      notify('success', 'Lectura y conducta clínica registradas en la auditoría.');
      setReviewingAlert(null);
      setConductaAdoptada('');
      loadAlerts();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error confirmando lectura.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          Sistema de Alertas Clínicas Semaforizadas
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Herramienta de apoyo basada en guías clínicas configurables. No sustituye el criterio ni la valoración médica.
        </p>
      </div>

      <Surface className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {(
            [
              { id: 'pendiente', label: 'Pendientes' },
              { id: 'revisada', label: 'Revisadas' },
              { id: 'todas', label: 'Todas' },
            ] as const
          ).map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setEstadoFilter(e.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium cursor-pointer ${
                estadoFilter === e.id
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {e.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
          {(['todos', 'rojo', 'naranja', 'amarillo'] as const).map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setNivelFilter(lvl)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize cursor-pointer ${
                nivelFilter === lvl
                  ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {lvl}
            </button>
          ))}
        </div>
      </Surface>

      <div className="space-y-3">
        {alerts.length === 0 ? (
          <Surface className="py-10 text-center text-sm text-slate-500">
            No existen alertas clínicas para los filtros seleccionados.
          </Surface>
        ) : (
          alerts.map((a) => (
            <Surface key={a.id} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <AlertIndicator level={a.nivel} />
                  <button
                    type="button"
                    onClick={() => onOpenPatient(a.patient_id)}
                    className="text-sm font-semibold text-sky-700 hover:underline dark:text-sky-400 cursor-pointer"
                  >
                    {a.patient_nombres} {a.patient_apellidos}
                  </button>
                  <span className="font-mono text-xs text-slate-500">{a.codigo_interno}</span>
                </div>
                <span className="font-mono text-xs text-slate-500">{formatDateTimeEC(a.created_at)}</span>
              </div>

              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{a.mensaje}</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">{a.recomendacion}</p>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                <span className="text-slate-500 dark:text-slate-400">
                  Fuente: {a.fuente_clinica || 'Protocolo institucional'} ({a.version_guia || 'v1'}) · Población:{' '}
                  {a.poblacion_aplicable || 'General'}
                </span>

                {a.estado === 'revisada' ? (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    Confirmada por {a.revisado_por_nombre} · Conducta: {a.conducta_adoptada}
                  </span>
                ) : canReview ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setReviewingAlert(a);
                      setConductaAdoptada('');
                    }}
                  >
                    <CheckCheck className="h-4 w-4" />
                    <span>Confirmar lectura y conducta</span>
                  </Button>
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">Pendiente de revisión clínica</span>
                )}
              </div>
            </Surface>
          ))
        )}
      </div>

      <Modal
        open={Boolean(reviewingAlert)}
        onClose={() => setReviewingAlert(null)}
        title="Confirmación de lectura y conducta clínica"
      >
        <form onSubmit={handleConfirmReview} className="space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Paciente: <strong>{reviewingAlert?.patient_nombres} {reviewingAlert?.patient_apellidos}</strong>
          </p>
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-800 dark:bg-slate-800/50">
            {reviewingAlert?.mensaje}
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium">
              Valoración profesional y conducta adoptada
            </label>
            <Textarea
              required
              rows={3}
              value={conductaAdoptada}
              onChange={(e) => setConductaAdoptada(e.target.value)}
              placeholder="Ej. Se repite toma tras 10 minutos de reposo, se coordina valoración médica prioritaria..."
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReviewingAlert(null)}>
              Cancelar
            </Button>
            <Button type="submit">Registrar confirmación</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
