import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import {
  calculateAgeYears,
  calculateBMI,
  calculatePAM,
  calculatePulsePressure,
  computeBloodPressureAverage,
  evaluateVitalSignsAlerts,
} from '../server/src/services/clinical.ts';
import { buildSyntheticCedula } from '../server/src/db/database.ts';
import { validarCedulaEcuador } from '../server/src/utils/validation.ts';

// Usar base de datos SQLite en memoria aislada para la suite de integración
process.env.VITALCONTROL_DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

const { createApp } = await import('../server.ts');

async function requestJson(
  baseUrl: string,
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = {
    'X-Requested-With': 'VitalControl',
    ...(options.headers || {}),
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.cookie) headers.Cookie = options.cookie;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const setCookie = res.headers.getSetCookie?.() || [];
  const rawText = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    json = { rawText };
  }
  return { status: res.status, json, setCookie };
}

test('Cálculos clínicos automáticos: IMC, PAM, presión de pulso y promedio de PA', () => {
  assert.equal(calculateBMI(70, 175), 22.86);
  assert.equal(calculateBMI(null, 175), null);
  assert.equal(calculatePAM(120, 80), 93.3);
  assert.equal(calculatePulsePressure(140, 85), 55);
  assert.equal(calculateAgeYears('1990-05-10', new Date('2026-11-24T12:00:00Z')), 36);

  const readings = [
    {
      numeroMedicion: 1,
      pasMmhg: 150,
      padMmhg: 95,
      brazo: 'izquierdo',
      posicion: 'sentado',
      tamanoManguito: 'estandar_adulto',
      tiempoReposoMin: 5,
      tipoDispositivo: 'Oscilométrico',
      lugarMedicion: 'establecimiento',
    },
    {
      numeroMedicion: 2,
      pasMmhg: 136,
      padMmhg: 86,
      brazo: 'izquierdo',
      posicion: 'sentado',
      tamanoManguito: 'estandar_adulto',
      tiempoReposoMin: 5,
      tipoDispositivo: 'Oscilométrico',
      lugarMedicion: 'establecimiento',
    },
    {
      numeroMedicion: 3,
      pasMmhg: 134,
      padMmhg: 84,
      brazo: 'izquierdo',
      posicion: 'sentado',
      tamanoManguito: 'estandar_adulto',
      tiempoReposoMin: 5,
      tipoDispositivo: 'Oscilométrico',
      lugarMedicion: 'establecimiento',
    },
  ];

  const avgAll = computeBloodPressureAverage(readings, 'promedio_todas');
  assert.equal(avgAll.pasPromedio, 140);
  assert.equal(avgAll.padPromedio, 88.3);

  const avgProtocol = computeBloodPressureAverage(readings, 'descartar_primera_si_hay_2_o_3');
  assert.equal(avgProtocol.pasPromedio, 135);
  assert.equal(avgProtocol.padPromedio, 85);
  assert.deepEqual(avgProtocol.includedIndexes, [2, 3]);
});

