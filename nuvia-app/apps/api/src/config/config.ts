import { resolve } from 'node:path';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  databaseUrl: string;
  jwtSecret: string;
  jwtTtlSeconds: number;
  /** 32-byte key used to encrypt device signing secrets at rest. */
  deviceSecretKey: Buffer;
  timezone: string;
  /** Empty list means office check-in is not restricted by network. */
  officeNetworkCidrs: string[];
  /** Passed to Express `trust proxy`. Leave false unless a reverse proxy you control sets X-Forwarded-For. */
  trustProxy: boolean | number | string;
  idleMinutes: number;
  promptGraceSeconds: number;
  agentOfflineSeconds: number;
  offlineAutocloseMinutes: number;
  challengeMeanMinutes: number;
  challengeMinGapMinutes: number;
  mouseOnlyHours: number;
  heartbeatRetentionDays: number;
  maxDevicesPerUser: number;
  clockSkewSeconds: number;
  schedulerEnabled: boolean;
  schedulerIntervalSeconds: number;
  port: number;
  /** Where task attachments are stored on this server's disk. */
  uploadDir: string;
  maxUploadBytes: number;
  /** A task is "due soon" when its due date is today or within this many days (in TIMEZONE). */
  dueSoonDays: number;
}

function num(env: NodeJS.ProcessEnv, key: string, def: number): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a non-negative number`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const prod = env.NODE_ENV === 'production';
  const need = (key: string, devDefault: string): string => {
    const v = env[key];
    if (v) return v;
    if (prod) throw new Error(`${key} must be set in production`);
    return devDefault;
  };
  const keyB64 = need('DEVICE_SECRET_KEY', Buffer.alloc(32, 7).toString('base64'));
  const deviceSecretKey = Buffer.from(keyB64, 'base64');
  if (deviceSecretKey.length !== 32) throw new Error('DEVICE_SECRET_KEY must be 32 bytes, base64 encoded');
  const jwtSecret = need('JWT_SECRET', 'dev-only-secret-change-me');
  if (prod && jwtSecret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production');

  const trust = env.TRUST_PROXY;
  return {
    databaseUrl: need('DATABASE_URL', 'postgres://nuvia:nuvia_dev@127.0.0.1:5432/nuvia'),
    jwtSecret,
    jwtTtlSeconds: num(env, 'JWT_TTL_SECONDS', 12 * 3600),
    deviceSecretKey,
    timezone: env.TIMEZONE || 'Asia/Kolkata',
    officeNetworkCidrs: (env.OFFICE_NETWORK_CIDRS || '').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: trust === undefined || trust === '' || trust === 'false' ? false : trust === 'true' ? true : /^\d+$/.test(trust) ? Number(trust) : trust,
    idleMinutes: num(env, 'IDLE_MINUTES', 10),
    promptGraceSeconds: num(env, 'PROMPT_GRACE_SECONDS', 120),
    agentOfflineSeconds: num(env, 'AGENT_OFFLINE_SECONDS', 180),
    offlineAutocloseMinutes: num(env, 'OFFLINE_AUTOCLOSE_MINUTES', 60),
    challengeMeanMinutes: num(env, 'CHALLENGE_MEAN_MINUTES', 90),
    challengeMinGapMinutes: num(env, 'CHALLENGE_MIN_GAP_MINUTES', 30),
    mouseOnlyHours: num(env, 'MOUSE_ONLY_HOURS', 3),
    heartbeatRetentionDays: num(env, 'HEARTBEAT_RETENTION_DAYS', 90),
    maxDevicesPerUser: num(env, 'MAX_DEVICES_PER_USER', 3),
    clockSkewSeconds: num(env, 'CLOCK_SKEW_SECONDS', 120),
    schedulerEnabled: env.SCHEDULER_ENABLED !== 'false',
    schedulerIntervalSeconds: num(env, 'SCHEDULER_INTERVAL_SECONDS', 15),
    port: num(env, 'PORT', 4000),
    uploadDir: resolve(env.UPLOAD_DIR || './data/uploads'),
    maxUploadBytes: Math.round(num(env, 'MAX_UPLOAD_MB', 10) * 1024 * 1024),
    dueSoonDays: num(env, 'DUE_SOON_DAYS', 1),
  };
}
