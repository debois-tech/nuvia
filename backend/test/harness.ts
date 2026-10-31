import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { authenticator } from 'otplib';
import { Client as PgClient } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { loadConfig } from '../src/config/config';
import { DbService } from '../src/db/db.service';
import { migrate } from '../src/db/migrate';
import { configureApp } from '../src/setup';
import { UsersService } from '../src/users/users.service';

export const ORIGIN = 'https://nuvia.test';
export const COOKIE = 'nuvia_sid';
export const STRONG = 'correct horse battery staple';

const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? 'postgres://nuvia:test@127.0.0.1:55432/postgres';

export async function freshDatabase(name: string): Promise<string> {
  const admin = new PgClient({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/[^/]*$/, `/${name}`);
  await migrate(url);
  return url;
}

export interface TestApp {
  app: INestApplication;
  db: DbService;
  users: UsersService;
  server: any;
  close(): Promise<void>;
}

export async function startApp(databaseUrl: string, extraEnv: Record<string, string> = {}): Promise<TestApp> {
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    APP_ORIGIN: ORIGIN,
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    COOKIE_SECURE: 'false',
    AUTH_RATE_LIMIT_PER_MINUTE: '10000',
    NODE_ENV: 'test',
    ...extraEnv,
  });
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = module.createNestApplication();
  configureApp(app, loadConfig());
  await app.init();
  return {
    app,
    db: app.get(DbService),
    users: app.get(UsersService),
    server: app.getHttpServer(),
    close: () => app.close(),
  };
}

/** A cookie-keeping client that always sends the right Origin, like a browser on the portal would. */
export function client(server: any, origin: string | null = ORIGIN) {
  const agent = request.agent(server);
  const withOrigin = (r: request.Test) => (origin ? r.set('Origin', origin) : r);
  return {
    get: (url: string) => withOrigin(agent.get(url)),
    post: (url: string, body?: object) => withOrigin(agent.post(url)).send(body ?? {}),
    patch: (url: string, body?: object) => withOrigin(agent.patch(url)).send(body ?? {}),
  };
}
export type Api = ReturnType<typeof client>;

/** A valid authenticator code for `secret`, at an offset of whole 30s steps from now (the server accepts -1..+1). */
export function codeFor(secret: string, stepOffset = 0): string {
  return authenticator.clone({ epoch: Date.now() + stepOffset * 30_000 }).generate(secret);
}

export interface Onboarded {
  id: string;
  orgId: string;
  password: string;
  secret: string;
  recoveryCodes: string[];
  c: Api;
}

/** Create a user as `admin`, then take them through first sign-in: temp password, new password, MFA setup. */
export async function onboard(t: TestApp, admin: Api, orgId: string, role: string, password = STRONG): Promise<Onboarded> {
  const created = await admin.post('/admin/users', { orgId, name: `User ${orgId}`, email: `${orgId.toLowerCase()}@example.com`, role });
  if (created.status !== 201) throw new Error(`create ${orgId} failed: ${created.status} ${JSON.stringify(created.body)}`);
  const c = client(t.server);
  const temp = created.body.temporaryPassword;
  const login = await c.post('/auth/login', { orgId, password: temp });
  if (login.body.stage !== 'pending_password') throw new Error(`expected pending_password, got ${JSON.stringify(login.body)}`);
  const changed = await c.post('/auth/change-password', { currentPassword: temp, newPassword: password });
  if (changed.body.stage !== 'pending_enroll') throw new Error(`password change failed: ${JSON.stringify(changed.body)}`);
  const start = await c.post('/auth/mfa/enroll/start');
  const secret: string = start.body.secret;
  const done = await c.post('/auth/mfa/enroll/confirm', { code: codeFor(secret) });
  if (done.body.stage !== 'active') throw new Error(`enrol failed: ${JSON.stringify(done.body)}`);
  return { id: created.body.user.id, orgId, password, secret, recoveryCodes: done.body.recoveryCodes, c };
}

/** Sign an already-onboarded user in again from scratch (new client). Clears the replay guard so tests can sign in repeatedly. */
export async function signIn(t: TestApp, u: Pick<Onboarded, 'id' | 'orgId' | 'password' | 'secret'>): Promise<Api> {
  await t.db.query('UPDATE users SET mfa_last_step = 0, failed_attempts = 0, locked_until = NULL WHERE id = $1', [u.id]);
  const c = client(t.server);
  const l = await c.post('/auth/login', { orgId: u.orgId, password: u.password });
  if (l.body.stage !== 'pending_mfa') throw new Error(`expected pending_mfa, got ${JSON.stringify(l.body)}`);
  const v = await c.post('/auth/mfa/verify', { code: codeFor(u.secret) });
  if (v.body.stage !== 'active') throw new Error(`mfa verify failed: ${JSON.stringify(v.body)}`);
  return c;
}

export async function bootstrapAdmin(t: TestApp, orgId = 'NV-ADMIN'): Promise<Onboarded> {
  const { user, temporaryPassword } = await t.users.create(
    { orgId, name: 'First Admin', email: `${orgId.toLowerCase()}@example.com`, role: 'hr_admin' },
    null,
    { ip: null, userAgent: 'test' },
  );
  const c = client(t.server);
  await c.post('/auth/login', { orgId, password: temporaryPassword });
  await c.post('/auth/change-password', { currentPassword: temporaryPassword, newPassword: STRONG });
  const start = await c.post('/auth/mfa/enroll/start');
  const done = await c.post('/auth/mfa/enroll/confirm', { code: codeFor(start.body.secret) });
  return { id: user.id, orgId, password: STRONG, secret: start.body.secret, recoveryCodes: done.body.recoveryCodes, c };
}

/** Sign in with plain supertest and return the raw session cookie ("name=value"), for tests that need to replay it elsewhere. */
export async function rawSession(t: TestApp, u: Pick<Onboarded, 'id' | 'orgId' | 'password' | 'secret'>): Promise<string> {
  await t.db.query('UPDATE users SET mfa_last_step = 0, failed_attempts = 0, locked_until = NULL WHERE id = $1', [u.id]);
  const login = await request(t.server).post('/auth/login').set('Origin', ORIGIN).send({ orgId: u.orgId, password: u.password });
  const pending = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  const verify = await request(t.server).post('/auth/mfa/verify').set('Origin', ORIGIN).set('Cookie', pending).send({ code: codeFor(u.secret) });
  return (verify.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
}
