import { Harness, MIN, SEC, DeviceClient } from './harness';

describe('idle detection, prompts and absent marking', () => {
  let h: Harness;
  let dev: DeviceClient;
  let sessionId: string;
  let leadToken: string;

  beforeAll(async () => (h = await Harness.create({ idleMinutes: 10, promptGraceSeconds: 120, agentOfflineSeconds: 180, offlineAutocloseMinutes: 60 })));
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.reset();
    await h.createUsers({ orgId: 'LEAD', role: 'team_lead' }, { orgId: 'REM', mode: 'remote', manager: 'LEAD', name: 'Ria' });
    dev = await h.enroll('REM');
    sessionId = (await dev.start().expect(200)).body.sessionId;
    leadToken = await h.login('LEAD');
    // One minute of real work first, so the timeline starts with an active period.
    h.clock.advance(MIN);
    await dev.heartbeat(sessionId).expect(200);
  });

  /** Agent stays online but reports no input for `minutes`. */
  async function idleFor(minutes: number) {
    let last: any;
    for (let i = 0; i < minutes; i++) {
      h.clock.advance(MIN);
      last = await dev.idleHeartbeat(sessionId).expect(200);
      await h.tick();
    }
    return last;
  }
  const periods = async () => (await h.db.query('SELECT kind, started_at, ended_at FROM activity_periods ORDER BY started_at, kind')).rows;
  const flags = async () => (await h.db.query('SELECT kind, severity, status FROM review_flags ORDER BY created_at')).rows;

  it('leaves no empty active period when someone is idle from the very start', async () => {
    await dev.stop(sessionId).expect(204);
    sessionId = (await dev.start().expect(200)).body.sessionId;
    await idleFor(10);
    expect((await periods()).filter((x) => x.kind === 'active').length).toBe(1); // only the earlier session's
    const empty = await h.db.query(`SELECT 1 FROM activity_periods WHERE kind = 'active' AND ended_at = started_at`);
    expect(empty.rowCount).toBe(0);
  });

  it('keeps an active person active and sends no prompt', async () => {
    for (let i = 0; i < 30; i++) {
      h.clock.advance(MIN);
      const r = await dev.heartbeat(sessionId).expect(200);
      expect(r.body).toMatchObject({ state: 'active', prompt: null });
      await h.tick();
    }
    expect(await flags()).toEqual([]);
  });

  it('prompts only once the idle threshold is reached', async () => {
    const before = await idleFor(9);
    expect(before.body.prompt).toBeNull();
    await idleFor(1); // the scheduler raises the prompt on this tick; the agent sees it on its next heartbeat
    const at10 = await dev.idleHeartbeat(sessionId).expect(200);
    expect(at10.body.state).toBe('prompted');
    expect(at10.body.prompt).toMatchObject({ kind: 'idle' });
    expect(at10.body.prompt.code).toBeUndefined();
  });

  it('returns to active when the prompt is answered, and keeps the idle stretch on the log', async () => {
    await idleFor(10);
    const hb = await dev.idleHeartbeat(sessionId).expect(200);
    h.clock.advance(30 * SEC);
    await dev.respond(hb.body.prompt.id).expect(200);
    await h.tick();
    expect(await flags()).toEqual([]);
    const p = await periods();
    expect(p.map((x) => x.kind)).toEqual(['active', 'idle', 'active']);
    expect(p[1].endedAt).not.toBeNull();
    expect(p[2].endedAt).toBeNull();
    const next = await dev.heartbeat(sessionId).expect(200);
    expect(next.body).toMatchObject({ state: 'active', prompt: null });
  });

  it('marks absent when the prompt is ignored, flags it and alerts the manager', async () => {
    await idleFor(10);
    h.clock.advance(121 * SEC);
    await dev.idleHeartbeat(sessionId).expect(200);
    await h.tick();
    const hb = await dev.idleHeartbeat(sessionId).expect(200);
    expect(hb.body.state).toBe('absent');
    expect((await periods()).map((x) => x.kind)).toEqual(['active', 'absent']);
    expect(await flags()).toEqual([{ kind: 'absent', severity: 'high', status: 'open' }]);

    const n = await h.as(leadToken).get('/notifications').expect(200);
    expect(n.body.unread).toBe(1);
    expect(n.body.items[0].message).toMatch(/Ria \(REM\) was marked absent/);
    const empToken = await h.login('REM');
    expect((await h.as(empToken).get('/notifications').expect(200)).body.items).toHaveLength(0);
  });

  it('answering after the deadline is refused', async () => {
    await idleFor(10);
    const hb = await dev.idleHeartbeat(sessionId).expect(200);
    h.clock.advance(130 * SEC);
    await dev.respond(hb.body.prompt.id).expect(409);
  });

  it('comes back from absent on real activity, keeping the absent period on record', async () => {
    await idleFor(10);
    h.clock.advance(121 * SEC);
    await dev.idleHeartbeat(sessionId);
    await h.tick();
    expect((await dev.idleHeartbeat(sessionId)).body.state).toBe('absent');
    h.clock.advance(5 * MIN);
    await dev.idleHeartbeat(sessionId);
    await h.tick();
    expect((await dev.idleHeartbeat(sessionId)).body.state).toBe('absent');
    const back = await dev.heartbeat(sessionId).expect(200);
    expect(back.body.state).toBe('active');
    const p = await periods();
    expect(p.map((x) => x.kind)).toEqual(['active', 'absent', 'active']);
    expect(p[1].endedAt).not.toBeNull();
    expect(await flags()).toHaveLength(1);
  });

  it('does not re-prompt immediately after a confirmed idle stretch', async () => {
    await idleFor(10);
    const hb = await dev.idleHeartbeat(sessionId);
    await dev.respond(hb.body.prompt.id).expect(200);
    for (let i = 0; i < 5; i++) {
      h.clock.advance(MIN);
      expect((await dev.idleHeartbeat(sessionId)).body.prompt).toBeNull();
      await h.tick();
    }
  });

  it('flags the agent as offline when heartbeats stop, then recovers when they resume', async () => {
    await dev.heartbeat(sessionId);
    h.clock.advance(4 * MIN);
    await h.tick();
    expect(await flags()).toEqual([{ kind: 'agent_offline', severity: 'medium', status: 'open' }]);
    expect((await h.as(leadToken).get('/notifications')).body.items[0].message).toMatch(/desktop agent stopped reporting/);
    expect((await periods()).map((x) => x.kind)).toEqual(['active', 'offline']);

    await h.tick();
    expect(await flags()).toHaveLength(1);

    const r = await dev.heartbeat(sessionId).expect(200);
    expect(r.body.state).toBe('active');
    expect((await periods()).map((x) => x.kind)).toEqual(['active', 'offline', 'active']);
  });

  it('does not call someone absent when the agent died with a prompt open', async () => {
    await idleFor(10);
    h.clock.advance(5 * MIN);
    await h.tick();
    expect((await flags()).map((f) => f.kind)).toEqual(['agent_offline']);
    expect((await h.db.query('SELECT status FROM prompts')).rows[0].status).toBe('expired');
  });

  it('closes a session whose agent never comes back', async () => {
    h.clock.advance(4 * MIN);
    await h.tick();
    h.clock.advance(61 * MIN);
    await h.tick();
    const s = (await h.db.query('SELECT ended_at, end_reason FROM remote_sessions')).rows[0];
    expect(s.endReason).toBe('agent_lost');
    expect((await periods()).every((p) => p.endedAt)).toBe(true);
  });

  it('ends cleanly on stop, and a new device supersedes an old session', async () => {
    await dev.stop(sessionId).expect(204);
    await dev.heartbeat(sessionId).expect(409);
    const again = (await dev.start().expect(200)).body;
    expect(again.resumed).toBe(false);

    await h.createUsers({ orgId: 'REM-B', mode: 'remote' });
    const second = await h.enroll('REM');
    const s2 = (await second.start().expect(200)).body;
    expect(s2.sessionId).not.toBe(again.sessionId);
    const rows = (await h.db.query('SELECT end_reason FROM remote_sessions WHERE ended_at IS NOT NULL ORDER BY started_at')).rows;
    expect(rows.map((r) => r.endReason)).toEqual(['stopped', 'superseded']);
  });

  it('resumes the same open session when the same device restarts', async () => {
    const r = (await dev.start().expect(200)).body;
    expect(r).toMatchObject({ sessionId, resumed: true });
  });
});

