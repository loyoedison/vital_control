import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Patient, VitalSignRecord } from '../types/clinical.ts';
import { apiRequest } from './api.ts';
import { ALERT_META, formatDateEC, formatDateTimeEC } from './utils.ts';

export interface ReportRow {
  id: string;
  pacienteCodigo: string;
  pacienteNombre: string;
  identificacion: string;
  edadAnios: number;
  sexo: string;
  antecedenteHta: boolean;
  establecimiento: string;
  profesional: string;
  fechaMedicion: string;
  pas: number | null;
  pad: number | null;
  pam: number | null;
  presionPulso: number | null;
  fc: number | null;
  fr: number | null;
  temperatura: number | null;
  spo2: number | null;
  imc: number | null;
  glucemia: number | null;
  nivelAlerta: string;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportReportCsv(
  rows: ReportRow[],
  reportType: string,
  anonymized: boolean
) {
  await apiRequest('/api/reports/audit-export', {
    method: 'POST',
    body: JSON.stringify({
      formato: 'CSV',
      reportType,
      anonymized,
      totalRegistros: rows.length,
    }),
  });

  const headers = [
    'Codigo',
    'Paciente',
    'Identificacion',
    'Edad',
    'Sexo',
    'Antecedente_HTA',
    'Establecimiento',
    'Profesional',
    'Fecha_Hora',
    'PAS_mmHg',
    'PAD_mmHg',
    'PAM_mmHg',
    'Presion_Pulso_mmHg',
    'FC_lpm',
    'FR_rpm',
    'Temp_C',
    'SpO2_pct',
    'IMC_kg_m2',
    'Glucemia_mg_dL',
    'Alerta',
  ];

  const escapeCsv = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return `"${s}"`;
  };

  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        r.pacienteCodigo,
        r.pacienteNombre,
        r.identificacion,
        r.edadAnios,
        r.sexo,
        r.antecedenteHta ? 'Si' : 'No',
        r.establecimiento,
        r.profesional,
        formatDateTimeEC(r.fechaMedicion),
        r.pas ?? '',
        r.pad ?? '',
        r.pam ?? '',
        r.presionPulso ?? '',
        r.fc ?? '',
        r.fr ?? '',
        r.temperatura ?? '',
        r.spo2 ?? '',
        r.imc ?? '',
        r.glucemia ?? '',
        r.nivelAlerta,
      ]
        .map(escapeCsv)
        .join(',')
    ),
  ];

  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `vitalcontrol_${reportType}${anonymized ? '_anonimizado' : ''}.csv`);
}

