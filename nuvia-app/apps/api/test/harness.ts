import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { signRequest, SIGNATURE_HEADERS } from '@nuvia/shared';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { hashPassword } from '../src/auth/password';
import { Clock } from '../src/common/clock';
import { DbService } from '../src/common/db.service';
import { RandomSource } from '../src/common/random';
import { AppConfig, loadConfig } from '../src/config/config';
import { SessionsService } from '../src/attendance/remote/sessions.service';

export const PASSWORD = 'correct-horse-battery';
// 2026-03-02 is a Monday. 04:30 UTC = 10:00 in Asia/Kolkata.
export const START = new Date('2026-03-02T04:30:00Z');

export class TestClock extends Clock {
  private t = new Date(START);
  now() {
    return new Date(this.t);
  }
  advance(ms: number) {
    this.t = new Date(this.t.getTime() + ms);
  }
  set(d: Date) {
    this.t = new Date(d);
  }
}

export class TestRandom extends RandomSource {
  force: boolean | null = null;
  nextCode = '4821';
  chance(p: number) {
    return this.force ?? false;
  }
  code() {
    return this.nextCode;
  }
}

export const SEC = 1000;
export const MIN = 60_000;

export interface UserSpec {
  orgId: string;
  role?: 'employee' | 'team_lead' | 'hr_admin' | 'executive';
  mode?: 'office' | 'remote';
  manager?: string;
  name?: string;
}

export class DeviceClient {
  private seq = 0;
  constructor(private readonly h: Harness, readonly deviceId: string, readonly secret: string) {}

  nextSeq() {
    return ++this.seq;
  }

  /** Sends a correctly signed request. `tweak` lets tests corrupt individual parts. */
  post(path: string, body: Record<string, unknown>, tweak: { ts?: number; secret?: string; sendPath?: string; rawBody?: string } = {}) {
    const raw = tweak.rawBody ?? JSON.stringify(body);
    const ts = tweak.ts ?? this.h.clock.now().getTime();
    const sig = signRequest(tweak.secret ?? this.secret, 'POST', path, ts, JSON.stringify(body));
    return request(this.h.app.getHttpServer())
      .post(tweak.sendPath ?? path)
      .set('content-type', 'application/json')
      .set(SIGNATURE_HEADERS.device, this.deviceId)
      .set(SIGNATURE_HEADERS.timestamp, String(ts))
      .set(SIGNATURE_HEADERS.signature, sig)
      .send(raw);
  }

  start() {
    return this.post('/agent/session/start', { seq: this.nextSeq() });
  }
  stop(sessionId: string) {
    return this.post('/agent/session/stop', { seq: this.nextSeq(), sessionId });
  }
  /** A heartbeat with realistic variable movement unless told otherwise. */
  heartbeat(sessionId: string, over: Record<string, unknown> = {}) {
    return this.post('/agent/heartbeat', {
      seq: this.nextSeq(),
      sessionId,
      windowSeconds: 60,
      activeSeconds: 30,
      otherInputEvents: 5,
      steps: humanSteps(40, this.seq),
      ...over,
    });
  }
  idleHeartbeat(sessionId: string) {
    return this.heartbeat(sessionId, { activeSeconds: 0, otherInputEvents: 0, steps: [] });
  }
  respond(promptId: string, answer?: string) {
    return this.post(`/agent/prompts/${promptId}/respond`, { seq: this.nextSeq(), ...(answer !== undefined ? { answer } : {}) });
  }
}

/** Deterministic pseudo-random movement that varies in direction and speed like a hand does. */
export function humanSteps(n: number, seed: number): [number, number][] {
  let s = (seed * 2654435761) >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let dir = Math.floor(rnd() * 8);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (rnd() < 0.4) dir = (dir + (rnd() < 0.5 ? 1 : 7)) % 8;
    out.push([dir, 1 + Math.floor(rnd() * 70)]);
  }
  return out;
}

export class Harness {
  app!: INestApplication;
  cfg!: AppConfig;
  clock = new TestClock();
  random = new TestRandom();
  db!: DbService;
  sessions!: SessionsService;

  static async create(overrides: Partial<AppConfig> = {}) {
    const h = new Harness();
    h.cfg = {
      ...loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgres://nuvia:nuvia_dev@127.0.0.1:5432/nuvia_test',
        SCHEDULER_ENABLED: 'false',
      }),
      ...overrides,
    };
    const mod = await Test.createTestingModule({ imports: [AppModule.register(h.cfg)] })
      .overrideProvider(Clock).useValue(h.clock)
      .overrideProvider(RandomSource).useValue(h.random)
      .compile();
    h.app = mod.createNestApplication({ rawBody: true });
    configureApp(h.app, h.cfg);
    await h.app.init();
    h.db = h.app.get(DbService);
    h.sessions = h.app.get(SessionsService);
    await h.reset();
    return h;
  }

  async reset() {
    await this.db.query(
      'TRUNCATE leadership_alerts, leadership_settings, goal_links, milestones, goals, finance_rows, finance_imports, audit_log, notifications, task_activity, task_attachments, task_comments, tasks, project_members, projects, review_flags, prompts, heartbeats, activity_periods, remote_sessions, devices, office_attendance, users RESTART IDENTITY CASCADE',
    );
    this.clock.set(START);
    this.random.force = null;
  }

  async close() {
    await this.app.close();
  }

  async createUsers(...specs: UserSpec[]) {
    const hash = await hashPassword(PASSWORD);
    const ids: Record<string, string> = {};
    for (const u of specs) {
      const r = await this.db.query(
        `INSERT INTO users (org_id, name, role, work_mode, password_hash, manager_id)
         VALUES ($1,$2,$3,$4,$5,(SELECT id FROM users WHERE org_id = $6)) RETURNING id`,
        [u.orgId, u.name ?? u.orgId, u.role ?? 'employee', u.mode ?? 'office', hash, u.manager ?? null],
      );
      ids[u.orgId] = r.rows[0].id;
    }
    return ids;
  }

  http() {
    return request(this.app.getHttpServer());
  }

  async login(orgId: string): Promise<string> {
    const r = await this.http().post('/auth/login').send({ orgId, password: PASSWORD }).expect(200);
    return r.body.token;
  }

  /** Authenticated request helper: `h.as(token).get('/x')`. */
  as(token: string) {
    const auth = { Authorization: `Bearer ${token}` };
    const srv = this.app.getHttpServer();
    return {
      get: (p: string) => request(srv).get(p).set(auth),
      post: (p: string, b?: object) => request(srv).post(p).set(auth).send(b ?? {}),
      patch: (p: string, b?: object) => request(srv).patch(p).set(auth).send(b ?? {}),
      put: (p: string, b?: object) => request(srv).put(p).set(auth).send(b ?? {}),
      delete: (p: string) => request(srv).delete(p).set(auth),
      upload: (p: string, data: Buffer | string, type = 'application/octet-stream') => request(srv).post(p).set(auth).set('content-type', type).send(data),
    };
  }

  async enroll(orgId: string, name = 'laptop'): Promise<DeviceClient> {
    const token = await this.login(orgId);
    const r = await this.as(token).post('/devices', { name }).expect(201);
    return new DeviceClient(this, r.body.deviceId, r.body.secret);
  }

  /** Runs the idle/prompt/offline scheduler once at the current fake time. */
  tick() {
    return this.sessions.tick(this.clock.now());
  }
}