describe('random presence checks', () => {
  let h: Harness;
  let dev: DeviceClient;
  let sessionId: string;

  beforeAll(async () => (h = await Harness.create({ idleMinutes: 10, promptGraceSeconds: 120, challengeMinGapMinutes: 30, challengeMeanMinutes: 90 })));
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.reset();
    await h.createUsers({ orgId: 'LEAD', role: 'team_lead' }, { orgId: 'REM', mode: 'remote', manager: 'LEAD' });
    dev = await h.enroll('REM');
    sessionId = (await dev.start().expect(200)).body.sessionId;
  });
  const flags = async () => (await h.db.query('SELECT kind, severity FROM review_flags ORDER BY created_at')).rows;

  async function activeFor(minutes: number) {
    for (let i = 0; i < minutes; i++) {
      h.clock.advance(MIN);
      await dev.heartbeat(sessionId);
    }
  }

  it('never fires before the minimum gap, even if the dice say so', async () => {
    h.random.force = true;
    await activeFor(20);
    await h.tick();
    expect((await h.db.query('SELECT 1 FROM prompts')).rowCount).toBe(0);
  });

  it('issues a code after the gap, and the right answer clears it with no flag', async () => {
    await activeFor(31);
    h.random.force = true;
    h.random.nextCode = '7305';
    await h.tick();
    const hb = await dev.heartbeat(sessionId).expect(200);
    expect(hb.body.prompt).toMatchObject({ kind: 'challenge', code: '7305' });
    h.random.force = false;
    await dev.respond(hb.body.prompt.id, '7305').expect(200);
    expect(await flags()).toEqual([]);
    expect((await dev.heartbeat(sessionId)).body.prompt).toBeNull();
  });

  it('does not challenge again within the minimum gap', async () => {
    await activeFor(31);
    h.random.force = true;
    await h.tick();
    const hb = await dev.heartbeat(sessionId);
    await dev.respond(hb.body.prompt.id, h.random.nextCode).expect(200);
    await activeFor(10);
    await h.tick();
    expect((await h.db.query('SELECT 1 FROM prompts')).rowCount).toBe(1);
  });

  it('allows retries, then flags after three wrong answers without marking absent', async () => {
    await activeFor(31);
    h.random.force = true;
    await h.tick();
    h.random.force = false;
    const hb = await dev.heartbeat(sessionId);
    const id = hb.body.prompt.id;
    expect((await dev.respond(id, '0000').expect(422)).body.attemptsLeft).toBe(2);
    expect((await dev.respond(id, '1111').expect(422)).body.attemptsLeft).toBe(1);
    expect((await dev.respond(id, '2222').expect(422)).body.attemptsLeft).toBe(0);
    expect(await flags()).toEqual([{ kind: 'challenge_failed', severity: 'medium' }]);
    expect((await dev.heartbeat(sessionId)).body.state).toBe('active');
    await dev.respond(id, h.random.nextCode).expect(409);
  });

  it('flags a check that is ignored, but leaves the person marked active', async () => {
    await activeFor(31);
    h.random.force = true;
    await h.tick();
    h.random.force = false;
    h.clock.advance(121 * SEC);
    await dev.heartbeat(sessionId);
    await h.tick();
    expect(await flags()).toEqual([{ kind: 'challenge_failed', severity: 'medium' }]);
    expect((await dev.heartbeat(sessionId)).body.state).toBe('active');
    expect((await h.db.query(`SELECT 1 FROM activity_periods WHERE kind = 'absent'`)).rowCount).toBe(0);
  });

  it('cannot answer another person’s prompt', async () => {
    await activeFor(31);
    h.random.force = true;
    await h.tick();
    const hb = await dev.heartbeat(sessionId);
    await h.createUsers({ orgId: 'REM2', mode: 'remote' });
    const other = await h.enroll('REM2');
    await other.respond(hb.body.prompt.id, h.random.nextCode).expect(404);
  });
});
