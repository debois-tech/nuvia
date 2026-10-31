import type { HeartbeatResponse, PromptInfo } from '@nuvia/shared';
import { signRequest, verifySignature } from '@nuvia/shared';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStatus, AgentUi, WorkTracker } from '../src/core/agent';
import { AgentApi, ApiError } from '../src/core/api';
import { ActivitySampler } from '../src/core/sampler';
import { quantizeStep } from '../src/core/steps';
import { AgentStore } from '../src/core/store';

describe('quantizeStep', () => {
  it.each([
    [10, 0, [0, 10]],
    [0, -10, [2, 10]], // up on screen
    [-10, 0, [4, 10]],
    [0, 10, [6, 10]],
    [7, -7, [1, 10]],
    [7, 7, [7, 10]],
  ])('maps (%i,%i) to %j', (dx, dy, expected) => expect(quantizeStep(dx as number, dy as number)).toEqual(expected));

  it('ignores sub-pixel moves and caps long jumps', () => {
    expect(quantizeStep(0, 0)).toBeNull();
    expect(quantizeStep(0.2, 0.2)).toBeNull();
    expect(quantizeStep(5000, 0)).toEqual([0, 255]);
  });
});

describe('ActivitySampler', () => {
  function rig() {
    let t = 1_000_000_000_000;
    const state = { x: 100, y: 100, idle: 30 };
    const s = new ActivitySampler({ readCursor: () => ({ x: state.x, y: state.y }), readIdleSeconds: () => state.idle, now: () => t });
    const tick = (ms = 200) => {
      t += ms;
      s.poll();
    };
    return { s, state, tick };
  }

  it('reports nothing for an untouched machine', () => {
    const { s, tick } = rig();
    for (let i = 0; i < 50; i++) tick();
    expect(s.flush()).toMatchObject({ activeSeconds: 0, otherInputEvents: 0, steps: [] });
  });

  it('records cursor movement as quantised steps and counts the active seconds', () => {
    const { s, state, tick } = rig();
    tick();
    for (let i = 0; i < 25; i++) {
      state.x += 12;
      state.idle = 0;
      tick();
    }
    const w = s.flush();
    expect(w.steps).toHaveLength(25);
    expect(w.steps.every(([d, l]) => d === 0 && l === 12)).toBe(true);
    expect(w.activeSeconds).toBeGreaterThanOrEqual(4);
    expect(w.activeSeconds).toBeLessThanOrEqual(6);
  });

  it('counts input without cursor movement (keyboard) as other input, with no content', () => {
    const { s, state, tick } = rig();
    tick();
    for (let i = 0; i < 4; i++) {
      state.idle = 0; // a key press resets the OS idle timer
      tick();
      state.idle = 0.6; // time passes, then another key press
      tick();
    }
    const w = s.flush();
    expect(w.steps).toEqual([]);
    expect(w.otherInputEvents).toBe(4);
    expect(w.activeSeconds).toBeGreaterThan(0);
    expect(Object.keys(w).sort()).toEqual(['activeSeconds', 'otherInputEvents', 'steps', 'windowSeconds']);
  });

  it('starts a clean window after each flush', () => {
    const { s, state, tick } = rig();
    tick();
    state.x += 5; state.idle = 0;
    tick();
    expect(s.flush().steps).toHaveLength(1);
    tick(); tick();
    expect(s.flush().steps).toHaveLength(0);
  });
});

class FakeUi implements AgentUi {
  statuses: AgentStatus[] = [];
  prompts: PromptInfo[] = [];
  hidden = 0;
  setStatus(s: AgentStatus) { this.statuses.push(s); }
  showPrompt(p: PromptInfo) { this.prompts.push(p); }
  hidePrompt() { this.hidden++; }
  get last() { return this.statuses[this.statuses.length - 1]; }
}

