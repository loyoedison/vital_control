# Guía de Instalación y Configuración — VitalControl

## 1. Requisitos previos
- Node.js 22+
- npm 10+
- Cuenta/Proyecto en **Supabase** (PostgreSQL) o Docker + Docker Compose para despliegue local.

## 2. Instalación de dependencias
```bash
npm install
```

## 3. Configuración de Supabase (PostgreSQL) y variables de entorno
Copie `.env.example` hacia `.env` y complete las credenciales de su proyecto Supabase:
```bash
cp .env.example .env
```

Variables principales:
- `DATABASE_URL`: Cadena de conexión PostgreSQL del pooler o conexión directa de Supabase.
- `DIRECT_URL`: Cadena directa para migraciones Prisma.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: Credenciales de su proyecto Supabase.
- `SESSION_IDLE_MINUTES`: Minutos de inactividad antes del cierre automático de sesión (por defecto `30`).

## 4. Aplicación de migraciones SQL versionadas
### Opción A: Mediante Supabase SQL Editor o CLI
Ejecute el archivo `supabase/migrations/0001_initial_schema.sql` sobre su instancia PostgreSQL en Supabase.

### Opción B: Mediante Prisma CLI
```bash
npx prisma generate
npx prisma migrate deploy
```

## 5. Ejecución local y pruebas
```bash
# Iniciar en modo desarrollo (puerto 3000)
npm run dev

# Ejecutar pruebas automatizadas
npm test

# Compilar para producción
npm run build
npm start
```

## 6. Despliegue con Docker Compose
```bash
docker compose up -d --build
```
La aplicación quedará disponible en `http://localhost:3000` con zona horaria `America/Guayaquil`.
