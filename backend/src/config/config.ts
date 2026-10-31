export interface AppConfig {
  databaseUrl: string;
  encryptionKey: Buffer;
  appOrigin: string;
  bindAddr: string;
  port: number;
  cookieSecure: boolean;
  trustProxy: number;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
  pendingSessionMinutes: number;
  mfaIssuer: string;
  maxFailedAttempts: number;
  lockoutMinutes: number;
  authRateLimit: number;
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

/** Read and validate configuration. Throws on anything missing or unsafe so the app never starts half-configured. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');

  const keyB64 = env.APP_ENCRYPTION_KEY;
  if (!keyB64) throw new Error('APP_ENCRYPTION_KEY is required (32 random bytes, base64)');
  const encryptionKey = Buffer.from(keyB64, 'base64');
  if (encryptionKey.length !== 32) throw new Error('APP_ENCRYPTION_KEY must decode to exactly 32 bytes');

  const appOrigin = env.APP_ORIGIN;
  if (!appOrigin) throw new Error('APP_ORIGIN is required, e.g. https://nuvia.internal');
  try {
    const u = new URL(appOrigin);
    if (u.origin !== appOrigin) throw new Error('not an origin');
  } catch {
    throw new Error('APP_ORIGIN must be a bare origin such as https://nuvia.internal (no path or trailing slash)');
  }

  const cookieSecure = (env.COOKIE_SECURE ?? 'true') !== 'false';
  if (!cookieSecure && env.NODE_ENV === 'production') {
    throw new Error('COOKIE_SECURE=false is not allowed in production');
  }

  return {
    databaseUrl,
    encryptionKey,
    appOrigin,
    bindAddr: env.BIND_ADDR ?? '127.0.0.1',
    port: int(env, 'PORT', 3000),
    cookieSecure,
    trustProxy: int(env, 'TRUST_PROXY', 0),
    sessionIdleMinutes: int(env, 'SESSION_IDLE_MINUTES', 30),
    sessionAbsoluteHours: int(env, 'SESSION_ABSOLUTE_HOURS', 12),
    pendingSessionMinutes: int(env, 'PENDING_SESSION_MINUTES', 5),
    mfaIssuer: env.MFA_ISSUER ?? 'Nuvia',
    maxFailedAttempts: int(env, 'MAX_FAILED_ATTEMPTS', 5),
    lockoutMinutes: int(env, 'LOCKOUT_MINUTES', 15),
    authRateLimit: int(env, 'AUTH_RATE_LIMIT_PER_MINUTE', 20),
  };
}

export const CONFIG = Symbol('CONFIG');