describe('WorkTracker', () => {
  const quietSampler = () => new ActivitySampler({ readCursor: () => ({ x: 0, y: 0 }), readIdleSeconds: () => 99, now: Date.now });
  function build(api: Partial<AgentApi>) {
    const ui = new FakeUi();
    const t = new WorkTracker(api as AgentApi, quietSampler(), ui, 60_000, 60_000);
    return { t, ui };
  }
  const resp = (state: HeartbeatResponse['state'], prompt: PromptInfo | null = null): HeartbeatResponse => ({ state, prompt, serverTime: new Date().toISOString() });
  const idlePrompt: PromptInfo = { id: 'p1', kind: 'idle', deadlineAt: new Date(Date.now() + 120_000).toISOString() };

  it('shows each prompt once and hides it when the server no longer reports it', async () => {
    const heartbeat = jest.fn().mockResolvedValueOnce(resp('prompted', idlePrompt)).mockResolvedValueOnce(resp('prompted', idlePrompt)).mockResolvedValueOnce(resp('active'));
    const { t, ui } = build({ startSession: async () => ({ sessionId: 's', state: 'active', resumed: false }), heartbeat, stopSession: async () => null });
    await t.startWork();
    await t.beat(); await t.beat();
    expect(ui.prompts).toHaveLength(1);
    await t.beat();
    expect(ui.hidden).toBe(1);
    await t.stopWork();
  });

  it('shows "away" when the server marks the person absent', async () => {
    const { t, ui } = build({ startSession: async () => ({ sessionId: 's', state: 'active', resumed: false }), heartbeat: async () => resp('absent'), stopSession: async () => null });
    await t.startWork();
    await t.beat();
    expect(ui.last).toMatchObject({ kind: 'away' });
    await t.stopWork();
  });

  it('turns a failed network call into "reconnecting" and carries on', async () => {
    const heartbeat = jest.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(resp('active'));
    const { t, ui } = build({ startSession: async () => ({ sessionId: 's', state: 'active', resumed: false }), heartbeat, stopSession: async () => null });
    await t.startWork();
    await t.beat();
    expect(ui.last).toEqual({ kind: 'reconnecting' });
    await t.beat();
    expect(ui.last).toEqual({ kind: 'tracking' });
    await t.stopWork();
  });

  it('starts a fresh session when the server says the old one is closed', async () => {
    const startSession = jest.fn().mockResolvedValueOnce({ sessionId: 's1', state: 'active', resumed: false }).mockResolvedValueOnce({ sessionId: 's2', state: 'active', resumed: false });
    const heartbeat = jest.fn().mockRejectedValueOnce(new ApiError(409, {})).mockResolvedValueOnce(resp('active'));
    const { t } = build({ startSession, heartbeat, stopSession: async () => null });
    await t.startWork();
    await t.beat();
    await t.beat();
    expect(heartbeat.mock.calls[1][0]).toBe('s2');
    await t.stopWork();
  });

  it('stops for good on 401 instead of retrying with a revoked device', async () => {
    const heartbeat = jest.fn().mockRejectedValue(new ApiError(401, {}));
    const { t, ui } = build({ startSession: async () => ({ sessionId: 's', state: 'active', resumed: false }), heartbeat, stopSession: async () => null });
    await t.startWork();
    await t.beat();
    expect(ui.last).toMatchObject({ kind: 'rejected' });
    expect(t.working).toBe(false);
    await t.beat();
    expect(heartbeat).toHaveBeenCalledTimes(1);
  });

  it('turns a wrong challenge code into a friendly message with tries left', async () => {
    const respondToPrompt = jest.fn().mockRejectedValue(new ApiError(422, { attemptsLeft: 2 }));
    const { t } = build({ startSession: async () => ({ sessionId: 's', state: 'active', resumed: false }), heartbeat: async () => resp('active'), respondToPrompt, stopSession: async () => null });
    await t.startWork();
    expect(await t.answerPrompt('p', '0000')).toBe('That code is wrong. 2 tries left.');
    await t.stopWork();
  });
});

describe('AgentApi', () => {
  const creds = { serverUrl: 'https://nuvia.internal:4000', deviceId: 'd1', secret: 's'.repeat(64) };
  const mem = (n = 0) => ({ n, load() { return this.n; }, save(v: number) { this.n = v; } });

  it('signs exactly what it sends, and never reuses a sequence number', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('{"state":"active","prompt":null,"serverTime":"x"}', { status: 200 });
    }) as unknown as typeof fetch;
    const now = 1_800_000_000_000;
    const api = new AgentApi(creds, mem(), () => now, fetchFn);
    await api.heartbeat('s', { windowSeconds: 60, activeSeconds: 1, otherInputEvents: 0, steps: [] });
    await api.heartbeat('s', { windowSeconds: 60, activeSeconds: 1, otherInputEvents: 0, steps: [] });
    const [a, b] = calls;
    const h = a.init.headers as Record<string, string>;
    expect(a.url).toBe('https://nuvia.internal:4000/agent/heartbeat');
    expect(verifySignature(creds.secret, 'POST', '/agent/heartbeat', Number(h['x-nuvia-timestamp']), a.init.body as string, h['x-nuvia-signature'])).toBe(true);
    expect(h['x-nuvia-signature']).toBe(signRequest(creds.secret, 'POST', '/agent/heartbeat', now, a.init.body as string));
    expect(JSON.parse(b.init.body as string).seq).toBeGreaterThan(JSON.parse(a.init.body as string).seq);
  });

  it('keeps sequence numbers rising after a clock rollback', () => {
    const store = mem(5_000_000_000_000_000);
    const api = new AgentApi(creds, store, () => 1_000, async () => new Response('{}'));
    expect(api.nextSeq()).toBe(5_000_000_000_000_001);
  });
});

describe('AgentStore', () => {
  const cipher = { encrypt: (p: string) => `enc:${Buffer.from(p).toString('base64')}`, decrypt: (e: string) => Buffer.from(e.slice(4), 'base64').toString() };

  it('keeps the secret encrypted on disk and restricts file permissions', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'nuvia-agent-')), 'agent.json');
    const store = new AgentStore(file, cipher);
    store.saveCredentials({ serverUrl: 'https://x', deviceId: 'd', secret: 'topsecret' });
    expect(readFileSync(file, 'utf8')).not.toContain('topsecret');
    expect(store.credentials()).toEqual({ serverUrl: 'https://x', deviceId: 'd', secret: 'topsecret' });
    expect(statSync(file).mode & 0o077).toBe(0);
    store.save(42);
    expect(store.load()).toBe(42);
    expect(store.credentials()?.secret).toBe('topsecret');
  });

  it('asks to re-enroll when the secret cannot be decrypted', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'nuvia-agent-')), 'agent.json');
    new AgentStore(file, cipher).saveCredentials({ serverUrl: 'https://x', deviceId: 'd', secret: 's' });
    const broken = new AgentStore(file, { encrypt: cipher.encrypt, decrypt: () => { throw new Error('bad keychain'); } });
    expect(broken.credentials()).toBeNull();
  });
});
