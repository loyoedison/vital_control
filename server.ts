import cookieParser from 'cookie-parser';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import path from 'node:path';
import swaggerUi from 'swagger-ui-express';
import { createServer as createViteServer } from 'vite';
import { env } from './server/src/config/env.ts';
import { ensureDbInitialized } from './server/src/db/database.ts';
import { openApiSpec } from './server/src/docs/openapi.ts';
import { verifyCsrfForCookieMutations } from './server/src/middleware/auth.ts';
import { adminRouter } from './server/src/routes/admin.routes.ts';
import { alertsRouter } from './server/src/routes/alerts.routes.ts';
import { authRouter } from './server/src/routes/auth.routes.ts';
import { hypertensionRouter } from './server/src/routes/hypertension.routes.ts';
import { patientsRouter } from './server/src/routes/patients.routes.ts';
import { reportsRouter } from './server/src/routes/reports.routes.ts';
import { vitalsRouter } from './server/src/routes/vitals.routes.ts';

export async function createApp() {
  await ensureDbInitialized();

  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      frameguard: false,
    })
  );

  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 180,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes. Espere un momento e intente nuevamente.' },
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos de autenticación. Intente más tarde.' },
  });

  app.use('/api', apiLimiter);
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/recover', authLimiter);
  app.use('/api', verifyCsrfForCookieMutations);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timezone: env.timezone });
  });

  app.get('/api/openapi.json', (_req, res) => {
    res.json(openApiSpec);
  });
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

  app.use('/api/auth', authRouter);
  app.use('/api/patients', patientsRouter);
  app.use('/api/vitals', vitalsRouter);
  app.use('/api/hypertension', hypertensionRouter);
  app.use('/api/alerts', alertsRouter);
  app.use('/api', reportsRouter);
  app.use('/api/admin', adminRouter);

  app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Endpoint no encontrado.' });
  });

  return app;
}

async function startServer() {
  const app = await createApp();

  if (env.nodeEnv !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(env.port, '0.0.0.0', () => {
    console.log(`VitalControl escuchando en http://0.0.0.0:${env.port}`);
  });
}

// Solo arranca servidor HTTP cuando se ejecuta directamente (no durante pruebas unitarias)
if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  startServer().catch((err) => {
    console.error('Error iniciando VitalControl:', err);
    process.exit(1);
  });
}