test('Validación de cédula ecuatoriana y evaluación de alertas clínicas con embarazo/altitud', () => {
  const cedulaValida = buildSyntheticCedula('171003406');
  assert.equal(validarCedulaEcuador(cedulaValida), true);
  assert.equal(validarCedulaEcuador('1710034069'), false);

  const rules = [
    {
      id: 'rule-pas-general',
      codigo: 'PAS-GEN',
      parametro: 'pas' as const,
      nombre: 'PAS Adulto',
      fuenteClinica: 'MSP',
      versionGuia: 'v1',
      poblacionAplicable: 'Adultos',
      condicionEspecial: 'general',
      altitudMinMsnm: null,
      edadMinAnios: 18,
      edadMaxAnios: 120,
      rangoVerdeMin: 90,
      rangoVerdeMax: 129,
      rangoAmarilloMin: 130,
      rangoAmarilloMax: 139,
      rangoNaranjaMin: 140,
      rangoNaranjaMax: 179,
      rangoRojoMin: 89,
      rangoRojoMax: 180,
      unidad: 'mmHg',
      recomendacionAmarillo: 'Vigilancia',
      recomendacionNaranja: 'Prioritaria',
      recomendacionRojo: 'Inmediata',
      responsableAprobacion: 'Comité',
      fechaActualizacion: '2026-01-01',
      activa: true,
    },
    {
      id: 'rule-pas-preg',
      codigo: 'PAS-EMB',
      parametro: 'pas' as const,
      nombre: 'PAS Gestante',
      fuenteClinica: 'ACOG',
      versionGuia: 'v2',
      poblacionAplicable: 'Gestantes',
      condicionEspecial: 'embarazo',
      altitudMinMsnm: null,
      edadMinAnios: 12,
      edadMaxAnios: 55,
      rangoVerdeMin: 90,
      rangoVerdeMax: 119,
      rangoAmarilloMin: 120,
      rangoAmarilloMax: 139,
      rangoNaranjaMin: 140,
      rangoNaranjaMax: 159,
      rangoRojoMin: 85,
      rangoRojoMax: 160,
      unidad: 'mmHg',
      recomendacionAmarillo: 'Control obstétrico',
      recomendacionNaranja: 'Valoración obstétrica prioritaria',
      recomendacionRojo: 'Emergencia obstétrica',
      responsableAprobacion: 'Jefatura Obstétrica',
      fechaActualizacion: '2026-01-01',
      activa: true,
    },
  ];

  // 165 mmHg en gestante activa alerta ROJA; en adulto general activa NARANJA
  const evalPreg = evaluateVitalSignsAlerts(
    {
      pasPromedio: 165,
      padPromedio: null,
      frecuenciaCardiaca: null,
      frecuenciaRespiratoria: null,
      temperaturaC: null,
      saturacionO2: null,
      glucemiaMgDl: null,
      imc: null,
    },
    null,
    { ageYears: 28, embarazoActual: true, condicionClinicaEspecial: null, altitudMsnm: 100 },
    rules
  );
  assert.equal(evalPreg.nivelGlobal, 'rojo');
});

