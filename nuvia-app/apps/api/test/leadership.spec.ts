import { Harness } from './harness';

const DAY = 86_400_000;
const csv = (rows: (string | number)[][]) => rows.map((r) => r.join(',')).join('\n');

// Company totals: Jan rev 1000/tgt 1000, Feb 800/1000, Mar 600/1000 (all Q4 of FY2025-26, which starts in April).
// Quarter so far: revenue 80% of target, margin 12.5%; cash 3,000 with a burn of 300 a month = 10 months.
const HEADER = ['Month', 'Department', 'Revenue', 'Target', 'Cost', 'Cash In', 'Cash Out', 'Closing Cash'];
const SHEET = csv([
  HEADER,
  ['2026-01', 'Sales', 600, 700, 400, 500, 800, ''], ['2026-01', 'Ops', 400, 300, 300, '', '', ''],
  ['2026-02', 'Sales', 500, 700, 400, 500, 800, ''], ['2026-02', 'Ops', 300, 300, 300, '', '', ''],
  ['2026-03', 'Sales', 400, 700, 400, 500, 800, ''], ['2026-03', 'Ops', 200, 300, 300, '', '', 3000],
  ['Total', '', 2400, 3000, 2100, '', '', ''],
]);
const MAPPING = { month: 0, department: 1, revenue: 2, target: 3, cost: 4, cashIn: 5, cashOut: 6, closingCash: 7 };

