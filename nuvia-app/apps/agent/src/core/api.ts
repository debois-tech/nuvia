import type { HeartbeatBody, HeartbeatResponse, PromptResponseBody, SessionState } from '@nuvia/shared';
import { SIGNATURE_HEADERS, signRequest } from '@nuvia/shared';

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: any) {
    super(body?.message ? `${status}: ${body.message}` : `HTTP ${status}`);
  }
}

export interface DeviceCredentials {
  serverUrl: string;
  deviceId: string;
  secret: string;
}

export interface SeqStore {
  /** Last sequence number used, persisted so it keeps increasing across restarts. */
  load(): number;
  save(seq: number): void;
}

/** Signed calls to the Nuvia API. Every request carries an HMAC over method, path, timestamp and body. */
export class AgentApi {
  private lastSeq: number;

  constructor(
    private readonly creds: DeviceCredentials,
    private readonly seqStore: SeqStore,
    private readonly now: () => number = Date.now,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    this.lastSeq = seqStore.load();
  }

  /** Time-based floor means a lost seq file still recovers; the persisted value protects against clock rollback. */
  nextSeq(): number {
    this.lastSeq = Math.max(this.lastSeq + 1, this.now() * 1000);
    this.seqStore.save(this.lastSeq);
    return this.lastSeq;
  }

  private async post<T>(path: string, body: object): Promise<T> {
    const raw = JSON.stringify(body);
    const ts = this.now();
    const res = await this.fetchFn(new URL(path, this.creds.serverUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [SIGNATURE_HEADERS.device]: this.creds.deviceId,
        [SIGNATURE_HEADERS.timestamp]: String(ts),
        [SIGNATURE_HEADERS.signature]: signRequest(this.creds.secret, 'POST', path, ts, raw),
      },
      body: raw,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    const json = text ? safeJson(text) : null;
    if (!res.ok) throw new ApiError(res.status, json);
    return json as T;
  }

  startSession() {
    return this.post<{ sessionId: string; state: SessionState; resumed: boolean }>('/agent/session/start', { seq: this.nextSeq() });
  }

  stopSession(sessionId: string) {
    return this.post<null>('/agent/session/stop', { seq: this.nextSeq(), sessionId });
  }

  heartbeat(sessionId: string, w: Omit<HeartbeatBody, 'seq' | 'sessionId'>) {
    return this.post<HeartbeatResponse>('/agent/heartbeat', { seq: this.nextSeq(), sessionId, ...w });
  }

  respondToPrompt(promptId: string, answer?: string) {
    const body: PromptResponseBody = { seq: this.nextSeq(), ...(answer !== undefined ? { answer } : {}) };
    return this.post<{ ok: true; state: SessionState }>(`/agent/prompts/${promptId}/respond`, body);
  }
}

function safeJson(t: string) {
  try {
    return JSON.parse(t);
  } catch {
    return { message: t.slice(0, 200) };
  }
}

/** One-time enrollment: signs in with the person's org ID and password, then registers this install as a device. */
export async function enrollDevice(serverUrl: string, orgId: string, password: string, deviceName: string, fetchFn: typeof fetch = fetch): Promise<DeviceCredentials> {
  const call = async (path: string, body: object, token?: string) => {
    const res = await fetchFn(new URL(path, serverUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    const json = text ? safeJson(text) : null;
    if (!res.ok) throw new ApiError(res.status, json);
    return json;
  };
  const { token } = await call('/auth/login', { orgId, password });
  const { deviceId, secret } = await call('/devices', { name: deviceName }, token);
  return { serverUrl, deviceId, secret };
}
