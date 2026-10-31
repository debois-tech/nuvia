import type { Step } from '@nuvia/shared';
import { analyzePath, evaluateWindow } from '../src/attendance/remote/anticheat';
import { DeviceClient, Harness, humanSteps, MIN } from './harness';

const kinds = (steps: Step[], recent: (string | null)[] = []) => evaluateWindow(analyzePath(steps), recent).map((s) => s.kind);

describe('path analysis', () => {
  it('does not flag human-like movement', () => {
    for (let seed = 1; seed <= 50; seed++) expect(kinds(humanSteps(120, seed))).toEqual([]);
  });

  it('does not flag a quiet minute with little movement', () => {
    expect(kinds([[0, 3], [1, 2], [4, 1]])).toEqual([]);
    expect(kinds([])).toEqual([]);
  });

  it('flags a 1px back-and-forth jiggle', () => {
    const jiggle: Step[] = Array.from({ length: 60 }, (_, i) => [i % 2 ? 4 : 0, 1]);
    expect(kinds(jiggle)).toContain('scripted_jiggle');
  });

  it('flags a repeating loop and constant-speed motion', () => {
    const square: Step[] = Array.from({ length: 80 }, (_, i) => [[0, 2, 4, 6][Math.floor(i / 5) % 4], 40]);
    const k = kinds(square);
    expect(k).toContain('scripted_repeating_path');
    expect(k).toContain('scripted_uniform_motion');
  });

  it('flags a short macro loop even when each step has a different length', () => {
    const unit: Step[] = [[0, 17], [2, 31], [4, 9], [6, 44], [1, 23], [5, 12], [3, 38]];
    const loop = Array.from({ length: 70 }, (_, i) => unit[i % unit.length]);
    expect(kinds(loop)).toContain('scripted_repeating_path');
  });

  it('flags the same recorded path replayed in consecutive windows', () => {
    const path = humanSteps(60, 7);
    const hash = analyzePath(path).stepsHash;
    expect(kinds(path, [hash, hash])).toContain('scripted_identical_windows');
    expect(kinds(path, [hash, 'other'])).not.toContain('scripted_identical_windows');
  });
});

describe('anti-cheat through the API', () => {
  let h: Harness;
  let dev: DeviceClient;
  let sessionId: string;
  beforeAll(async () => (h = await Harness.create({ mouseOnlyHours: 3 })));
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.reset();
    await h.createUsers({ orgId: 'LEAD', role: 'team_lead' }, { orgId: 'REM', mode: 'remote', manager: 'LEAD' });
    dev = await h.enroll('REM');
    sessionId = (await dev.start().expect(200)).body.sessionId;
  });
  const flags = async () => (await h.db.query('SELECT kind, severity, status FROM review_flags ORDER BY created_at')).rows;

  it('raises a single flag for a jiggler, not one per check or per minute, and alerts the manager', async () => {
    const jiggle: Step[] = Array.from({ length: 200 }, (_, i) => [i % 2 ? 4 : 0, 1]);
    for (let i = 0; i < 5; i++) {
      h.clock.advance(MIN);
      await dev.heartbeat(sessionId, { steps: jiggle.slice(0, 200 - i * 2), otherInputEvents: 0 }).expect(200); // slightly different each minute
    }
    expect(await flags()).toEqual([{ kind: 'scripted_movement', severity: 'medium', status: 'open' }]);
    const detail = (await h.db.query('SELECT detail FROM review_flags')).rows[0].detail;
    expect(detail.patterns).toEqual(expect.arrayContaining(['jiggle']));
    const lead = await h.login('LEAD');
    const n = (await h.as(lead).get('/notifications')).body.items;
    expect(n.some((x: any) => /looks scripted/.test(x.message))).toBe(true);
  });

  it('flags a replayed recording as high severity', async () => {
    const path = humanSteps(80, 99);
    for (let i = 0; i < 3; i++) {
      h.clock.advance(MIN);
      await dev.heartbeat(sessionId, { steps: path }).expect(200);
    }
    expect(await flags()).toEqual([{ kind: 'scripted_identical_windows', severity: 'high', status: 'open' }]);
  });

  it('does not flag normal work, and never changes the person’s state', async () => {
    for (let i = 0; i < 20; i++) {
      h.clock.advance(MIN);
      const r = await dev.heartbeat(sessionId).expect(200);
      expect(r.body.state).toBe('active');
    }
    expect(await flags()).toEqual([]);
  });

  it('notes hours of mouse-only activity as a low-severity flag with no alert', async () => {
    for (let i = 0; i < 190; i++) {
      h.clock.advance(MIN);
      await dev.heartbeat(sessionId, { otherInputEvents: 0 }).expect(200);
    }
    expect(await flags()).toEqual([{ kind: 'mouse_only_extended', severity: 'low', status: 'open' }]);
    const lead = await h.login('LEAD');
    expect((await h.as(lead).get('/notifications')).body.items).toHaveLength(0);
  });

  it('does not store raw movement, only derived features', async () => {
    await dev.heartbeat(sessionId).expect(200);
    const row = (await h.db.query('SELECT features FROM heartbeats')).rows[0];
    expect(Object.keys(row.features).sort()).toEqual(['extent', 'moveSamples', 'periodicity', 'stepLengthCv', 'stepsHash']);
  });
});
