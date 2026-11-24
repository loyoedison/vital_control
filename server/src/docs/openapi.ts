export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'VitalControl API',
    version: '1.0.0',
    description:
      'API REST clínica protegida para VitalControl — Sistema de Registro y Monitoreo de Signos Vitales. Zona horaria: America/Guayaquil.',
  },
  servers: [{ url: '/api', description: 'Servidor API VitalControl' }],
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'vc_session',
      },
    },
  },
  security: [{ cookieAuth: [] }],
  paths: {
    '/auth/status': { get: { summary: 'Estado inicial de configuración y sesión', tags: ['Autenticación'] } },
    '/auth/setup-admin': { post: { summary: 'Alta inicial del primer Administrador', tags: ['Autenticación'] } },
    '/auth/login': { post: { summary: 'Inicio de sesión con correo, contraseña y MFA opcional', tags: ['Autenticación'] } },
    '/auth/logout': { post: { summary: 'Cierre de sesión y auditoría', tags: ['Autenticación'] } },
    '/auth/me': { get: { summary: 'Perfil autenticado actual', tags: ['Autenticación'] } },
    '/auth/change-password': { post: { summary: 'Cambio de contraseña del usuario autenticado', tags: ['Autenticación'] } },
    '/auth/recover': { post: { summary: 'Solicitud de recuperación de contraseña', tags: ['Autenticación'] } },
    '/auth/reset-password': { post: { summary: 'Restablecimiento de contraseña con token temporal', tags: ['Autenticación'] } },
    '/auth/mfa/enroll': { post: { summary: 'Generar secreto TOTP para MFA', tags: ['Autenticación'] } },
    '/auth/mfa/verify': { post: { summary: 'Activar MFA verificando código TOTP', tags: ['Autenticación'] } },
    '/dashboard/summary': { get: { summary: 'Indicadores y gráficos del panel clínico', tags: ['Dashboard'] } },
    '/patients': {
      get: { summary: 'Listar y buscar pacientes autorizados', tags: ['Pacientes'] },
      post: { summary: 'Registrar nuevo paciente', tags: ['Pacientes'] },
    },
    '/patients/{id}': {
      get: { summary: 'Ficha clínica integral e historial del paciente', tags: ['Pacientes'] },
      put: { summary: 'Actualizar datos demográficos auditados del paciente', tags: ['Pacientes'] },
    },
    '/patients/{id}/status': { patch: { summary: 'Activar o desactivar paciente sin eliminación física', tags: ['Pacientes'] } },
    '/vitals': {
      get: { summary: 'Consultar controles de signos vitales', tags: ['Signos Vitales'] },
      post: { summary: 'Registrar control de signos vitales con mediciones múltiples de PA y alertas', tags: ['Signos Vitales'] },
    },
    '/vitals/{id}/amend': { post: { summary: 'Registrar corrección auditada sin sobrescribir original', tags: ['Signos Vitales'] } },
    '/hypertension': {
      get: { summary: 'Listar seguimientos de hipertensión arterial', tags: ['Hipertensión'] },
      post: { summary: 'Registrar evaluación y metas de seguimiento HTA', tags: ['Hipertensión'] },
    },
    '/alerts': { get: { summary: 'Listar alertas clínicas semaforizadas', tags: ['Alertas Clínicas'] } },
    '/alerts/{id}/review': { patch: { summary: 'Confirmar lectura y registrar conducta clínica de alerta', tags: ['Alertas Clínicas'] } },
    '/reports/generate': { get: { summary: 'Generar reportes estadísticos e indicadores', tags: ['Reportes'] } },
    '/reports/audit-export': { post: { summary: 'Registrar descarga de exportación en bitácora de auditoría', tags: ['Reportes'] } },
    '/admin/users': {
      get: { summary: 'Listar usuarios y roles (solo Administrador)', tags: ['Administración'] },
      post: { summary: 'Crear usuario institucional (solo Administrador)', tags: ['Administración'] },
    },
    '/admin/rules': {
      get: { summary: 'Consultar reglas y umbrales clínicos configurados', tags: ['Administración'] },
      put: { summary: 'Actualizar umbral clínico institucional (solo Administrador)', tags: ['Administración'] },
    },
    '/admin/audit': { get: { summary: 'Bitácora de auditoría de seguridad y clínica', tags: ['Administración'] } },
    '/admin/backup': { get: { summary: 'Generar copia de seguridad cifrada JSON', tags: ['Administración'] } },
    '/admin/restore': { post: { summary: 'Restaurar copia de seguridad verificada', tags: ['Administración'] } },
    '/admin/settings': {
      get: { summary: 'Consultar configuración del sistema', tags: ['Administración'] },
      put: { summary: 'Actualizar parámetros del sistema', tags: ['Administración'] },
    },
  },
};
