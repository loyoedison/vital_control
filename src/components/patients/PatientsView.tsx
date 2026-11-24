import React, { useEffect, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, Pencil, Power, Search, UserPlus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiRequest } from '../../lib/api.ts';
import { formatDateEC } from '../../lib/utils.ts';
import { Organization, Patient } from '../../types/clinical.ts';
import { Button, Input, Modal, Select, Surface, Textarea, useToast } from '../ui/Primitives.tsx';

const patientFormSchema = z.object({
  tipoIdentificacion: z.enum(['cedula', 'pasaporte', 'carnet_refugio', 'otro']),
  numeroIdentificacion: z.string().trim().min(5, 'Ingrese un número válido'),
  numeroHistoriaClinica: z.string().trim().min(3, 'Historia clínica requerida'),
  nombres: z.string().trim().min(2, 'Nombres requeridos'),
  apellidos: z.string().trim().min(2, 'Apellidos requeridos'),
  fechaNacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha requerida'),
  sexo: z.enum(['masculino', 'femenino', 'intersexual', 'no_especificado']),
  telefono: z.string().optional(),
  direccion: z.string().optional(),
  contactoEmergencia: z.string().optional(),
  organizationId: z.string().min(1, 'Seleccione establecimiento'),
  antecedenteHta: z.boolean(),
  antecedenteDiabetes: z.boolean(),
  embarazoActual: z.boolean(),
  condicionClinicaEspecial: z.string().optional(),
  otrosAntecedentes: z.string().optional(),
  observaciones: z.string().optional(),
  alergias: z.string().optional(),
  medicacionHabitual: z.string().optional(),
  antecedentesFamiliares: z.string().optional(),
  motivoCambio: z.string().optional(),
});

type PatientFormValues = z.infer<typeof patientFormSchema>;

