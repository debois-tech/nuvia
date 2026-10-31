import request from 'supertest';
import {
  bootstrapAdmin, client, codeFor, freshDatabase, onboard, ORIGIN, rawSession, signIn, startApp, STRONG, TestApp,
} from './harness';

describe('sign-in with org ID, password and MFA', () => {
  let t: TestApp;
  let admin: Awaited<ReturnType<typeof bootstrapAdmin>>;

  beforeAll(async () => {
    t = await startApp(await freshDatabase('nuvia_e2e_auth'));
    admin = await bootstrapAdmin(t);
  });
  afterAll(() => t.close());

  const audit = async (action: string) =>
    (await t.db.query('SELECT * FROM audit_log WHERE action = $1 ORDER BY id', [action])).rows;

  it('is reachable only with a session, apart from health and login', async () => {
    const c = client(t.server);
    expect((await c.get('/health')).status).toBe(200);
    expect((await c.get('/auth/me')).status).toBe(401);
    expect((await c.get('/admin/users')).status).toBe(401);
    expect((await c.get('/audit')).status).toBe(401);
  });

  it('walks a new account through temp password, new password and MFA setup, in that order', async () => {
    const created = await admin.c.post('/admin/users', { orgId: 'NV-0001', name: 'Asha Rao', email: 'asha@example.com', role: 'employee' });
    expect(created.status).toBe(201);
    const temp = created.body.temporaryPassword;
    expect(temp).toHaveLength(16);

    const c = client(t.server);
    const login = await c.post('/auth/login', { orgId: 'nv-0001', password: temp }); // org ID is case-insensitive
    expect(login.status).toBe(200);
    expect(login.body).toEqual({ stage: 'pending_password' });
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0];
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);

    // Half signed-in: nothing works yet, and the admin who knows the temp password cannot skip ahead to MFA.
    const me = await c.get('/auth/me');
    expect(me.status).toBe(403);
    expect(me.body.code).toBe('SIGN_IN_INCOMPLETE');
    expect((await c.post('/auth/mfa/enroll/start')).status).toBe(403);

    expect((await c.post('/auth/change-password', { currentPassword: 'not-the-temp', newPassword: STRONG })).status).toBe(401);
    expect((await c.post('/auth/change-password', { currentPassword: temp, newPassword: 'short' })).status).toBe(400);
    const changed = await c.post('/auth/change-password', { currentPassword: temp, newPassword: STRONG });
    expect(changed.body).toEqual({ stage: 'pending_enroll' });

    const start = await c.post('/auth/mfa/enroll/start');
    expect(start.status).toBe(200);
    expect(start.body.otpauthUri).toContain('otpauth://totp/');
    expect(start.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect((await c.post('/auth/mfa/enroll/confirm', { code: '000000' })).status).toBe(401);

    const done = await c.post('/auth/mfa/enroll/confirm', { code: codeFor(start.body.secret) });
    expect(done.status).toBe(200);
    expect(done.body.stage).toBe('active');
    expect(done.body.recoveryCodes).toHaveLength(10);
    expect(done.body.user.role).toBe('employee');

    const now = await c.get('/auth/me');
    expect(now.status).toBe(200);
    expect(now.body.orgId).toBe('NV-0001');
    expect(now.body.permissions).toEqual(['attendance:self', 'tasks:self']);
  });

  it('never stores the MFA secret or recovery codes in the clear', async () => {
    const u = await onboard(t, admin.c, 'NV-0002', 'employee');
    const row = (await t.db.query('SELECT mfa_secret_enc FROM users WHERE id = $1', [u.id])).rows[0];
    expect(row.mfa_secret_enc.startsWith('v1.')).toBe(true);
    expect(row.mfa_secret_enc).not.toContain(u.secret);
    const hashes = (await t.db.query('SELECT code_hash FROM recovery_codes WHERE user_id = $1', [u.id])).rows.map((r) => r.code_hash);
    expect(hashes).toHaveLength(10);
    for (const code of u.recoveryCodes) expect(hashes).not.toContain(code);
  });

  it('answers wrong password, unknown org ID and disabled account identically', async () => {
    const u = await onboard(t, admin.c, 'NV-0003', 'employee');
    await admin.c.patch(`/admin/users/${(await onboard(t, admin.c, 'NV-0004', 'employee')).id}`, { active: false });
    const attempts = [
      { orgId: u.orgId, password: 'wrong-password-123' },
      { orgId: 'NV-NOBODY', password: STRONG },
      { orgId: 'NV-0004', password: STRONG },
    ];
    const results = [];
    for (const a of attempts) results.push(await client(t.server).post('/auth/login', a));
    for (const r of results) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual(results[0].body);
      expect(r.headers['set-cookie']).toBeUndefined();
    }
    const reasons = (await audit('auth.login')).filter((r) => r.outcome === 'failure').map((r) => r.details.reason);
    expect(reasons).toEqual(expect.arrayContaining(['bad_password', 'unknown_org_id', 'inactive']));
  });

  it('requires an MFA code after the password, and rejects a wrong one', async () => {
    const u = await onboard(t, admin.c, 'NV-0005', 'employee');
    await t.db.query('UPDATE users SET mfa_last_step = 0 WHERE id = $1', [u.id]);
    const c = client(t.server);
    expect((await c.post('/auth/login', { orgId: u.orgId, password: u.password })).body.stage).toBe('pending_mfa');
    expect((await c.get('/auth/me')).status).toBe(403);
    expect((await c.post('/auth/mfa/verify', { code: '123456' })).status).toBe(401);
    expect((await c.post('/auth/mfa/verify', { code: 'abc' })).status).toBe(400);
    expect((await c.post('/auth/mfa/verify', { code: codeFor(u.secret) })).status).toBe(200);
    expect((await c.get('/auth/me')).status).toBe(200);
  });

  it('rejects a replayed authenticator code', async () => {
    const u = await onboard(t, admin.c, 'NV-0006', 'employee');
    await t.db.query('UPDATE users SET mfa_last_step = 0 WHERE id = $1', [u.id]);
    const code = codeFor(u.secret);
    const first = client(t.server);
    await first.post('/auth/login', { orgId: u.orgId, password: u.password });
    expect((await first.post('/auth/mfa/verify', { code })).status).toBe(200);
    const second = client(t.server);
    await second.post('/auth/login', { orgId: u.orgId, password: u.password });
    expect((await second.post('/auth/mfa/verify', { code })).status).toBe(401);
  });

  it('accepts each recovery code once', async () => {
    const u = await onboard(t, admin.c, 'NV-0007', 'employee');
    const code = u.recoveryCodes[0];
    const first = client(t.server);
    await first.post('/auth/login', { orgId: u.orgId, password: u.password });
    expect((await first.post('/auth/mfa/verify', { code: code.toLowerCase() })).status).toBe(200);
    const second = client(t.server);
    await second.post('/auth/login', { orgId: u.orgId, password: u.password });
    expect((await second.post('/auth/mfa/verify', { code })).status).toBe(401);
    const used = await audit('auth.recovery_code_used');
    expect(used.at(-1).details.remaining).toBe(9);
  });

  it('swaps the pending session for a new token once MFA passes', async () => {
    const u = await onboard(t, admin.c, 'NV-0008', 'employee');
    await t.db.query('UPDATE users SET mfa_last_step = 0 WHERE id = $1', [u.id]);
    const c = client(t.server);
    const login = await c.post('/auth/login', { orgId: u.orgId, password: u.password });
    const pending = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    const verify = await c.post('/auth/mfa/verify', { code: codeFor(u.secret) });
    const full = (verify.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    expect(full).not.toBe(pending);
    // The pending token no longer opens anything, and the new one does.
    expect((await request(t.server).get('/auth/me').set('Cookie', pending)).status).toBe(401);
    expect((await request(t.server).get('/auth/me').set('Cookie', full)).status).toBe(200);
  });

  it('locks the account after repeated failures, even for the right password, and unlocks on expiry', async () => {
    const u = await onboard(t, admin.c, 'NV-0009', 'employee');
    for (let i = 0; i < 5; i++) {
      expect((await client(t.server).post('/auth/login', { orgId: u.orgId, password: `wrong-guess-${i}-xyz` })).status).toBe(401);
    }
    expect((await client(t.server).post('/auth/login', { orgId: u.orgId, password: u.password })).status).toBe(401);
    expect((await audit('auth.login')).some((r) => r.details.reason === 'locked')).toBe(true);
    await t.db.query(`UPDATE users SET locked_until = now() - interval '1 minute' WHERE id = $1`, [u.id]);
    expect((await client(t.server).post('/auth/login', { orgId: u.orgId, password: u.password })).status).toBe(200);
  });

  it('locks the account after repeated wrong MFA codes', async () => {
    const u = await onboard(t, admin.c, 'NV-0010', 'employee');
    await t.db.query('UPDATE users SET mfa_last_step = 0 WHERE id = $1', [u.id]);
    const c = client(t.server);
    await c.post('/auth/login', { orgId: u.orgId, password: u.password });
    for (let i = 0; i < 5; i++) await c.post('/auth/mfa/verify', { code: '000001' });
    expect((await c.post('/auth/mfa/verify', { code: codeFor(u.secret) })).status).toBe(401); // pending session is dead
    expect((await client(t.server).post('/auth/login', { orgId: u.orgId, password: u.password })).status).toBe(401); // and so is the account
  });

  it('ends the session on logout', async () => {
    const u = await onboard(t, admin.c, 'NV-0011', 'employee');
    expect((await u.c.get('/auth/me')).status).toBe(200);
    expect((await u.c.post('/auth/logout')).status).toBe(204);
    expect((await u.c.get('/auth/me')).status).toBe(401);
  });

  it('ends a session that has been idle too long', async () => {
    const u = await onboard(t, admin.c, 'NV-0012', 'employee');
    await t.db.query(`UPDATE sessions SET last_seen_at = now() - interval '31 minutes' WHERE user_id = $1`, [u.id]);
    expect((await u.c.get('/auth/me')).status).toBe(401);
  });

  it('ends a session past its absolute lifetime', async () => {
    const u = await onboard(t, admin.c, 'NV-0013', 'employee');
    await t.db.query(`UPDATE sessions SET expires_at = now() - interval '1 second' WHERE user_id = $1`, [u.id]);
    expect((await u.c.get('/auth/me')).status).toBe(401);
  });

  it('signs out every other session when the password changes', async () => {
    const u = await onboard(t, admin.c, 'NV-0014', 'employee');
    const other = await signIn(t, u);
    expect((await other.get('/auth/me')).status).toBe(200);
    const next = 'another long passphrase here';
    expect((await u.c.post('/auth/change-password', { currentPassword: u.password, newPassword: next })).status).toBe(200);
    expect((await u.c.get('/auth/me')).status).toBe(200);
    expect((await other.get('/auth/me')).status).toBe(401);
    expect((await client(t.server).post('/auth/login', { orgId: u.orgId, password: u.password })).status).toBe(401);
    expect((await client(t.server).post('/auth/login', { orgId: u.orgId, password: next })).status).toBe(200);
  });

  it('refuses state-changing requests from another origin, even with a valid session cookie', async () => {
    const evil = client(t.server, 'https://evil.example');
    const r = await evil.post('/auth/login', { orgId: 'NV-0001', password: STRONG });
    expect(r.status).toBe(403);
    expect(r.headers['set-cookie']).toBeUndefined();

    const cookie = await rawSession(t, admin);
    const post = (origin: string) =>
      request(t.server).post('/admin/users').set('Origin', origin).set('Cookie', cookie)
        .send({ orgId: 'NV-CSRF', name: 'x', email: 'csrf@example.com', role: 'hr_admin' });
    expect((await post('https://evil.example')).status).toBe(403);
    expect((await t.db.query(`SELECT 1 FROM users WHERE org_id = 'NV-CSRF'`)).rowCount).toBe(0);
    expect((await post(ORIGIN)).status).toBe(201); // the same request from the real portal works
  });

  it('rejects malformed login bodies', async () => {
    const c = client(t.server);
    expect((await c.post('/auth/login', { orgId: 'x' })).status).toBe(400);
    expect((await c.post('/auth/login', { orgId: 'x', password: 'y', admin: true })).status).toBe(400);
    expect((await c.post('/auth/login', { orgId: { $ne: '' }, password: 'y' })).status).toBe(400);
  });

  it('only accepts a valid TOTP clock window', async () => {
    const u = await onboard(t, admin.c, 'NV-0015', 'employee');
    await t.db.query('UPDATE users SET mfa_last_step = 0 WHERE id = $1', [u.id]);
    const c = client(t.server);
    await c.post('/auth/login', { orgId: u.orgId, password: u.password });
    expect((await c.post('/auth/mfa/verify', { code: codeFor(u.secret, 5) })).status).toBe(401); // 2.5 minutes ahead
    expect((await c.post('/auth/mfa/verify', { code: codeFor(u.secret, 1) })).status).toBe(200); // one step of drift is fine
  });
});
