import { Harness } from './harness';

describe('desktop agent authentication', () => {
  let h: Harness;
  beforeAll(async () => (h = await Harness.create()));
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.reset();
    await h.createUsers({ orgId: 'REM', mode: 'remote' }, { orgId: 'OFF', mode: 'office' });
  });

  it('lets only remote-mode accounts enroll, and stores the secret encrypted', async () => {
    await h.as(await h.login('OFF')).post('/devices', { name: 'x' }).expect(403);
    const dev = await h.enroll('REM');
    const row = (await h.db.query('SELECT secret_enc FROM devices WHERE id = $1', [dev.deviceId])).rows[0];
    expect(row.secretEnc).not.toContain(dev.secret);
    expect(Buffer.from(row.secretEnc, 'base64').length).toBeGreaterThan(28 + 16);
  });

  it('caps the number of enrolled devices', async () => {
    for (let i = 0; i < h.cfg.maxDevicesPerUser; i++) await h.enroll('REM', `d${i}`);
    await h.as(await h.login('REM')).post('/devices', { name: 'one too many' }).expect(409);
  });

  it('accepts a valid signed request', async () => {
    const dev = await h.enroll('REM');
    const r = await dev.start().expect(200);
    expect(r.body.state).toBe('active');
  });

  it('rejects requests with no signature, or a bearer token instead', async () => {
    await h.http().post('/agent/session/start').send({ seq: 1 }).expect(401);
    const t = await h.login('REM');
    await h.as(t).post('/agent/session/start', { seq: 1 }).expect(401);
  });

  it.each([
    ['wrong secret', (d: any) => ({ secret: 'f'.repeat(64) })],
    ['stale timestamp', (_d: any, now: number) => ({ ts: now - 10 * 60_000 })],
    ['future timestamp', (_d: any, now: number) => ({ ts: now + 10 * 60_000 })],
    ['body changed after signing', () => ({ rawBody: JSON.stringify({ seq: 999 }) })],
    ['signature replayed on another path', () => ({ sendPath: '/agent/heartbeat' })],
  ])('rejects %s with a bare 401', async (_name, tweak) => {
    const dev = await h.enroll('REM');
    const r = await dev.post('/agent/session/start', { seq: 1 }, (tweak as any)(dev, h.clock.now().getTime()));
    expect(r.status).toBe(401);
    expect(r.body.message).toBe('Unauthorized');
  });

  it('blocks a replayed or out-of-order request number', async () => {
    const dev = await h.enroll('REM');
    await dev.post('/agent/session/start', { seq: 5 }).expect(200);
    await dev.post('/agent/session/start', { seq: 5 }).expect(409);
    await dev.post('/agent/session/start', { seq: 4 }).expect(409);
    await dev.post('/agent/session/start', { seq: 6 }).expect(200);
  });

  it('refuses a revoked device and a deactivated user', async () => {
    const dev = await h.enroll('REM');
    await dev.start().expect(200);
    await h.as(await h.login('REM')).post(`/devices/${dev.deviceId}/revoke`).expect(204);
    await dev.start().expect(401);

    const dev2 = await h.enroll('REM', 'second');
    await h.db.query(`UPDATE users SET active = false WHERE org_id = 'REM'`);
    await dev2.start().expect(401);
  });

  it("does not let someone revoke another person's device, but HR can", async () => {
    const { HR, OTHER } = await h.createUsers({ orgId: 'HR', role: 'hr_admin' }, { orgId: 'OTHER', mode: 'remote' });
    void HR; void OTHER;
    const dev = await h.enroll('REM');
    await h.as(await h.login('OTHER')).post(`/devices/${dev.deviceId}/revoke`).expect(404);
    await dev.start().expect(200);
    await h.as(await h.login('HR')).post(`/devices/${dev.deviceId}/revoke`).expect(204);
    await dev.start().expect(401);
    const audit = await h.db.query(`SELECT action FROM audit_log WHERE action = 'device.revoke'`);
    expect(audit.rowCount).toBe(1);
  });

  it('validates heartbeat bodies', async () => {
    const dev = await h.enroll('REM');
    const { sessionId } = (await dev.start()).body;
    await dev.heartbeat(sessionId, { steps: [[9, 5]] }).expect(400);
    await dev.heartbeat(sessionId, { activeSeconds: 90 }).expect(400);
    await dev.heartbeat(sessionId, { extra: 'field' }).expect(400);
    await dev.heartbeat('not-a-uuid').expect(400);
  });

  it('rejects heartbeats for a session that belongs to someone else', async () => {
    const a = await h.enroll('REM');
    await h.createUsers({ orgId: 'REM2', mode: 'remote' });
    const b = await h.enroll('REM2');
    const { sessionId } = (await a.start()).body;
    await b.heartbeat(sessionId).expect(409);
  });
});
