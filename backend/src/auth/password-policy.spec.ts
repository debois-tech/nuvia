import { passwordProblem } from './password-policy';

const ctx = { orgId: 'NV-0042', email: 'priya.sharma@example.com' };

describe('passwordProblem', () => {
  it('accepts a long, varied password', () => {
    expect(passwordProblem('correct horse battery staple', ctx)).toBeNull();
  });
  it('rejects short passwords', () => {
    expect(passwordProblem('Short1!', ctx)).toMatch(/at least 12/);
  });
  it('rejects passwords containing the org ID, in any case', () => {
    expect(passwordProblem('my-nv-0042-password', ctx)).toMatch(/org ID/);
  });
  it('rejects passwords containing the email name', () => {
    expect(passwordProblem('priya.sharma-2026-x', ctx)).toMatch(/email/);
  });
  it('rejects repetitive passwords', () => {
    expect(passwordProblem('aaaaaaaaaaaaaaaa', ctx)).toMatch(/repetitive/);
  });
  it('rejects reusing the current password', () => {
    expect(passwordProblem('correct horse battery staple', { ...ctx, current: 'correct horse battery staple' })).toMatch(/differ/);
  });
});
