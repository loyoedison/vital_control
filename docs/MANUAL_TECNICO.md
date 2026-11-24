# Manual Técnico y de Seguridad — VitalControl

## 1. Arquitectura general
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Recharts, React Hook Form + Zod, jsPDF, ExcelJS.
- **Backend**: Node.js 22, Express, Helmet, Express Rate Limit, Cookie Parser, Swagger UI (`/api/docs`).
- **Persistencia**: PostgreSQL (Supabase) mediante migraciones SQL versionadas (`supabase/migrations/0001_initial_schema.sql`) y esquema Prisma (`prisma/schema.prisma`). Cuando no existe `DATABASE_URL` en el entorno de previsualización, el adaptador utiliza persistencia relacional local SQLite en `.data/vitalcontrol.db` manteniendo integridad referencial y consultas parametrizadas.

## 2. Seguridad desde el diseño (LOPDP Ecuador)
- **Contraseñas**: Hash `scrypt` con sal aleatoria por usuario y comparación en tiempo constante (`timingSafeEqual`).
- **Sesiones**: JWT firmado HMAC-SHA256 almacenado en cookie `HttpOnly; Secure; SameSite=None; Partitioned` con verificación CSRF por origen y cabecera personalizada `X-Requested-With`.
- **Bloqueo y MFA**: Bloqueo temporal de 15 minutos tras 5 intentos fallidos y soporte TOTP RFC 6238 para cuentas privilegiadas.
- **Datos en reposo**: Cifrado AES-256-GCM (`encryptSensitive`/`decryptSensitive`) para teléfonos, direcciones, contactos de emergencia, observaciones sensibles y copias de seguridad con suma de verificación SHA-256.
- **Integridad clínica**: Prohibición de eliminación física de pacientes y sobrescritura de signos vitales; las correcciones generan registros en `vital_sign_amendments` y `audit_logs`.

## 3. Fórmulas clínicas implementadas (`server/src/services/clinical.ts`)
- **IMC**: $\text{peso (kg)} / (\text{talla (m)})^2$
- **PAM estimada**: $(\text{PAS} + 2 \times \text{PAD}) / 3$
- **Presión de pulso**: $\text{PAS} - \text{PAD}$
- **Promediado PA**: configurable (`promedio_todas`, `descartar_primera_si_hay_2_o_3`, `ultima_medicion`).
