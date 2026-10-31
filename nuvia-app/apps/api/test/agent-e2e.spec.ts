import type { PromptInfo } from '@nuvia/shared';
import { AgentStatus, AgentUi, WorkTracker } from '../../agent/src/core/agent';
import { AgentApi, enrollDevice } from '../../agent/src/core/api';
import { ActivitySampler } from '../../agent/src/core/sampler';
import { Harness, MIN, PASSWORD } from './harness';

/** The real agent code talking to the real API over HTTP, with only the OS inputs and the clock simulated. */
describe('desktop agent end to end', () => {
  let h: Harness;
  let url: string;
  const input = { x: 500, y: 500, idle: 99 };
  const ui = new (class implements AgentUi {
    statuses: AgentStatus[] = [];
    prompts: PromptInfo[] = [];
    setStatus(s: AgentStatus) { this.statuses.push(s); }
    showPrompt(p: PromptInfo) { this.prompts.push(p); }
    hidePrompt() {}
    get status() { return this.statuses[this.statuses.length - 1]; }
  })();

  beforeAll(async () => {
    h = await Harness.create({ idleMinutes: 10, promptGraceSeconds: 120, challengeMinGapMinutes: 30 });
    await h.app.listen(0, '127.0.0.1');
    url = (await h.app.getUrl()).replace('[::1]', '127.0.0.1');
  });
  afterAll(() => h.close());

  it('runs a full day: work, idle prompt, presence check, absent, recovery', async () => {
    await h.reset();
    h.clock.set(new Date()); // the API checks signature timestamps against its clock, so keep it at real time
    await h.createUsers({ orgId: 'LEAD', role: 'team_lead' }, { orgId: 'REM', mode: 'remote', manager: 'LEAD', name: 'Ria' });

    const creds = await enrollDevice(url, 'REM', PASSWORD, 'test laptop');
    const seqStore = { n: 0, load() { return this.n; }, save(v: number) { this.n = v; } };
    const api = new AgentApi(creds, seqStore, () => h.clock.now().getTime());
    const sampler = new ActivitySampler({ readCursor: () => ({ x: input.x, y: input.y }), readIdleSeconds: () => input.idle, now: Date.now });
    const tracker = new WorkTracker(api, sampler, ui, 60_000, 60_000); // timers never fire in test; beats are driven by hand

    const work = async () => {
      for (let i = 0; i < 12; i++) {
        input.x += 3 + (i % 5) * 7;
        input.y += (i % 3) * 4;
        input.idle = 0;
        sampler.poll();
      }
      input.idle = 99;
      h.clock.advance(MIN);
      await tracker.beat();
    };
    const quiet = async (minutes: number) => {
      for (let i = 0; i < minutes; i++) {
        h.clock.advance(MIN);
        await tracker.beat();
        await h.tick();
      }
    };

    await tracker.startWork();
    await work();
    expect(ui.status).toEqual({ kind: 'tracking' });

    // Ten quiet minutes: the server asks, the agent shows the prompt, a click answers it.
    await quiet(10);
    await tracker.beat();
    expect(ui.prompts.at(-1)).toMatchObject({ kind: 'idle' });
    expect(await tracker.answerPrompt(ui.prompts.at(-1)!.id)).toBeNull();

    // Random presence check: a wrong code is rejected with tries left, the right one passes.
    for (let i = 0; i < 31; i++) await work(); // steady work, heartbeat every minute
    h.random.force = true;
    h.random.nextCode = '3917';
    await h.tick();
    h.random.force = false;
    await work();
    const challenge = ui.prompts.at(-1)!;
    expect(challenge).toMatchObject({ kind: 'challenge', code: '3917' });
    expect(await tracker.answerPrompt(challenge.id, '0000')).toBe('That code is wrong. 2 tries left.');
    expect(await tracker.answerPrompt(challenge.id, '3917')).toBeNull();

    // Ignore the next idle prompt: marked absent, manager alerted, agent shows "away".
    await quiet(10);
    await tracker.beat();
    h.clock.advance(121_000);
    await tracker.beat();
    await h.tick();
    await tracker.beat();
    expect(ui.status).toMatchObject({ kind: 'away' });
    const lead = await h.login('LEAD');
    expect((await h.as(lead).get('/notifications')).body.items.map((n: any) => n.message)).toEqual([expect.stringMatching(/Ria \(REM\) was marked absent/)]);

    // Back at the keyboard.
    await work();
    expect(ui.status).toEqual({ kind: 'tracking' });

    h.clock.advance(MIN); // a little more work before logging off
    await tracker.stopWork();
    const rem = await h.login('REM');
    const day = (await h.as(rem).get(`/attendance/me/activity?date=${(await h.as(rem).get('/attendance/me/today')).body.date}`)).body;
    const kinds = day.sessions[0].periods.map((p: any) => p.kind);
    // working, idle but confirmed, working, idle and ignored (so absent), back at work
    expect(kinds).toEqual(['active', 'idle', 'active', 'absent', 'active']);
    expect(day.sessions[0].endReason).toBe('stopped');
    expect(day.flags.map((f: any) => f.kind)).toEqual(['absent']);
  });

  it('is turned away once HR revokes the device', async () => {
    await h.reset();
    h.clock.set(new Date());
    await h.createUsers({ orgId: 'HR', role: 'hr_admin' }, { orgId: 'REM', mode: 'remote' });
    const creds = await enrollDevice(url, 'REM', PASSWORD, 'laptop');
    const api = new AgentApi(creds, { load: () => 0, save: () => undefined }, () => h.clock.now().getTime());
    const sampler = new ActivitySampler({ readCursor: () => ({ x: 0, y: 0 }), readIdleSeconds: () => 99, now: Date.now });
    const localUi = new (class implements AgentUi { last?: AgentStatus; setStatus(s: AgentStatus) { this.last = s; } showPrompt() {} hidePrompt() {} })();
    const tracker = new WorkTracker(api, sampler, localUi, 60_000, 60_000);
    await tracker.startWork();
    await tracker.beat();
    await h.as(await h.login('HR')).post(`/devices/${creds.deviceId}/revoke`).expect(204);
    await tracker.beat();
    expect(localUi.last).toMatchObject({ kind: 'rejected' });
    expect(tracker.working).toBe(false);
  });
});
