# Manual de Usuario — VitalControl

## 1. Primer ingreso y seguridad
1. Al ingresar por primera vez, el sistema presenta la pantalla de **Configuración inicial del Administrador** para crear la cuenta administradora principal.
2. Desde el botón **Seguridad** en el menú lateral, cada usuario puede cambiar su contraseña y activar la **Autenticación Multifactor (MFA TOTP)** vinculando Google Authenticator o Authy.
3. Por seguridad clínica, las sesiones inactivas se cierran automáticamente tras 30 minutos (configurable).

## 2. Roles de usuario
- **Administrador**: gestiona usuarios, roles, reglas clínicas, auditoría, configuración y copias de seguridad cifradas.
- **Médico**: registra y edita pacientes, toma signos vitales, revisa alertas, enmienda notas clínicas y realiza seguimiento de hipertensión arterial.
- **Enfermería**: registra pacientes, ingresa signos vitales y confirma lectura de alertas en su establecimiento.
- **Consulta**: visualización de solo lectura sobre pacientes autorizados y exportación anonimizada.

## 3. Flujo clínico diario
- **Panel Principal**: consulte indicadores del día, gráficos de tendencia de presión arterial y últimos controles.
- **Pacientes**: busque por cédula, historia clínica, código interno o nombre; abra la ficha individual para revisar historial cronológico, gráficos de evolución y exportar o imprimir.
- **Signos Vitales**: seleccione al paciente, registre 1 a 3 tomas independientes de presión arterial, complete solo los signos medidos (los campos vacíos permanecen nulos) y guarde. Ante valores extremos, el sistema solicitará confirmación sin bloquear mediciones reales.
- **Alertas Clínicas**: confirme la lectura y registre la conducta clínica adoptada.
- **Reportes**: genere estadísticas por paciente y por medición, y exporte en PDF, Excel, CSV o modalidad anonimizada.
