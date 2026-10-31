import { DeviceClient, Harness, MIN, SEC } from './harness';

describe('review screen, employee activity log and notifications', () => {
  let h: Harness;
  let dev: DeviceClient;
  let sessionId: string;
  let ids: Record<string, string>;
  let tokens: Record<string, string>;

  beforeAll(async () => (h = await Harness.create()));
  afterAll(() => h.close());

  beforeEach(async () => {
    await h.reset();
    ids = await h.createUsers(
      { orgId: 'EXEC', role: 'executive' },
      { orgId: 'HR', role: 'hr_admin' },
      { orgId: 'LEAD', role: 'team_lead' },
      { orgId: 'OTHERLEAD', role: 'team_lead' },
      { orgId: 'REM', mode: 'remote', manager: 'LEAD', name: 'Ria' },
      { orgId: 'REM2', mode: 'remote', manager: 'OTHERLEAD' },
      { orgId: 'NOBOSS', mode: 'remote' },
    );
    tokens = {};
    for (const o of ['EXEC', 'HR', 'LEAD', 'OTHERLEAD', 'REM', 'REM2', 'NOBOSS']) tokens[o] = await h.login(o);
    dev = await h.enroll('REM');
    sessionId = (await dev.start().expect(200)).body.sessionId;
    h.clock.advance(MIN);
    await dev.heartbeat(sessionId);
    // 10 idle minutes, prompt ignored -> absent flag.
    for (let i = 0; i < 10; i++) {
      h.clock.advance(MIN);
      await dev.idleHeartbeat(sessionId);
      await h.tick();
    }
    h.clock.advance(121 * SEC);
    await dev.idleHeartbeat(sessionId);
    await h.tick();
  });

  const list = (t: string, q = '') => h.as(tokens[t]).get(`/attendance/review/flags${q}`);
  const flagId = async () => (await h.db.query('SELECT id FROM review_flags LIMIT 1')).rows[0].id as string;

  it('lists flags for the right audience only', async () => {
    expect((await list('LEAD').expect(200)).body).toHaveLength(1);
    expect((await list('HR').expect(200)).body).toHaveLength(1);
    expect((await list('EXEC').expect(200)).body).toHaveLength(1);
    expect((await list('OTHERLEAD').expect(200)).body).toHaveLength(0);
    await list('REM').expect(403);
  });

  it('returns what the review screen needs for each flag', async () => {
    const [f] = (await list('LEAD')).body;
    expect(f).toMatchObject({ kind: 'absent', severity: 'high', status: 'open', orgId: 'REM', name: 'Ria', periodKind: 'absent' });
    expect(f.periodStartedAt).toBeTruthy();
  });

  it('filters by status', async () => {
    expect((await list('LEAD', '?status=resolved')).status).toBe(400);
    expect((await list('LEAD', '?status=open').expect(200)).body).toHaveLength(1);
    expect((await list('LEAD', '?status=dismissed').expect(200)).body).toHaveLength(0);
  });

  it('shows the period timeline in the detail view and records that it was viewed', async () => {
    const id = await flagId();
    const d = (await h.as(tokens.LEAD).get(`/attendance/review/flags/${id}`).expect(200)).body;
    expect(d.periods.map((p: any) => p.kind)).toEqual(['active', 'absent']);
    expect(d.prompts[0]).toMatchObject({ kind: 'idle', status: 'expired' });
    expect(d.heartbeatSummary.heartbeats).toBeGreaterThan(10);
    expect(JSON.stringify(d)).not.toMatch(/steps/);
    const audit = await h.db.query(`SELECT actor_id FROM audit_log WHERE action = 'flag.view'`);
    expect(audit.rows[0].actorId).toBe(ids.LEAD);
  });

  it("hides other teams' flags (404, not 403)", async () => {
    await h.as(tokens.OTHERLEAD).get(`/attendance/review/flags/${await flagId()}`).expect(404);
    await h.as(tokens.OTHERLEAD).post(`/attendance/review/flags/${await flagId()}/resolve`, { decision: 'dismissed', note: 'x' }).expect(404);
  });

  it('lets a lead resolve with a note, once', async () => {
    const id = await flagId();
    await h.as(tokens.LEAD).post(`/attendance/review/flags/${id}/resolve`, { decision: 'excused', note: 'Was in a client call' }).expect(204);
    const row = (await h.db.query('SELECT status, resolution_note, resolved_by FROM review_flags WHERE id = $1', [id])).rows[0];
    expect(row).toEqual({ status: 'excused', resolutionNote: 'Was in a client call', resolvedBy: ids.LEAD });
    await h.as(tokens.LEAD).post(`/attendance/review/flags/${id}/resolve`, { decision: 'confirmed', note: 'again' }).expect(409);
    expect((await list('LEAD', '?status=open')).body).toHaveLength(0);
    expect((await h.db.query(`SELECT 1 FROM audit_log WHERE action = 'flag.resolve'`)).rowCount).toBe(1);
  });

  it('requires a note and a valid decision', async () => {
    const id = await flagId();
    await h.as(tokens.LEAD).post(`/attendance/review/flags/${id}/resolve`, { decision: 'excused', note: '  ' }).expect(400);
    await h.as(tokens.LEAD).post(`/attendance/review/flags/${id}/resolve`, { decision: 'fired', note: 'x' }).expect(400);
  });

  it('keeps executives read-only and lets HR resolve anyone’s', async () => {
    const id = await flagId();
    await h.as(tokens.EXEC).post(`/attendance/review/flags/${id}/resolve`, { decision: 'dismissed', note: 'x' }).expect(403);
    await h.as(tokens.EXEC).get(`/attendance/review/flags/${id}`).expect(200);
    await h.as(tokens.HR).post(`/attendance/review/flags/${id}/resolve`, { decision: 'confirmed', note: 'Reviewed with employee' }).expect(204);
  });

  it('falls back to HR for alerts when the person has no manager', async () => {
    const nb = await h.enroll('NOBOSS');
    const s = (await nb.start().expect(200)).body.sessionId;
    h.clock.advance(4 * MIN);
    await h.tick();
    void s;
    const hrNotes = (await h.as(tokens.HR).get('/notifications')).body.items;
    expect(hrNotes.some((n: any) => /NOBOSS/.test(n.message))).toBe(true);
    expect((await h.as(tokens.LEAD).get('/notifications')).body.items.some((n: any) => /NOBOSS/.test(n.message))).toBe(false);
  });

  it('marks notifications read, only your own', async () => {
    const n = (await h.as(tokens.LEAD).get('/notifications')).body;
    expect(n.unread).toBeGreaterThan(0);
    await h.as(tokens.OTHERLEAD).post(`/notifications/${n.items[0].id}/read`).expect(404);
    await h.as(tokens.LEAD).post(`/notifications/${n.items[0].id}/read`).expect(204);
    await h.as(tokens.LEAD).post('/notifications/read-all').expect(204);
    expect((await h.as(tokens.LEAD).get('/notifications?unread=1')).body.items).toHaveLength(0);
  });

  describe('employee view of their own log', () => {
    it('shows the timeline, totals and flags, with durations', async () => {
      const a = (await h.as(tokens.REM).get('/attendance/me/activity?date=2026-03-02').expect(200)).body;
      expect(a.sessions).toHaveLength(1);
      expect(a.sessions[0].periods.map((p: any) => p.kind)).toEqual(['active', 'absent']);
      expect(a.totals.activeSeconds).toBeGreaterThan(0);
      expect(a.totals.absentSeconds).toBeGreaterThan(0);
      expect(a.flags[0]).toMatchObject({ kind: 'absent', status: 'open' });
    });

    it('is always scoped to the signed-in person', async () => {
      const other = (await h.as(tokens.REM2).get('/attendance/me/activity?date=2026-03-02').expect(200)).body;
      expect(other.sessions).toEqual([]);
      expect(other.flags).toEqual([]);
    });

    it('reports a live tracking indicator', async () => {
      let t = (await h.as(tokens.REM).get('/attendance/me/today').expect(200)).body;
      expect(t.mode).toBe('remote');
      expect(t.session.state).toBe('absent');
      expect(t.session.trackingActive).toBe(false);
      await dev.heartbeat(sessionId);
      t = (await h.as(tokens.REM).get('/attendance/me/today')).body;
      expect(t.session).toMatchObject({ state: 'active', trackingActive: true });
      h.clock.advance(5 * MIN);
      t = (await h.as(tokens.REM).get('/attendance/me/today')).body;
      expect(t.session.trackingActive).toBe(false);
    });

    it('lets the employee explain a flag, which tells the manager, until it is reviewed', async () => {
      const id = await flagId();
      await h.as(tokens.REM2).post(`/attendance/me/flags/${id}/note`, { text: 'not mine' }).expect(404);
      await h.as(tokens.REM).post(`/attendance/me/flags/${id}/note`, { text: 'Reading the spec on paper' }).expect(204);
      const [f] = (await list('LEAD')).body;
      expect(f.employeeNote).toBe('Reading the spec on paper');
      const notes = (await h.as(tokens.LEAD).get('/notifications')).body.items;
      expect(notes.some((n: any) => n.kind === 'flag_explained')).toBe(true);
      await h.as(tokens.LEAD).post(`/attendance/review/flags/${id}/resolve`, { decision: 'excused', note: 'ok' }).expect(204);
      await h.as(tokens.REM).post(`/attendance/me/flags/${id}/note`, { text: 'late' }).expect(403);
    });

    it('shows a lead the same timeline for a report, audited, and refuses for other teams', async () => {
      await h.as(tokens.LEAD).get(`/attendance/review/users/${ids.REM}/activity?date=2026-03-02`).expect(200);
      expect((await h.db.query(`SELECT 1 FROM audit_log WHERE action = 'activity.view'`)).rowCount).toBe(1);
      await h.as(tokens.OTHERLEAD).get(`/attendance/review/users/${ids.REM}/activity?date=2026-03-02`).expect(404);
      await h.as(tokens.LEAD).get(`/attendance/review/users/${ids.REM}/activity`).expect(400);
    });
  });
});