export async function exportReportExcel(
  rows: ReportRow[],
  reportType: string,
  anonymized: boolean
) {
  await apiRequest('/api/reports/audit-export', {
    method: 'POST',
    body: JSON.stringify({
      formato: 'EXCEL',
      reportType,
      anonymized,
      totalRegistros: rows.length,
    }),
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'VitalControl';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Signos Vitales');
  sheet.addRow([
    'VitalControl — Reporte Clínico de Signos Vitales',
    `Tipo: ${reportType}`,
    anonymized ? 'Modalidad: Anonimizada (LOPDP)' : 'Modalidad: Identificable Autorizada',
    `Generado: ${formatDateTimeEC(new Date().toISOString())} (America/Guayaquil)`,
  ]);
  sheet.addRow([]);

  const headerRow = sheet.addRow([
    'Código',
    'Paciente',
    'Identificación',
    'Edad',
    'Sexo',
    'HTA',
    'Establecimiento',
    'Profesional',
    'Fecha/Hora',
    'PAS (mmHg)',
    'PAD (mmHg)',
    'PAM (mmHg)',
    'P. Pulso',
    'FC (lpm)',
    'FR (rpm)',
    'Temp (°C)',
    'SpO2 (%)',
    'IMC',
    'Glucemia',
    'Estado Alerta',
  ]);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0369A1' } };
  });

  for (const r of rows) {
    sheet.addRow([
      r.pacienteCodigo,
      r.pacienteNombre,
      r.identificacion,
      r.edadAnios,
      r.sexo,
      r.antecedenteHta ? 'Sí' : 'No',
      r.establecimiento,
      r.profesional,
      formatDateTimeEC(r.fechaMedicion),
      r.pas,
      r.pad,
      r.pam,
      r.presionPulso,
      r.fc,
      r.fr,
      r.temperatura,
      r.spo2,
      r.imc,
      r.glucemia,
      r.nivelAlerta,
    ]);
  }

  sheet.columns.forEach((col) => {
    col.width = 16;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, `vitalcontrol_${reportType}${anonymized ? '_anonimizado' : ''}.xlsx`);
}

export async function exportReportPdf(
  rows: ReportRow[],
  reportType: string,
  anonymized: boolean
) {
  await apiRequest('/api/reports/audit-export', {
    method: 'POST',
    body: JSON.stringify({
      formato: 'PDF',
      reportType,
      anonymized,
      totalRegistros: rows.length,
    }),
  });

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  doc.setFontSize(14);
  doc.setTextColor(3, 105, 161);
  doc.text('VitalControl — Reporte Clínico de Signos Vitales', 14, 15);
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Reporte: ${reportType.toUpperCase()} · ${anonymized ? 'Exportación Anonimizada' : 'Uso Clínico Autorizado'} · Generado: ${formatDateTimeEC(new Date().toISOString())} (America/Guayaquil)`,
    14,
    21
  );

  autoTable(doc, {
    startY: 26,
    head: [
      [
        'Código',
        'Paciente',
        'Edad/Sexo',
        'HTA',
        'Fecha/Hora',
        'PAS/PAD',
        'PAM',
        'FC',
        'SpO2',
        'Temp',
        'IMC',
        'Nivel',
      ],
    ],
    body: rows.map((r) => [
      r.pacienteCodigo,
      r.pacienteNombre,
      `${r.edadAnios}a / ${r.sexo[0].toUpperCase()}`,
      r.antecedenteHta ? 'Sí' : 'No',
      formatDateTimeEC(r.fechaMedicion),
      r.pas !== null && r.pad !== null ? `${r.pas}/${r.pad}` : '—',
      r.pam ?? '—',
      r.fc ?? '—',
      r.spo2 !== null ? `${r.spo2}%` : '—',
      r.temperatura !== null ? `${r.temperatura}°C` : '—',
      r.imc ?? '—',
      r.nivelAlerta.toUpperCase(),
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [3, 105, 161] },
  });

  doc.save(`vitalcontrol_${reportType}${anonymized ? '_anonimizado' : ''}.pdf`);
}

export async function exportPatientIndividualPdf(patient: Patient, vitals: VitalSignRecord[]) {
  await apiRequest('/api/reports/audit-export', {
    method: 'POST',
    body: JSON.stringify({
      formato: 'PDF_INDIVIDUAL',
      reportType: `paciente_${patient.codigoInterno}`,
      anonymized: false,
      totalRegistros: vitals.length,
    }),
  });

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setFontSize(15);
  doc.setTextColor(3, 105, 161);
  doc.text('VitalControl — Ficha Individual de Signos Vitales', 14, 16);

  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(`Paciente: ${patient.nombres} ${patient.apellidos}`, 14, 25);
  doc.text(
    `Código: ${patient.codigoInterno} · Identificación: ${patient.numeroIdentificacion} · HC: ${patient.numeroHistoriaClinica}`,
    14,
    31
  );
  doc.text(
    `Nacimiento: ${formatDateEC(patient.fechaNacimiento)} (${patient.edadAnios} años) · Sexo: ${patient.sexo} · Establecimiento: ${patient.organizationNombre}`,
    14,
    37
  );
  doc.text(
    `Antecedentes: HTA (${patient.antecedenteHta ? 'Sí' : 'No'}) · Diabetes (${patient.antecedenteDiabetes ? 'Sí' : 'No'}) · Gestación (${patient.embarazoActual ? 'Sí' : 'No'})`,
    14,
    43
  );

  autoTable(doc, {
    startY: 50,
    head: [['Fecha/Hora', 'PAS/PAD (mmHg)', 'PAM', 'FC', 'SpO2', 'Temp', 'IMC', 'Alerta', 'Profesional']],
    body: vitals.map((v) => [
      formatDateTimeEC(v.fecha_medicion),
      v.pas_promedio !== null && v.pad_promedio !== null ? `${v.pas_promedio}/${v.pad_promedio}` : '—',
      v.pam_estimada ?? '—',
      v.frecuencia_cardiaca ?? '—',
      v.saturacion_o2 !== null ? `${v.saturacion_o2}%` : '—',
      v.temperatura_c !== null ? `${v.temperatura_c}°C` : '—',
      v.imc ?? '—',
      ALERT_META[v.nivel_alerta_global]?.shortLabel || v.nivel_alerta_global,
      v.recorder_nombre || '—',
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [3, 105, 161] },
  });

  doc.save(`ficha_${patient.codigoInterno}.pdf`);
}
