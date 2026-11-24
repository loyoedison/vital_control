# VitalControl — Sistema de Registro y Monitoreo de Signos Vitales

Plataforma web clínica orientada al personal sanitario para el registro, monitoreo, semaforización de alertas y seguimiento longitudinal de pacientes, con énfasis en hipertensión arterial.

## Características principales

- **Autenticación y Control de Acceso (RBAC + MFA)**: Inicio de sesión con cookies `HttpOnly`, bloqueo temporal por intentos fallidos, cierre automático por inactividad (`America/Guayaquil`), autenticación multifactor TOTP (RFC 6238), recuperación de contraseña y 4 roles (`Administrador`, `Médico`, `Enfermería`, `Consulta`).
- **Módulo de Pacientes**: Código interno automático, validación de cédula ecuatoriana, prevención de duplicados, cifrado AES-256-GCM de datos sensibles de contacto, historial de cambios demográficos e inactivación no destructiva.
- **Signos Vitales y Presión Arterial Multi-Toma**: Hasta 3 lecturas independientes con brazo, posición, tamaño de manguito, reposo previo, dispositivo y lugar de toma; promediado por protocolo institucional; cálculos automáticos de edad, IMC, PAM estimada, presión de pulso y variación respecto al control previo; campos no medidos almacenados como `NULL`.
- **Alertas Clínicas Configurables**: Semaforización (`Verde`, `Amarillo`, `Naranja`, `Rojo`, `Gris`) parametrizada por guía clínica, versión, población, embarazo y altitud (`msnm`), con confirmación de lectura y conducta profesional.
- **Seguimiento de Hipertensión Arterial**: Registro de metas individuales, adherencia, estilo de vida, factores de riesgo cardiovascular y gráficos diarios, semanales, mensuales y anuales.
- **Reportes y Exportación**: Estadísticas descriptivas diferenciadas por paciente único y por medición, exportación auditada en PDF (`jsPDF`), Excel (`ExcelJS`), CSV y modalidad anonimizada para análisis epidemiológico (LOPDP Ecuador).
- **Documentación API**: Especificación OpenAPI 3.0 en `/api/docs`.

## Documentación adicional

- [Guía de instalación y base de datos Supabase/PostgreSQL](docs/INSTALACION.md)
- [Manual de usuario clínico](docs/MANUAL_USUARIO.md)
- [Manual técnico y de seguridad](docs/MANUAL_TECNICO.md)