export function PatientsView({ onOpenPatient }: { onOpenPatient: (id: string) => void }) {
  const { user, organizations } = useAuth();
  const { notify } = useToast();

  const [patients, setPatients] = useState<Patient[]>([]);
  const [allOrgs, setAllOrgs] = useState<Organization[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('activos');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);

  const canWrite = user && user.role !== 'consulta';
  const canToggleStatus = user && (user.role === 'administrador' || user.role === 'medico');

  const form = useForm<PatientFormValues>({
    resolver: zodResolver(patientFormSchema),
    defaultValues: {
      tipoIdentificacion: 'cedula',
      numeroIdentificacion: '',
      numeroHistoriaClinica: '',
      nombres: '',
      apellidos: '',
      fechaNacimiento: '1980-01-01',
      sexo: 'femenino',
      telefono: '',
      direccion: '',
      contactoEmergencia: '',
      organizationId: organizations[0]?.id || '',
      antecedenteHta: false,
      antecedenteDiabetes: false,
      embarazoActual: false,
      condicionClinicaEspecial: '',
      otrosAntecedentes: '',
      observaciones: '',
      alergias: '',
      medicacionHabitual: '',
      antecedentesFamiliares: '',
      motivoCambio: '',
    },
  });

  const loadPatients = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '12',
        status: statusFilter,
      });
      if (search.trim()) params.set('search', search.trim());
      const res = await apiRequest<{ items: Patient[]; totalPages: number; total: number }>(
        `/api/patients?${params.toString()}`
      );
      setPatients(res.items);
      setTotalPages(res.totalPages);
      setTotal(res.total);
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error cargando pacientes.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    apiRequest<{ items: Organization[] }>('/api/admin/organizations')
      .then((res) => setAllOrgs(res.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadPatients();
  }, [page, statusFilter, search]);

  const openCreateModal = () => {
    setEditingPatient(null);
    form.reset({
      tipoIdentificacion: 'cedula',
      numeroIdentificacion: '',
      numeroHistoriaClinica: '',
      nombres: '',
      apellidos: '',
      fechaNacimiento: '1980-01-01',
      sexo: 'femenino',
      telefono: '',
      direccion: '',
      contactoEmergencia: '',
      organizationId: organizations[0]?.id || allOrgs[0]?.id || '',
      antecedenteHta: false,
      antecedenteDiabetes: false,
      embarazoActual: false,
      condicionClinicaEspecial: '',
      otrosAntecedentes: '',
      observaciones: '',
      alergias: '',
      medicacionHabitual: '',
      antecedentesFamiliares: '',
      motivoCambio: '',
    });
    setModalOpen(true);
  };

  const openEditModal = (p: Patient) => {
    setEditingPatient(p);
    form.reset({
      tipoIdentificacion: p.tipoIdentificacion,
      numeroIdentificacion: p.numeroIdentificacion,
      numeroHistoriaClinica: p.numeroHistoriaClinica,
      nombres: p.nombres,
      apellidos: p.apellidos,
      fechaNacimiento: p.fechaNacimiento,
      sexo: p.sexo,
      telefono: p.telefono || '',
      direccion: p.direccion || '',
      contactoEmergencia: p.contactoEmergencia || '',
      organizationId: p.organizationId,
      antecedenteHta: p.antecedenteHta,
      antecedenteDiabetes: p.antecedenteDiabetes,
      embarazoActual: p.embarazoActual,
      condicionClinicaEspecial: p.condicionClinicaEspecial || '',
      otrosAntecedentes: p.otrosAntecedentes || '',
      observaciones: p.observaciones || '',
      alergias: '',
      medicacionHabitual: '',
      antecedentesFamiliares: '',
      motivoCambio: '',
    });
    setModalOpen(true);
  };

  const onSubmit = async (values: PatientFormValues) => {
    try {
      if (editingPatient) {
        await apiRequest(`/api/patients/${editingPatient.id}`, {
          method: 'PUT',
          body: JSON.stringify(values),
        });
        notify('success', 'Datos del paciente actualizados con registro de auditoría.');
      } else {
        await apiRequest('/api/patients', {
          method: 'POST',
          body: JSON.stringify(values),
        });
        notify('success', 'Paciente registrado correctamente.');
      }
      setModalOpen(false);
      loadPatients();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error guardando paciente.');
    }
  };

  const handleToggleStatus = async (p: Patient) => {
    try {
      await apiRequest(`/api/patients/${p.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({
          activo: !p.activo,
          motivo: p.activo ? 'Inactivación administrativa/clínica' : 'Reactivación de seguimiento',
        }),
      });
      notify('success', p.activo ? 'Paciente marcado como inactivo.' : 'Paciente reactivado.');
      loadPatients();
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Error cambiando estado.');
    }
  };

  const birthPreview = form.watch('fechaNacimiento');
  const computedAge = React.useMemo(() => {
    if (!birthPreview) return '—';
    const b = new Date(`${birthPreview}T12:00:00Z`);
    if (Number.isNaN(b.getTime())) return '—';
    const now = new Date();
    let age = now.getUTCFullYear() - b.getUTCFullYear();
    const m = now.getUTCMonth() - b.getUTCMonth();
    if (m < 0 || (m === 0 && now.getUTCDate() < b.getUTCDate())) age--;
    return `${Math.max(0, age)} años`;
  }, [birthPreview]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Registro de Pacientes
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Padrón institucional con validación de identificación única y trazabilidad de cambios demográficos
          </p>
        </div>
        {canWrite && (
          <Button onClick={openCreateModal}>
            <UserPlus className="h-4 w-4" />
            <span>Registrar paciente</span>
          </Button>
        )}
      </div>

      <Surface className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="Buscar por cédula, nombres, apellidos, HC o código..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            {(['activos', 'inactivos', 'todos'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setStatusFilter(s);
                  setPage(1);
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors cursor-pointer ${
                  statusFilter === s
                    ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <tr>
                <th className="py-2.5 pr-4 font-medium">Código / HC</th>
                <th className="py-2.5 pr-4 font-medium">Paciente</th>
                <th className="py-2.5 pr-4 font-medium">Identificación</th>
                <th className="py-2.5 pr-4 font-medium">Edad / Sexo</th>
                <th className="py-2.5 pr-4 font-medium">Antecedentes</th>
                <th className="py-2.5 pr-4 font-medium">Establecimiento</th>
                <th className="py-2.5 text-right font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    Cargando padrón de pacientes...
                  </td>
                </tr>
              ) : patients.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No se encontraron pacientes con los filtros actuales.
                  </td>
                </tr>
              ) : (
                patients.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 pr-4 font-mono text-xs tabular-nums">
                      <div className="font-semibold text-slate-900 dark:text-white">{p.codigoInterno}</div>
                      <div className="text-slate-500 dark:text-slate-400">{p.numeroHistoriaClinica}</div>
                    </td>
                    <td className="py-3 pr-4">
                      <button
                        type="button"
                        onClick={() => onOpenPatient(p.id)}
                        className="font-medium text-sky-700 hover:underline dark:text-sky-400 text-left cursor-pointer"
                      >
                        {p.apellidos}, {p.nombres}
                      </button>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Registro: {formatDateEC(p.createdAt)} · {p.activo ? 'Activo' : 'Inactivo'}
                      </div>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs tabular-nums">
                      {p.numeroIdentificacion}
                    </td>
                    <td className="py-3 pr-4 text-xs">
                      <span className="font-mono tabular-nums">{p.edadAnios} años</span> ·{' '}
                      <span className="capitalize">{p.sexo}</span>
                    </td>
                    <td className="py-3 pr-4 text-xs text-slate-600 dark:text-slate-300">
                      {[
                        p.antecedenteHta ? 'HTA' : null,
                        p.antecedenteDiabetes ? 'DM' : null,
                        p.embarazoActual ? 'Gestación' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Sin antecedentes registrados'}
                    </td>
                    <td className="py-3 pr-4 text-xs text-slate-600 dark:text-slate-300">
                      {p.organizationNombre}
                    </td>
                    <td className="py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => onOpenPatient(p.id)} title="Ver ficha clínica">
                          <Eye className="h-4 w-4" />
                        </Button>
                        {canWrite && (
                          <Button size="sm" variant="ghost" onClick={() => openEditModal(p)} title="Editar datos">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {canToggleStatus && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleToggleStatus(p)}
                            title={p.activo ? 'Inactivar paciente' : 'Reactivar paciente'}
                          >
                            <Power className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-400">
          <span>Total: {total} paciente(s)</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Anterior
            </Button>
            <span className="font-mono">
              {page} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      </Surface>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingPatient ? `Editar ficha demográfica · ${editingPatient.codigoInterno}` : 'Registrar nuevo paciente'}
        maxWidth="max-w-3xl"
      >
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Tipo de identificación</label>
              <Select {...form.register('tipoIdentificacion')}>
                <option value="cedula">Cédula ecuatoriana</option>
                <option value="pasaporte">Pasaporte</option>
                <option value="carnet_refugio">Carnet de refugio</option>
                <option value="otro">Otro documento</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Número de identificación</label>
              <Input {...form.register('numeroIdentificacion')} className="font-mono" placeholder="1710034065" />
              {form.formState.errors.numeroIdentificacion && (
                <p className="mt-1 text-xs text-red-600">{form.formState.errors.numeroIdentificacion.message}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">N.º Historia Clínica</label>
              <Input {...form.register('numeroHistoriaClinica')} className="font-mono" placeholder="HC-UIO-00501" />
              {form.formState.errors.numeroHistoriaClinica && (
                <p className="mt-1 text-xs text-red-600">{form.formState.errors.numeroHistoriaClinica.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Nombres</label>
              <Input {...form.register('nombres')} />
              {form.formState.errors.nombres && (
                <p className="mt-1 text-xs text-red-600">{form.formState.errors.nombres.message}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Apellidos</label>
              <Input {...form.register('apellidos')} />
              {form.formState.errors.apellidos && (
                <p className="mt-1 text-xs text-red-600">{form.formState.errors.apellidos.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Fecha de nacimiento ({computedAge})</label>
              <Input type="date" {...form.register('fechaNacimiento')} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Sexo</label>
              <Select {...form.register('sexo')}>
                <option value="femenino">Femenino</option>
                <option value="masculino">Masculino</option>
                <option value="intersexual">Intersexual</option>
                <option value="no_especificado">No especificado</option>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Establecimiento de salud</label>
              <Select {...form.register('organizationId')}>
                {(user?.role === 'administrador' ? allOrgs : organizations).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre} ({o.altitud_msnm} msnm)
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium">Teléfono (opcional)</label>
              <Input {...form.register('telefono')} placeholder="0990000000" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Dirección (opcional)</label>
              <Input {...form.register('direccion')} placeholder="Sector / parroquia" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Contacto de emergencia (opcional)</label>
              <Input {...form.register('contactoEmergencia')} placeholder="Nombre y teléfono" />
            </div>
          </div>

          <div className="flex flex-wrap gap-5 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" {...form.register('antecedenteHta')} className="h-4 w-4 rounded" />
              <span>Antecedente de hipertensión arterial</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" {...form.register('antecedenteDiabetes')} className="h-4 w-4 rounded" />
              <span>Diabetes mellitus</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input type="checkbox" {...form.register('embarazoActual')} className="h-4 w-4 rounded" />
              <span>Gestación actual</span>
            </label>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium">Condición clínica especial (opcional)</label>
              <Input {...form.register('condicionClinicaEspecial')} placeholder="Ej. EPOC, ERC, cardiopatía" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Otros antecedentes relevantes</label>
              <Input {...form.register('otrosAntecedentes')} />
            </div>
          </div>

          {!editingPatient && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Alergias</label>
                <Input {...form.register('alergias')} placeholder="Ninguna conocida" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Medicación habitual</label>
                <Input {...form.register('medicacionHabitual')} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Antecedentes familiares</label>
                <Input {...form.register('antecedentesFamiliares')} />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium">Observaciones clínicas administrativas</label>
            <Textarea rows={2} {...form.register('observaciones')} />
          </div>

          {editingPatient && (
            <div>
              <label className="mb-1 block text-xs font-medium">Motivo de la modificación demográfica</label>
              <Input {...form.register('motivoCambio')} placeholder="Actualización de datos verificada en consulta" />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {editingPatient ? 'Guardar cambios auditados' : 'Registrar paciente'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
