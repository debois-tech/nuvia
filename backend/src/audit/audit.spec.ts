import { computeHash, GENESIS_HASH } from './audit.service';
import { stableStringify } from './stable-json';

const base = {
  ts: new Date('2026-01-01T10:00:00.000Z'),
  actor_id: 'a', actor_org_id: 'NV-1', action: 'user.created', target_type: 'user', target_id: 'b',
  outcome: 'success' as const, ip: '10.8.0.2', user_agent: 'jest', details: { role: 'lead', orgId: 'NV-2' },
};

describe('stableStringify', () => {
  it('ignores key order, which jsonb does not preserve', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });
  it('drops undefined and keeps null', () => {
    expect(stableStringify({ a: undefined, b: null })).toBe('{"b":null}');
  });
});

describe('computeHash', () => {
  it('is deterministic', () => {
    expect(computeHash(GENESIS_HASH, base)).toBe(computeHash(GENESIS_HASH, { ...base, details: { orgId: 'NV-2', role: 'lead' } }));
  });
  it('changes when any field changes', () => {
    const h = computeHash(GENESIS_HASH, base);
    expect(computeHash(GENESIS_HASH, { ...base, action: 'user.deleted' })).not.toBe(h);
    expect(computeHash(GENESIS_HASH, { ...base, outcome: 'failure' })).not.toBe(h);
    expect(computeHash(GENESIS_HASH, { ...base, details: { role: 'executive', orgId: 'NV-2' } })).not.toBe(h);
    expect(computeHash(GENESIS_HASH, { ...base, ts: new Date('2026-01-01T10:00:00.001Z') })).not.toBe(h);
  });
  it('changes when the previous hash changes, which is what links the chain', () => {
    expect(computeHash('f'.repeat(64), base)).not.toBe(computeHash(GENESIS_HASH, base));
  });
});
