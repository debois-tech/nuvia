import { signRequest, verifySignature } from './signing';

describe('request signing', () => {
  const secret = 'a'.repeat(64);
  const body = JSON.stringify({ seq: 1 });
  const ts = 1_700_000_000_000;

  it('verifies a valid signature', () => {
    const sig = signRequest(secret, 'post', '/agent/heartbeat', ts, body);
    expect(verifySignature(secret, 'POST', '/agent/heartbeat', ts, body, sig)).toBe(true);
  });

  it.each([
    ['body', (s: string) => [secret, 'POST', '/agent/heartbeat', ts, body + ' ', s]],
    ['path', (s: string) => [secret, 'POST', '/agent/session/stop', ts, body, s]],
    ['timestamp', (s: string) => [secret, 'POST', '/agent/heartbeat', ts + 1, body, s]],
    ['secret', (s: string) => ['b'.repeat(64), 'POST', '/agent/heartbeat', ts, body, s]],
  ])('rejects a tampered %s', (_n, build) => {
    const sig = signRequest(secret, 'POST', '/agent/heartbeat', ts, body);
    expect((verifySignature as any)(...build(sig))).toBe(false);
  });

  it('rejects malformed signatures without throwing', () => {
    for (const s of ['', 'zz', 'ab'.repeat(31), 'ab'.repeat(33)]) {
      expect(verifySignature(secret, 'POST', '/x', ts, body, s)).toBe(false);
    }
  });
});