test('Flujo integral API: autenticación, RBAC, pacientes, signos vitales, reportes y respaldo cifrado', async () => {
  const app = await createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    // 1. Acceso no autenticado rechazado (401)
    const unauth = await requestJson(baseUrl, 'GET', '/api/patients');
    assert.equal(unauth.status, 401);

    // 2. Configuración inicial del administrador
    const setupRes = await requestJson(baseUrl, 'POST', '/api/auth/setup-admin', {
      body: {
        email: 'admin.prueba@vitalcontrol.ec',
        password: 'PasswordSegura123',
        nombres: 'Ana',
        apellidos: 'Vega',
      },
    });
    assert.equal(setupRes.status, 201);
    const adminCookie = setupRes.setCookie[0]?.split(';')[0];
    assert.ok(adminCookie);

    // 3. Crear usuario con rol Consulta (solo lectura)
    const createViewer = await requestJson(baseUrl, 'POST', '/api/admin/users', {
      cookie: adminCookie,
      body: {
        email: 'consulta.prueba@vitalcontrol.ec',
        password: 'PasswordConsulta123',
        nombres: 'Luis',
        apellidos: 'Paredes',
        roleCodigo: 'consulta',
        organizationId: '22222222-2222-4222-8222-222222222201',
      },
    });
    assert.equal(createViewer.status, 201);

    const loginViewer = await requestJson(baseUrl, 'POST', '/api/auth/login', {
      body: {
        email: 'consulta.prueba@vitalcontrol.ec',
        password: 'PasswordConsulta123',
      },
    });
    assert.equal(loginViewer.status, 200);
    const viewerCookie = loginViewer.setCookie[0]?.split(';')[0];
    assert.ok(viewerCookie);

    // 4. Usuario Consulta NO puede crear pacientes ni exportar datos identificables (403)
    const viewerCreatePatient = await requestJson(baseUrl, 'POST', '/api/patients', {
      cookie: viewerCookie,
      body: {
        tipoIdentificacion: 'cedula',
        numeroIdentificacion: buildSyntheticCedula('171111222'),
        numeroHistoriaClinica: 'HC-TEST-99',
        nombres: 'Prueba',
        apellidos: 'Denegada',
        fechaNacimiento: '1985-01-01',
        sexo: 'masculino',
        organizationId: '22222222-2222-4222-8222-222222222201',
      },
    });
    assert.equal(viewerCreatePatient.status, 403);

    const viewerIdentifiableExport = await requestJson(baseUrl, 'POST', '/api/reports/audit-export', {
      cookie: viewerCookie,
      body: { formato: 'PDF', reportType: 'diario', anonymized: false, totalRegistros: 1 },
    });
    assert.equal(viewerIdentifiableExport.status, 403);

    // 5. Administrador registra paciente y previene duplicados
    const cedulaNueva = buildSyntheticCedula('171234567');
    const createPatient = await requestJson(baseUrl, 'POST', '/api/patients', {
      cookie: adminCookie,
      body: {
        tipoIdentificacion: 'cedula',
        numeroIdentificacion: cedulaNueva,
        numeroHistoriaClinica: 'HC-TEST-001',
        nombres: 'Mateo',
        apellidos: 'Rojas',
        fechaNacimiento: '1970-06-15',
        sexo: 'masculino',
        organizationId: '22222222-2222-4222-8222-222222222201',
        antecedenteHta: true,
        antecedenteDiabetes: false,
        embarazoActual: false,
      },
    });
    assert.equal(createPatient.status, 201);
    const createdPatientId = (createPatient.json.patient as { id: string }).id;

    const dupPatient = await requestJson(baseUrl, 'POST', '/api/patients', {
      cookie: adminCookie,
      body: {
        tipoIdentificacion: 'cedula',
        numeroIdentificacion: cedulaNueva,
        numeroHistoriaClinica: 'HC-TEST-002',
        nombres: 'Duplicado',
        apellidos: 'Test',
        fechaNacimiento: '1970-06-15',
        sexo: 'masculino',
        organizationId: '22222222-2222-4222-8222-222222222201',
      },
    });
    assert.equal(dupPatient.status, 409);

    // 6. Registro de signos vitales con campos omitidos en NULL (no 0) e idempotencia
    const vitalRes = await requestJson(baseUrl, 'POST', '/api/vitals', {
      cookie: adminCookie,
      body: {
        clientSubmissionId: 'sub-test-001',
        patientId: createdPatientId,
        fechaMedicion: '2026-11-24T10:00:00-05:00',
        protocoloPa: 'descartar_primera_si_hay_2_o_3',
        bpReadings: [
          {
            numeroMedicion: 1,
            pasMmhg: 152,
            padMmhg: 94,
            brazo: 'izquierdo',
            posicion: 'sentado',
            tamanoManguito: 'estandar_adulto',
            tiempoReposoMin: 5,
            tipoDispositivo: 'Oscilométrico',
            lugarMedicion: 'establecimiento',
          },
          {
            numeroMedicion: 2,
            pasMmhg: 144,
            padMmhg: 90,
            brazo: 'izquierdo',
            posicion: 'sentado',
            tamanoManguito: 'estandar_adulto',
            tiempoReposoMin: 5,
            tipoDispositivo: 'Oscilométrico',
            lugarMedicion: 'establecimiento',
          },
        ],
        pesoKg: 80,
        tallaCm: 175,
        glucemiaMgDl: null,
      },
    });
    assert.equal(vitalRes.status, 201);
    const calc = vitalRes.json.calculated as { pasPromedio: number; padPromedio: number; imc: number };
    assert.equal(calc.pasPromedio, 144);
    assert.equal(calc.padPromedio, 90);
    assert.equal(calc.imc, 26.12);
    assert.equal(vitalRes.json.nivelAlertaGlobal, 'naranja');

    // Doble pulsación prevenida
    const dupVital = await requestJson(baseUrl, 'POST', '/api/vitals', {
      cookie: adminCookie,
      body: {
        clientSubmissionId: 'sub-test-001',
        patientId: createdPatientId,
        fechaMedicion: '2026-11-24T10:00:00-05:00',
      },
    });
    assert.equal(dupVital.status, 200);
    assert.equal(dupVital.json.duplicatePrevented, true);

    // 7. Reporte anonimizado y respaldo cifrado + verificación SHA-256
    const reportAnon = await requestJson(baseUrl, 'GET', '/api/reports/generate?type=diario&anonymized=true', {
      cookie: adminCookie,
    });
    assert.equal(reportAnon.status, 200);
    assert.equal(reportAnon.json.anonymized, true);

    const backupRes = await requestJson(baseUrl, 'GET', '/api/admin/backup', {
      cookie: adminCookie,
    });
    assert.equal(backupRes.status, 200);
    assert.ok(backupRes.json.checksum);
    assert.ok(backupRes.json.encryptedPayload);

    const restoreRes = await requestJson(baseUrl, 'POST', '/api/admin/restore', {
      cookie: adminCookie,
      body: {
        checksum: backupRes.json.checksum,
        encryptedPayload: backupRes.json.encryptedPayload,
      },
    });
    assert.equal(restoreRes.status, 200);
    assert.equal(restoreRes.json.ok, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
