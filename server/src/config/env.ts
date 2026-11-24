import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config();

// Claves en memoria cuando no se han provisto secretos externos en entorno de desarrollo
const ephemeralJwtSecret = crypto.randomBytes(32).toString('hex');
const ephemeralEncryptionKey = crypto.randomBytes(32).toString('hex');

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  appUrl: process.env.APP_URL || 'http://localhost:3000',
  databaseUrl: (process.env.DATABASE_URL || '').trim(),
  supabaseUrl: (process.env.SUPABASE_URL || '').trim(),
  supabaseAnonKey: (process.env.SUPABASE_ANON_KEY || '').trim(),
  supabaseServiceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim(),
  adminBootstrapPasscode: (process.env.ADMIN_BOOTSTRAP_PASSCODE || '').trim(),
  sessionIdleMinutes: Math.max(5, Number(process.env.SESSION_IDLE_MINUTES || 30)),
  jwtSecret: (process.env.JWT_SECRET || ephemeralJwtSecret).trim(),
  dataEncryptionKey: (process.env.DATA_ENCRYPTION_KEY || ephemeralEncryptionKey).trim(),
  timezone: 'America/Guayaquil',
};