describe('leadership view', () => {
  let h: Harness;
  let ids: Record<string, string>;
  let t: Record<string, string>;

  beforeAll(async () => {
    h = await Harness.create({ maxImportBytes: 20_000 });
  });
  afterAll(() => h.close());

  beforeEach(async () => {
    await h.reset();
    ids = await h.createUsers(
      { orgId: 'EXEC', role: 'executive', name: 'Asha Exec' },
      { orgId: 'EXEC2', role: 'executive', name: 'Bela Exec' },
      { orgId: 'HR', role: 'hr_admin' },
      { orgId: 'LEAD', role: 'team_lead', name: 'Leena Lead' },
      { orgId: 'ANN', name: 'Ann' },
      { orgId: 'OUT', name: 'Outsider' },
    );
    t = {};
    for (const o of Object.keys(ids)) t[o] = await h.login(o);
  });

  const qs = (o: Record<string, unknown>) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(typeof v === 'string' ? v : JSON.stringify(v))}`).join('&');
  const upload = (who: string, body: string, extra: Record<string, unknown> = {}, path = 'imports') =>
    h.as(t[who]).upload(`/leadership/${path}?${qs({ name: 'rev.csv', mapping: MAPPING, ...extra })}`, Buffer.from(body));
  const importSheet = async (body = SHEET, extra: Record<string, unknown> = {}) => (await upload('EXEC', body, extra).expect(201)).body;
  const execNotes = async (who = 'EXEC') =>
    ((await h.as(t[who]).get('/notifications').expect(200)).body.items as { kind: string; message: string; link: string | null }[]).filter((n) => n.kind === 'leadership_alert');

  describe('access', () => {
    it('is for executives only, on every route', async () => {
      const routes: [string, string][] = [
        ['get', '/leadership/overview'], ['get', '/leadership/alerts'], ['get', '/leadership/finance'], ['get', '/leadership/imports'], ['get', '/leadership/health'],
        ['get', '/leadership/goals'], ['get', '/leadership/people'], ['post', '/leadership/goals'], ['post', '/leadership/imports'], ['post', '/leadership/imports/preview'], ['put', '/leadership/health/rules'],
      ];
      for (const who of ['HR', 'LEAD', 'ANN']) {
        for (const [m, p] of routes) {
          const r = await (h.as(t[who]) as any)[m](p, {});
          expect([who, p, r.status]).toEqual([who, p, 403]);
        }
      }
      await h.http().get('/leadership/overview').expect(401);
    });
  });

  describe('sheet import', () => {
    it('previews a file: sheets, headers, a sample and a suggested mapping, storing nothing', async () => {
      const r = await upload('EXEC', SHEET, {}, 'imports/preview').expect(201);
      expect(r.body.selected).toBe('CSV');
      const s = r.body.sheets[0];
      expect(s.headers).toEqual(HEADER);
      expect(s.headerRow).toBe(1);
      expect(s.rowCount).toBe(7);
      expect(s.sample).toHaveLength(5);
      expect(s.suggested).toEqual(MAPPING);
      expect((await h.db.query('SELECT count(*)::int AS n FROM finance_rows')).rows[0].n).toBe(0);
    });

    it('imports the rows, skips the total row, and records who uploaded what', async () => {
      const r = await importSheet();
      expect(r).toMatchObject({ rows: 6, periodFrom: '2026-01', periodTo: '2026-03', replaced: 0 });
      expect(r.warnings.join(' ')).toMatch(/Skipped 1 total row/);
      const hist = (await h.as(t.EXEC).get('/leadership/imports').expect(200)).body;
      expect(hist[0]).toMatchObject({ fileName: 'rev.csv', rowCount: 6, uploadedBy: 'Asha Exec' });
      const audit = (await h.db.query(`SELECT detail FROM audit_log WHERE action = 'finance.import'`)).rows;
      expect(audit).toHaveLength(1);
      expect(audit[0].detail).toMatchObject({ file: 'rev.csv', rows: 6 });
    });

    it('imports nothing at all when any row is bad, and says which rows', async () => {
      const bad = csv([HEADER, ['2026-01', 'Sales', 600, 700, 400, '', '', ''], ['soon', 'Sales', 1, 1, 1, '', '', ''], ['2026-02', 'Ops', 'lots', 1, 1, '', '', '']]);
      const r = await upload('EXEC', bad).expect(422);
      expect(r.body.totalErrors).toBe(2);
      expect(r.body.errors.map((e: any) => e.row)).toEqual([3, 4]);
      expect(r.body.message).toMatch(/nothing was imported/);
      expect((await h.db.query('SELECT count(*)::int AS n FROM finance_rows')).rows[0].n).toBe(0);
      expect((await h.db.query('SELECT count(*)::int AS n FROM finance_imports')).rows[0].n).toBe(0);
    });

    it('re-importing updates the same months: mapped columns replace (blank clears), unmapped columns stay', async () => {
      await importSheet();
      // Only month, department and target are mapped now: revenue stays, targets change.
      const r = await importSheet(csv([['Month', 'Dept', 'Target'], ['2026-03', 'sales', 900]]), { mapping: { month: 0, department: 1, target: 2 } });
      expect(r.replaced).toBe(1);
      const row = (await h.db.query(`SELECT department, revenue::float8 AS revenue, target::float8 AS target FROM finance_rows WHERE period = '2026-03-01' ORDER BY department`)).rows;
      expect(row).toEqual([{ department: 'Ops', revenue: 200, target: 300 }, { department: 'Sales', revenue: 400, target: 900 }]); // "sales" matched "Sales", casing kept
      // A blank in a mapped column clears the stored figure.
      await importSheet(csv([['Month', 'Dept', 'Revenue'], ['2026-03', 'Sales', '']]), { mapping: { month: 0, department: 1, revenue: 2 } });
      expect((await h.db.query(`SELECT revenue FROM finance_rows WHERE period = '2026-03-01' AND department = 'Sales'`)).rows[0].revenue).toBeNull();
    });

    it('refuses bad requests with clear errors', async () => {
      await upload('EXEC', SHEET, { mapping: { revenue: 2 } }).expect(400); // no month column
      await upload('EXEC', SHEET, { mapping: { month: 0 } }).expect(400); // no figures column
      await upload('EXEC', SHEET, { mapping: { month: 0, revenue: 0 } }).expect(400); // one column used twice
      await upload('EXEC', SHEET, { mapping: { month: 0, revenue: 40 } }).expect(400); // outside the sheet
      await upload('EXEC', SHEET, { mapping: 'not json' }).expect(400);
      await upload('EXEC', SHEET, { sheet: 'Nope' }).expect(400);
      await upload('EXEC', 'x'.repeat(30_000)).expect(413);
      await h.as(t.EXEC).upload('/leadership/imports', Buffer.alloc(0)).expect(400);
      await h.as(t.EXEC).upload(`/leadership/imports?${qs({ mapping: MAPPING })}`, Buffer.from(SHEET), 'text/csv').expect(415);
      await upload('EXEC', 'Month,Revenue\n2026-01,5', { mapping: { month: 0, revenue: 1 }, headerRow: 7 }).expect(400);
    });
  });

  describe('revenue dashboard', () => {
    beforeEach(async () => {
      await importSheet();
    });

    it('returns months, quarters, departments and totals for the fiscal year so far', async () => {
      const d = (await h.as(t.EXEC).get('/leadership/finance').expect(200)).body;
      expect(d).toMatchObject({ currency: 'INR', asOf: '2026-03', fiscalYear: 'FY2025-26', range: { from: '2025-04', to: '2026-03' } });
      expect(d.months.map((m: any) => [m.period, m.revenue, m.target])).toEqual([['2026-01', 1000, 1000], ['2026-02', 800, 1000], ['2026-03', 600, 1000]]);
      expect(d.months[2]).toMatchObject({ attainmentPct: 60, closingCash: 3000, cashIn: 500, cashOut: 800 });
      expect(d.quarters).toEqual([expect.objectContaining({ label: 'Q4 FY2025-26', months: 3, complete: true, revenue: 2400, target: 3000, attainmentPct: 80 })]);
      expect(d.departments.map((x: any) => [x.department, x.revenue, x.attainmentPct])).toEqual([['Sales', 1500, 71.4], ['Ops', 900, 100]]);
      expect(d.totals).toMatchObject({ revenue: 2400, target: 3000, attainmentPct: 80, cost: 2100, marginPct: 12.5, cashIn: 1500, cashOut: 2400 });
    });

    it('honours a chosen range and rejects a backwards one', async () => {
      const d = (await h.as(t.EXEC).get('/leadership/finance?from=2026-02&to=2026-02').expect(200)).body;
      expect(d.months).toHaveLength(1);
      expect(d.totals.revenue).toBe(800);
      expect(d.departments.map((x: any) => x.revenue)).toEqual([500, 300]);
      await h.as(t.EXEC).get('/leadership/finance?from=2026-03&to=2026-01').expect(400);
      await h.as(t.EXEC).get('/leadership/finance?from=March').expect(400);
    });

    it('is empty, not an error, before anything is uploaded', async () => {
      await h.reset();
      ids = await h.createUsers({ orgId: 'EXEC', role: 'executive' });
      const tok = await h.login('EXEC');
      const d = (await h.as(tok).get('/leadership/finance').expect(200)).body;
      expect(d).toMatchObject({ months: [], range: null, totals: null });
    });
  });

  describe('company health', () => {
    it('is unknown with no data, then judges revenue, margin and runway from the sheet', async () => {
      let hl = (await h.as(t.EXEC).get('/leadership/health').expect(200)).body;
      expect(hl.status).toBe('unknown');
      expect(hl.rulesConfirmed).toBeNull();
      await importSheet();
      hl = (await h.as(t.EXEC).get('/leadership/health').expect(200)).body;
      const by = Object.fromEntries(hl.measures.map((m: any) => [m.key, m]));
      expect(by.revenue).toMatchObject({ status: 'at_risk', value: 80 });
      expect(by.margin).toMatchObject({ status: 'at_risk', value: 12.5 });
      expect(by.runway).toMatchObject({ status: 'at_risk', value: 10 });
      expect(by.milestones.status).toBe('no_data');
      expect(hl).toMatchObject({ status: 'at_risk', asOf: '2026-03-01' });
      expect(hl.reason).toMatch(/Revenue is 80% of target.*No data yet for milestone delivery/);
    });

    it('uses the leaders\' own thresholds once they save them, and records the change', async () => {
      await importSheet();
      const rules = (await h.as(t.EXEC).get('/leadership/health').expect(200)).body.rules;
      const strict = { ...rules, revenue: { onTrackMin: 100, atRiskMin: 90 } };
      const saved = await h.as(t.EXEC).put('/leadership/health/rules', strict).expect(200);
      expect(saved.body.confirmed).toMatchObject({ by: 'Asha Exec' });
      const hl = (await h.as(t.EXEC2).get('/leadership/health').expect(200)).body;
      expect(hl.measures.find((m: any) => m.key === 'revenue').status).toBe('off_track'); // 80% is below the new 90% line
      expect(hl.rulesConfirmed).toMatchObject({ by: 'Asha Exec' });
      const audit = (await h.db.query(`SELECT detail FROM audit_log WHERE action = 'leadership.health_rules'`)).rows;
      expect(audit[0].detail.before.revenue.onTrackMin).toBe(95);
      expect(audit[0].detail.after.revenue.onTrackMin).toBe(100);
    });

    it('rejects inverted or incomplete rules and keeps the old ones', async () => {
      const put = (b: object) => h.as(t.EXEC).put('/leadership/health/rules', b);
      const rules = (await h.as(t.EXEC).get('/leadership/health').expect(200)).body.rules;
      await put({ ...rules, revenue: { onTrackMin: 70, atRiskMin: 90 } }).expect(400);
      await put({ revenue: rules.revenue }).expect(400);
      await put({ ...rules, runway: { onTrackMinMonths: 12, atRiskMinMonths: 'six' } }).expect(400);
      expect((await h.as(t.EXEC).get('/leadership/health').expect(200)).body.rulesConfirmed).toBeNull();
    });
  });

  describe('goals, milestones and links', () => {
    let projectId: string;
    let taskIds: string[];

    const mkGoal = async (over: Record<string, unknown> = {}) =>
      (await h.as(t.EXEC).post('/leadership/goals', { title: 'Launch v2', startDate: '2026-01-01', dueDate: '2026-06-30', ownerId: ids.LEAD, ...over }).expect(201)).body;
    const mkMs = async (goalId: string, over: Record<string, unknown> = {}) =>
      (await h.as(t.EXEC).post(`/leadership/goals/${goalId}/milestones`, { title: 'Beta', dueDate: '2026-04-01', ...over }).expect(201)).body;

    beforeEach(async () => {
      projectId = (await h.as(t.LEAD).post('/projects', { key: 'web', name: 'Website' }).expect(201)).body.id;
      await h.as(t.LEAD).post(`/projects/${projectId}/members`, { userId: ids.ANN }).expect(201);
      taskIds = [];
      for (const title of ['one', 'two', 'three', 'four']) taskIds.push((await h.as(t.LEAD).post('/tasks', { projectId, title }).expect(201)).body.id);
    });

    it('creates a goal with validated dates and an active owner', async () => {
      const g = await mkGoal();
      expect(g).toMatchObject({ title: 'Launch v2', status: 'active', ownerName: 'Leena Lead', health: 'on_track', progress: { milestonesTotal: 0, tasksTotal: 0 } });
      await h.as(t.EXEC).post('/leadership/goals', { title: 'x', startDate: '2026-05-01', dueDate: '2026-04-01' }).expect(400);
      await h.as(t.EXEC).post('/leadership/goals', { title: 'x', startDate: '2026-02-30', dueDate: '2026-04-01' }).expect(400);
      await h.as(t.EXEC).post('/leadership/goals', { title: '', startDate: '2026-01-01', dueDate: '2026-04-01' }).expect(400);
      await h.db.query('UPDATE users SET active = false WHERE id = $1', [ids.OUT]);
      await h.as(t.EXEC).post('/leadership/goals', { title: 'x', startDate: '2026-01-01', dueDate: '2026-04-01', ownerId: ids.OUT }).expect(400);
    });

    it('keeps milestones inside the goal\'s dates, both when adding and when the goal moves', async () => {
      const g = await mkGoal();
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/milestones`, { title: 'Late', dueDate: '2026-07-01' }).expect(400);
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/milestones`, { title: 'Early', dueDate: '2025-12-31' }).expect(400);
      const after = await mkMs(g.id, { dueDate: '2026-06-01' });
      expect(after.milestones).toHaveLength(1);
      await h.as(t.EXEC).patch(`/leadership/goals/${g.id}`, { dueDate: '2026-05-01' }).expect(409);
      await h.as(t.EXEC).patch(`/leadership/milestones/${after.milestones[0].id}`, { dueDate: '2026-08-01' }).expect(400);
      await h.as(t.EXEC).patch(`/leadership/goals/${g.id}`, { dueDate: '2026-12-31' }).expect(200);
    });

    it('a goal can only be marked done once every milestone is, and then it is closed to changes', async () => {
      const g = await mkGoal();
      const withMs = await mkMs(g.id);
      const ms = withMs.milestones[0].id;
      await h.as(t.EXEC).patch(`/leadership/goals/${g.id}`, { status: 'done' }).expect(409);
      const done = (await h.as(t.EXEC).patch(`/leadership/milestones/${ms}`, { done: true }).expect(200)).body;
      expect(done.milestones[0]).toMatchObject({ state: 'done' });
      expect(done.progress).toMatchObject({ milestonesDone: 1, milestonesTotal: 1 });
      const closed = (await h.as(t.EXEC).patch(`/leadership/goals/${g.id}`, { status: 'done' }).expect(200)).body;
      expect(closed).toMatchObject({ status: 'done', health: null });
      expect(closed.completedAt).not.toBeNull();
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/milestones`, { title: 'More', dueDate: '2026-05-01' }).expect(409);
      await h.as(t.EXEC).patch(`/leadership/milestones/${ms}`, { done: false }).expect(409);
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/links`, { projectId }).expect(409);
      const reopened = (await h.as(t.EXEC).patch(`/leadership/goals/${g.id}`, { status: 'active' }).expect(200)).body;
      expect(reopened.completedAt).toBeNull();
      await h.as(t.EXEC).patch(`/leadership/milestones/${ms}`, { done: false }).expect(200);
    });

    it('links whole projects and single tasks, rolls their progress up, and refuses duplicates and strangers', async () => {
      const g = await mkGoal();
      const ms = (await mkMs(g.id)).milestones[0].id;
      await h.as(t.LEAD).patch(`/tasks/${taskIds[0]}`, { status: 'done' }).expect(200);
      // One task straight to the goal, the whole project to the milestone (which includes that same task).
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/links`, { taskId: taskIds[0] }).expect(201);
      const linked = (await h.as(t.EXEC).post(`/leadership/goals/${g.id}/links`, { projectId, milestoneId: ms }).expect(201)).body;
      expect(linked.links.map((l: any) => l.kind).sort()).toEqual(['project', 'task']);
      expect(linked.links.find((l: any) => l.kind === 'project')).toMatchObject({ key: 'WEB', openTasks: 3, doneTasks: 1, milestoneId: ms });
      expect(linked.progress).toMatchObject({ tasksTotal: 4, tasksDone: 1 }); // each task counted once
      expect(linked.milestones[0]).toMatchObject({ tasksTotal: 4, tasksDone: 1, suggestDone: false });
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/links`, { projectId, milestoneId: ms }).expect(409);
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/links`, { taskId: taskIds[0] }).expect(409);
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/links`, { projectId: 'b3f1c1c0-0000-4000-8000-000000000000' }).expect(400);
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/links`, {}).expect(400);
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/links`, { projectId, taskId: taskIds[1] }).expect(400);
      const other = await mkGoal({ title: 'Other' });
      const otherMs = (await mkMs(other.id)).milestones[0].id;
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/links`, { taskId: taskIds[2], milestoneId: otherMs }).expect(400);
      // Finishing every linked task nudges, but never auto-completes.
      for (const id of taskIds.slice(1)) await h.as(t.LEAD).patch(`/tasks/${id}`, { status: 'done' }).expect(200);
      const nudged = (await h.as(t.EXEC).get(`/leadership/goals/${g.id}`).expect(200)).body;
      expect(nudged.milestones[0]).toMatchObject({ tasksDone: 4, suggestDone: true, doneAt: null });
      // Unlinking works and the rollup follows.
      const projLink = linked.links.find((l: any) => l.kind === 'project').id;
      const after = (await h.as(t.EXEC).delete(`/leadership/goals/${g.id}/links/${projLink}`).expect(200)).body;
      expect(after.progress.tasksTotal).toBe(1);
      await h.as(t.EXEC).delete(`/leadership/goals/${g.id}/links/${projLink}`).expect(404);
    });

    it('deleting a milestone removes its links but not the goal-level ones', async () => {
      const g = await mkGoal();
      const ms = (await mkMs(g.id)).milestones[0].id;
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/links`, { projectId, milestoneId: ms }).expect(201);
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/links`, { taskId: taskIds[0] }).expect(201);
      const after = (await h.as(t.EXEC).delete(`/leadership/milestones/${ms}`).expect(200)).body;
      expect(after.milestones).toEqual([]);
      expect(after.links.map((l: any) => l.kind)).toEqual(['task']);
    });

    it('shows the linked goal on the project and task pages to people who can see them, and to nobody else', async () => {
      const g = await mkGoal({ title: 'Launch v2' });
      const ms = (await mkMs(g.id, { title: 'Beta', dueDate: '2026-04-01' })).milestones[0].id;
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/links`, { projectId, milestoneId: ms }).expect(201);
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/links`, { taskId: taskIds[0] }).expect(201);
      const proj = (await h.as(t.ANN).get(`/projects/${projectId}`).expect(200)).body;
      expect(proj.goals).toEqual([expect.objectContaining({ title: 'Launch v2', dueDate: '2026-06-30', milestone: expect.objectContaining({ title: 'Beta' }) })]);
      expect(Object.keys(proj.goals[0]).sort()).toEqual(['dueDate', 'goalId', 'milestone', 'startDate', 'title']); // nothing about owners, links or progress
      const task = (await h.as(t.ANN).get(`/tasks/${taskIds[0]}`).expect(200)).body;
      expect(task.goals.map((x: any) => x.milestone?.title ?? null)).toEqual([null, 'Beta']); // directly linked, and through the project
      expect((await h.as(t.ANN).get(`/tasks/${taskIds[1]}`).expect(200)).body.goals).toHaveLength(1); // only through the project
      await h.as(t.OUT).get(`/projects/${projectId}`).expect(404);
      await h.as(t.OUT).get('/leadership/goals').expect(403);
      // Closing the goal takes it off the pages.
      await h.as(t.EXEC).patch(`/leadership/goals/${g.id}`, { status: 'dropped' }).expect(200);
      expect((await h.as(t.ANN).get(`/projects/${projectId}`).expect(200)).body.goals).toEqual([]);
    });

    it('lists goals with a summary the home page uses', async () => {
      const a = await mkGoal({ title: 'A' });
      await mkMs(a.id, { dueDate: '2026-02-01' }); // overdue (today is 2026-03-02) -> off track
      await mkGoal({ title: 'B' });
      const r = (await h.as(t.EXEC).get('/leadership/goals').expect(200)).body;
      expect(r.today).toBe('2026-03-02');
      expect(r.summary).toEqual({ active: 2, onTrack: 1, atRisk: 0, offTrack: 1, done: 0 });
      expect(r.goals.find((g: any) => g.title === 'A').milestones[0]).toMatchObject({ state: 'overdue', daysLeft: -29 });
    });
  });

  describe('alerts', () => {
    const alerts = async (who = 'EXEC') => (await h.as(t[who]).get('/leadership/alerts').expect(200)).body as { key: string; severity: string; title: string; link: string; raisedAt: string }[];

    it('raises revenue, margin and runway alerts from the sheet and tells every executive once', async () => {
      await importSheet();
      const a = await alerts();
      expect(a.map((x) => x.key).sort()).toEqual(['measure:margin', 'measure:revenue', 'measure:runway']);
      expect(a.every((x) => x.severity === 'warning')).toBe(true);
      for (const who of ['EXEC', 'EXEC2']) {
        const n = await execNotes(who);
        expect(n).toHaveLength(3);
        expect(n.find((x) => /Revenue is behind plan/.test(x.message))).toMatchObject({ link: '/leadership/revenue' });
        expect(n[0].message).toMatch(/^At risk: /);
      }
      // Asking again, or the scheduler running, does not repeat them.
      await alerts();
      await alerts('EXEC2');
      expect(await execNotes()).toHaveLength(3);
      // Nobody else hears about money.
      for (const who of ['HR', 'LEAD', 'ANN']) expect(await execNotes(who)).toHaveLength(0);
    });

    it('escalates once when something gets worse, clears when fixed, and tells again if it comes back', async () => {
      await importSheet();
      await alerts();
      // March Sales revenue 400 -> 0: quarter is now 2000/3000 = 66.7% -> off track.
      await importSheet(csv([['Month', 'Dept', 'Revenue'], ['2026-03', 'Sales', 0]]), { mapping: { month: 0, department: 1, revenue: 2 } });
      let a = await alerts();
      expect(a.find((x) => x.key === 'measure:revenue')).toMatchObject({ severity: 'critical' });
      expect(a[0].severity).toBe('critical'); // worst first
      let n = (await execNotes()).filter((x) => /Revenue/.test(x.message));
      expect(n.map((x) => x.message.split(':')[0]).sort()).toEqual(['At risk', 'Off track']);
      await alerts();
      expect((await execNotes()).filter((x) => /Revenue/.test(x.message))).toHaveLength(2);
      // Fix it: back to 800 for Sales -> well above target.
      await importSheet(csv([['Month', 'Dept', 'Revenue'], ['2026-03', 'Sales', 900]]), { mapping: { month: 0, department: 1, revenue: 2 } });
      a = await alerts();
      expect(a.find((x) => x.key === 'measure:revenue')).toBeUndefined();
      expect((await h.db.query(`SELECT resolved_at FROM leadership_alerts WHERE key = 'measure:revenue'`)).rows[0].resolvedAt).not.toBeNull();
      // And it comes back.
      await importSheet(csv([['Month', 'Dept', 'Revenue'], ['2026-03', 'Sales', 0]]), { mapping: { month: 0, department: 1, revenue: 2 } });
      await alerts();
      n = (await execNotes()).filter((x) => /Revenue/.test(x.message));
      expect(n).toHaveLength(3);
    });

    it('flags an overdue milestone as critical and an at-risk one as a warning, and tells the owner too', async () => {
      const project = (await h.as(t.LEAD).post('/projects', { key: 'web', name: 'Website' }).expect(201)).body.id;
      const tasks: string[] = [];
      for (const title of ['a', 'b', 'c', 'd']) tasks.push((await h.as(t.LEAD).post('/tasks', { projectId: project, title }).expect(201)).body.id);
      const g = (await h.as(t.EXEC).post('/leadership/goals', { title: 'Launch v2', startDate: '2026-01-01', dueDate: '2026-06-30' }).expect(201)).body;
      const late = (await h.as(t.EXEC).post(`/leadership/goals/${g.id}/milestones`, { title: 'Spec signed', dueDate: '2026-02-15', ownerId: ids.LEAD }).expect(201)).body.milestones[0];
      const soon = (await h.as(t.EXEC).post(`/leadership/goals/${g.id}/milestones`, { title: 'Beta', dueDate: '2026-03-10', ownerId: ids.LEAD }).expect(201)).body.milestones.find((m: any) => m.title === 'Beta');
      // No linked work yet: Beta can't be judged, only the overdue one raises an alert.
      let a = await alerts();
      expect(a.map((x) => [x.key.split(':')[2], x.severity])).toEqual([['overdue', 'critical']]);
      expect(a[0].link).toBe(`/leadership/goals/${g.id}`);
      expect(a[0].title).toBe('Milestone overdue: Spec signed');
      const mine = ((await h.as(t.LEAD).get('/notifications').expect(200)).body.items as any[]).filter((n) => n.kind === 'leadership_alert');
      expect(mine).toHaveLength(1);
      expect(mine[0].link).toBeNull(); // the owner can't open leadership pages
      expect(await execNotes()).toEqual([expect.objectContaining({ link: `/leadership/goals/${g.id}` })]);

      // Link the project (1 of 4 done) to Beta, due in 8 days: at risk.
      await h.as(t.LEAD).patch(`/tasks/${tasks[0]}`, { status: 'done' }).expect(200);
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/links`, { projectId: project, milestoneId: soon.id }).expect(201);
      a = await alerts();
      expect(a.map((x) => x.title).sort()).toEqual(['Milestone at risk: Beta', 'Milestone overdue: Spec signed']);
      expect(a.find((x) => /Beta/.test(x.title))!.severity).toBe('warning');
      // Work catches up: 2 of 4 is 50%, no longer under the line, so the alert clears by itself.
      await h.as(t.LEAD).patch(`/tasks/${tasks[1]}`, { status: 'done' }).expect(200);
      a = await alerts();
      expect(a.map((x) => x.title)).toEqual(['Milestone overdue: Spec signed']);
      // Finishing the overdue milestone clears the last alert.
      await h.as(t.EXEC).patch(`/leadership/milestones/${late.id}`, { done: true }).expect(200);
      expect(await alerts()).toEqual([]);
    });

    it('moves from at risk to overdue as the days pass, with one more notification', async () => {
      const project = (await h.as(t.LEAD).post('/projects', { key: 'web', name: 'Website' }).expect(201)).body.id;
      await h.as(t.LEAD).post('/tasks', { projectId: project, title: 'a' }).expect(201);
      const g = (await h.as(t.EXEC).post('/leadership/goals', { title: 'G', startDate: '2026-01-01', dueDate: '2026-06-30' }).expect(201)).body;
      const ms = (await h.as(t.EXEC).post(`/leadership/goals/${g.id}/milestones`, { title: 'Beta', dueDate: '2026-03-05' }).expect(201)).body.milestones[0];
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/links`, { projectId: project, milestoneId: ms.id }).expect(201);
      expect((await alerts())[0]).toMatchObject({ severity: 'warning' });
      h.clock.advance(5 * DAY); // 2026-03-07
      expect((await alerts())[0]).toMatchObject({ severity: 'critical', title: 'Milestone overdue: Beta' });
      expect((await execNotes()).map((n) => n.message.split(':')[0]).sort()).toEqual(['At risk', 'Off track']);
      expect((await alerts()).filter((x) => /at_risk/.test(x.key))).toEqual([]);
    });

    it('drops the alerts of a goal that is dropped', async () => {
      const g = (await h.as(t.EXEC).post('/leadership/goals', { title: 'G', startDate: '2026-01-01', dueDate: '2026-06-30' }).expect(201)).body;
      await h.as(t.EXEC).post(`/leadership/goals/${g.id}/milestones`, { title: 'Old', dueDate: '2026-02-01' }).expect(201);
      expect(await alerts()).toHaveLength(1);
      await h.as(t.EXEC).patch(`/leadership/goals/${g.id}`, { status: 'dropped' }).expect(200);
      expect(await alerts()).toEqual([]);
    });
  });

  describe('overview', () => {
    it('gives the home page its verdict, alerts, goal summary and latest import in one call', async () => {
      await importSheet();
      await h.as(t.EXEC).post('/leadership/goals', { title: 'G', startDate: '2026-01-01', dueDate: '2026-06-30' }).expect(201);
      const o = (await h.as(t.EXEC).get('/leadership/overview').expect(200)).body;
      expect(o.health.status).toBe('at_risk');
      expect(o.alerts).toHaveLength(3);
      expect(o.goals).toMatchObject({ active: 1, onTrack: 1 });
      expect(o.latestImport).toMatchObject({ fileName: 'rev.csv' });
    });
  });
});
