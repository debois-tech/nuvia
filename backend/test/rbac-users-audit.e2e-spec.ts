import {
  bootstrapAdmin, client, freshDatabase, onboard, Onboarded, signIn, startApp, STRONG, TestApp,
} from './harness';

describe('roles, user administration and audit log', () => {
  let t: TestApp;
  let admin: Onboarded;
  let employee: Onboarded, lead: Onboarded, hr: Onboarded, exec: Onboarded;

  beforeAll(async () => {
    t = await startApp(await freshDatabase('nuvia_e2e_rbac'));
    admin = await bootstrapAdmin(t);
    employee = await onboard(t, admin.c, 'NV-EMP', 'employee');
    lead = await onboard(t, admin.c, 'NV-LEAD', 'lead');
    hr = await onboard(t, admin.c, 'NV-HR', 'hr_admin');
    exec = await onboard(t, admin.c, 'NV-CEO', 'executive');
  });
  afterAll(() => t.close());

  const audit = async (action: string) =>
    (await t.db.query('SELECT * FROM audit_log WHERE action = $1 ORDER BY id', [action])).rows;

  describe('permissions are enforced on the server', () => {
    it('employees and leads cannot list users', async () => {
      expect((await employee.c.get('/admin/users')).status).toBe(403);
      expect((await lead.c.get('/admin/users')).status).toBe(403);
    });

    it('HR/admin and executives can list users, and the list never exposes secrets', async () => {
      for (const who of [hr, exec]) {
        const r = await who.c.get('/admin/users');
        expect(r.status).toBe(200);
        expect(r.body.length).toBeGreaterThanOrEqual(5);
        const text = JSON.stringify(r.body);
        expect(text).not.toMatch(/password_hash|passwordHash|mfa_secret|scrypt\$/);
        expect(r.body[0]).toHaveProperty('orgId');
      }
    });

    it('only HR/admin can create, change or reset users; executives are read-only', async () => {
      const body = { orgId: 'NV-X1', name: 'X', email: 'x1@example.com', role: 'employee' };
      for (const who of [employee, lead, exec]) expect((await who.c.post('/admin/users', body)).status).toBe(403);
      expect((await exec.c.patch(`/admin/users/${employee.id}`, { role: 'executive' })).status).toBe(403);
      expect((await lead.c.post(`/admin/users/${employee.id}/reset-password`)).status).toBe(403);
      expect((await exec.c.post(`/admin/users/${employee.id}/reset-mfa`)).status).toBe(403);
      expect((await t.db.query(`SELECT 1 FROM users WHERE org_id = 'NV-X1'`)).rowCount).toBe(0);
    });

    it('only HR/admin and executives can read the audit log', async () => {
      expect((await employee.c.get('/audit')).status).toBe(403);
      expect((await lead.c.get('/audit')).status).toBe(403);
      expect((await hr.c.get('/audit')).status).toBe(200);
      expect((await exec.c.get('/audit')).status).toBe(200);
      expect((await employee.c.get('/audit/verify')).status).toBe(403);
    });

    it('records every refusal in the audit log', async () => {
      const denied = await audit('access.denied');
      expect(denied.length).toBeGreaterThan(0);
      expect(denied.every((r) => r.outcome === 'denied')).toBe(true);
      expect(denied.some((r) => r.actor_org_id === 'NV-EMP' && r.details.required.includes('users:read'))).toBe(true);
    });

    it('reports each role its own permissions on /auth/me', async () => {
      expect((await exec.c.get('/auth/me')).body.permissions).toEqual(expect.arrayContaining(['leadership:view', 'leadership:set_targets']));
      expect((await hr.c.get('/auth/me')).body.permissions).not.toContain('leadership:view');
      expect((await lead.c.get('/auth/me')).body.permissions).toContain('tasks:manage');
    });

    it('ignores any role or permission the client claims', async () => {
      const r = await employee.c.post('/admin/users', { orgId: 'NV-X2', name: 'X', email: 'x2@example.com', role: 'executive' });
      expect(r.status).toBe(403);
      const r2 = await employee.c.patch(`/admin/users/${employee.id}`, { role: 'hr_admin' });
      expect(r2.status).toBe(403);
      expect((await employee.c.get('/auth/me')).body.role).toBe('employee');
    });
  });

  describe('user administration', () => {
    it('creates an account with a one-time temporary password and no public signup', async () => {
      const r = await hr.c.post('/admin/users', { orgId: 'NV-NEW', name: ' New Person ', email: 'new@example.com', role: 'lead', title: 'Design lead' });
      expect(r.status).toBe(201);
      expect(r.body.user).toMatchObject({ orgId: 'NV-NEW', name: 'New Person', role: 'lead', mustChangePassword: true, mfaEnabled: false, active: true });
      expect(r.body.temporaryPassword).toHaveLength(16);
      expect(JSON.stringify((await hr.c.get(`/admin/users/${r.body.user.id}`)).body)).not.toContain(r.body.temporaryPassword);
      expect((await client(t.server).post('/admin/users', { orgId: 'NV-SNEAK', name: 'x', email: 's@example.com', role: 'hr_admin' })).status).toBe(401);
    });

    it('allows the CEO/CTO/COO title on an executive account', async () => {
      const r = await hr.c.post('/admin/users', { orgId: 'NV-CTO', name: 'The CTO', email: 'cto@example.com', role: 'executive', title: 'CTO' });
      expect(r.body.user).toMatchObject({ role: 'executive', title: 'CTO' });
    });

    it('rejects duplicates, bad input and unknown fields', async () => {
      expect((await hr.c.post('/admin/users', { orgId: 'nv-emp', name: 'Dup', email: 'dup@example.com', role: 'employee' })).status).toBe(409);
      expect((await hr.c.post('/admin/users', { orgId: 'NV-D2', name: 'Dup', email: 'NV-EMP@EXAMPLE.COM', role: 'employee' })).status).toBe(409);
      expect((await hr.c.post('/admin/users', { orgId: 'x', name: 'Bad', email: 'b@example.com', role: 'employee' })).status).toBe(400);
      expect((await hr.c.post('/admin/users', { orgId: 'NV-B2', name: 'Bad', email: 'not-an-email', role: 'employee' })).status).toBe(400);
      expect((await hr.c.post('/admin/users', { orgId: 'NV-B3', name: 'Bad', email: 'b3@example.com', role: 'superuser' })).status).toBe(400);
      expect((await hr.c.post('/admin/users', { orgId: 'NV-B4', name: 'Bad', email: 'b4@example.com', role: 'employee', passwordHash: 'x' })).status).toBe(400);
      expect((await hr.c.get('/admin/users/not-a-uuid')).status).toBe(404);
    });

    it('a new account must set its own password before MFA, so the admin cannot take it over', async () => {
      const c = client(t.server);
      const temp = (await hr.c.post('/admin/users', { orgId: 'NV-TK', name: 'Take Over', email: 'tk@example.com', role: 'employee' })).body.temporaryPassword;
      const login = await c.post('/auth/login', { orgId: 'NV-TK', password: temp });
      expect(login.body.stage).toBe('pending_password');
      expect((await c.post('/auth/mfa/enroll/start')).status).toBe(403);
      expect((await c.post('/auth/mfa/enroll/confirm', { code: '123456' })).status).toBe(403);
    });

    it('a role change signs the person out so the new permissions apply on the next sign-in', async () => {
      const u = await onboard(t, admin.c, 'NV-PROMO', 'employee');
      expect((await u.c.get('/admin/users')).status).toBe(403);
      const r = await hr.c.patch(`/admin/users/${u.id}`, { role: 'hr_admin' });
      expect(r.status).toBe(200);
      expect((await u.c.get('/auth/me')).status).toBe(401);
      const again = await signIn(t, u);
      expect((await again.get('/admin/users')).status).toBe(200);
      const change = (await audit('user.role_changed')).find((a) => a.target_id === u.id);
      expect(change).toMatchObject({ actor_org_id: 'NV-HR', outcome: 'success' });
      expect(change.details).toEqual({ from: 'employee', to: 'hr_admin' });
      await hr.c.patch(`/admin/users/${u.id}`, { role: 'employee' });
    });

    it('deactivating ends sessions and blocks sign-in until reactivated', async () => {
      const u = await onboard(t, admin.c, 'NV-GONE', 'employee');
      expect((await hr.c.patch(`/admin/users/${u.id}`, { active: false })).body.active).toBe(false);
      expect((await u.c.get('/auth/me')).status).toBe(401);
      expect((await client(t.server).post('/auth/login', { orgId: u.orgId, password: u.password })).status).toBe(401);
      await hr.c.patch(`/admin/users/${u.id}`, { active: true });
      expect((await client(t.server).post('/auth/login', { orgId: u.orgId, password: u.password })).status).toBe(200);
      expect((await audit('user.deactivated')).some((a) => a.target_id === u.id)).toBe(true);
      expect((await audit('user.reactivated')).some((a) => a.target_id === u.id)).toBe(true);
    });

    it('cannot change your own role or deactivate yourself', async () => {
      expect((await hr.c.patch(`/admin/users/${hr.id}`, { active: false })).status).toBe(400);
      expect((await hr.c.patch(`/admin/users/${hr.id}`, { role: 'employee' })).status).toBe(400);
      expect((await hr.c.patch(`/admin/users/${hr.id}`, { name: 'Renamed HR' })).status).toBe(200);
    });

    it('refuses to leave the company without an active HR/admin', async () => {
      const lone = await startApp(await freshDatabase('nuvia_e2e_lastadmin'));
      try {
        const only = await bootstrapAdmin(lone, 'NV-ONLY');
        // Through the API this needs a second admin, so call the service as some other actor to prove the rule itself.
        const someoneElse = { id: '00000000-0000-4000-8000-000000000000', orgId: 'NV-OTHER' } as any;
        const ctx = { ip: null, userAgent: 'test' };
        await expect(lone.users.update(only.id, { active: false }, someoneElse, ctx)).rejects.toThrow(/last active HR\/admin/);
        await expect(lone.users.update(only.id, { role: 'executive' }, someoneElse, ctx)).rejects.toThrow(/last active HR\/admin/);
        expect((await only.c.get('/auth/me')).body.role).toBe('hr_admin');
        // With a second admin in place the same change is allowed.
        const second = await onboard(lone, only.c, 'NV-SECOND', 'hr_admin');
        expect((await second.c.patch(`/admin/users/${only.id}`, { active: false })).status).toBe(200);
      } finally {
        await lone.close();
      }
    });

    it('resets a password: new temp password, sessions ended, change forced', async () => {
      const u = await onboard(t, admin.c, 'NV-FORGOT', 'employee');
      const r = await hr.c.post(`/admin/users/${u.id}/reset-password`);
      expect(r.status).toBe(200);
      expect(r.body.temporaryPassword).toHaveLength(16);
      expect((await u.c.get('/auth/me')).status).toBe(401);
      expect((await client(t.server).post('/auth/login', { orgId: u.orgId, password: u.password })).status).toBe(401);
      expect((await client(t.server).post('/auth/login', { orgId: u.orgId, password: r.body.temporaryPassword })).body.stage).toBe('pending_password');
      expect((await audit('user.password_reset')).some((a) => a.target_id === u.id && a.actor_org_id === 'NV-HR')).toBe(true);
    });

    it('resets MFA: sessions ended, the old authenticator stops working, setup is offered again', async () => {
      const u = await onboard(t, admin.c, 'NV-LOSTPHONE', 'employee');
      expect((await hr.c.post(`/admin/users/${u.id}/reset-mfa`)).status).toBe(204);
      expect((await u.c.get('/auth/me')).status).toBe(401);
      const c = client(t.server);
      expect((await c.post('/auth/login', { orgId: u.orgId, password: u.password })).body.stage).toBe('pending_enroll');
      expect((await t.db.query('SELECT count(*)::int AS n FROM recovery_codes WHERE user_id = $1', [u.id])).rows[0].n).toBe(0);
      expect((await audit('user.mfa_reset')).some((a) => a.target_id === u.id)).toBe(true);
    });

    it('records the creation of the first admin with no acting user', async () => {
      const fresh = await startApp(await freshDatabase('nuvia_e2e_cli'));
      try {
        const { user, temporaryPassword } = await fresh.users.create(
          { orgId: 'NV-FIRST', name: 'First', email: 'first@example.com', role: 'hr_admin' }, null, { ip: null, userAgent: 'cli' });
        expect(user.role).toBe('hr_admin');
        expect(temporaryPassword).toHaveLength(16);
        const ev = (await fresh.db.query(`SELECT * FROM audit_log WHERE action = 'user.bootstrap_admin_created'`)).rows;
        expect(ev).toHaveLength(1);
        expect(ev[0].actor_id).toBeNull();
      } finally {
        await fresh.close();
      }
    });
  });

  describe('audit log', () => {
    it('records who did what, from where, with the outcome', async () => {
      const created = (await audit('user.created')).find((a) => a.details.orgId === 'NV-EMP');
      expect(created).toMatchObject({ actor_org_id: 'NV-ADMIN', target_type: 'user', outcome: 'success' });
      expect(created.ts).toBeInstanceOf(Date);
      expect((await audit('auth.login')).some((a) => a.outcome === 'success' && a.actor_org_id === 'NV-EMP')).toBe(true);
    });

    it('records who viewed the user list and the audit log itself', async () => {
      await hr.c.get('/admin/users');
      await exec.c.get('/audit?action=auth');
      const views = await audit('users.list');
      expect(views.some((a) => a.actor_org_id === 'NV-HR')).toBe(true);
      const auditViews = await audit('audit.view');
      expect(auditViews.some((a) => a.actor_org_id === 'NV-CEO' && a.details.query.action === 'auth')).toBe(true);
    });

    it('never puts passwords, codes, tokens or secrets in the log', async () => {
      const made = await hr.c.post('/admin/users', { orgId: 'NV-LEAK', name: 'Leak Check', email: 'leak@example.com', role: 'employee' });
      const reset = await hr.c.post(`/admin/users/${made.body.user.id}/reset-password`);
      await client(t.server).post('/auth/login', { orgId: 'NV-LEAK', password: 'a-password-someone-typed-wrong' });
      const all = JSON.stringify((await t.db.query('SELECT * FROM audit_log')).rows);
      const secrets = [STRONG, 'a-password-someone-typed-wrong', made.body.temporaryPassword, reset.body.temporaryPassword,
        employee.secret, ...employee.recoveryCodes, 'scrypt$'];
      for (const secret of secrets) expect(all).not.toContain(secret);
      expect(all).not.toMatch(/temporaryPassword|nuvia_sid|"password":|"code":|"token":/);
    });

    it('can be filtered and paged', async () => {
      const r = await exec.c.get('/audit?action=user.&outcome=success&limit=2');
      expect(r.status).toBe(200);
      expect(r.body.events).toHaveLength(2);
      expect(r.body.events.every((e: any) => e.action.startsWith('user.'))).toBe(true);
      expect(r.body.nextBefore).toBeTruthy();
      const next = await exec.c.get(`/audit?action=user.&limit=2&before=${r.body.nextBefore}`);
      expect(next.body.events[0].id < r.body.events[1].id).toBe(true);
      const byActor = await exec.c.get('/audit?actor=nv-emp&limit=200');
      expect(byActor.body.events.every((e: any) => e.actor === 'NV-EMP')).toBe(true);
      expect((await exec.c.get('/audit?outcome=nope')).status).toBe(400);
      expect((await exec.c.get('/audit?from=yesterday-ish')).status).toBe(400);
      expect((await exec.c.get('/audit?before=1;DROP')).status).toBe(400);
      expect((await exec.c.get(`/audit?action=${encodeURIComponent("%' OR 1=1 --")}`)).body.events).toEqual([]);
    });

    it('keeps an unbroken hash chain, even under concurrent writes', async () => {
      await Promise.all(Array.from({ length: 25 }, (_, i) => client(t.server).post('/auth/login', { orgId: `ghost-${i}`, password: 'whatever-it-is' })));
      const r = await hr.c.get('/audit/verify');
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ ok: true });
      expect(r.body.checked).toBeGreaterThan(50);
    });

    it('cannot be edited, deleted or truncated, even by the application database user', async () => {
      await expect(t.db.query(`UPDATE audit_log SET actor_org_id = 'someone-else' WHERE id = (SELECT min(id) FROM audit_log)`)).rejects.toThrow(/append-only/);
      await expect(t.db.query('DELETE FROM audit_log WHERE id = (SELECT min(id) FROM audit_log)')).rejects.toThrow(/append-only/);
      await expect(t.db.query('TRUNCATE audit_log')).rejects.toThrow(/append-only/);
    });

    it('shows tampering if someone with superuser access bypasses the trigger', async () => {
      expect((await hr.c.get('/audit/verify')).body.ok).toBe(true);
      const victim = (await t.db.query(`SELECT id, actor_org_id FROM audit_log WHERE action = 'user.role_changed' ORDER BY id LIMIT 1`)).rows[0];
      const run = async (sql: string, params: unknown[] = []) => { const c = await t.db.pool.connect(); try { await c.query(sql, params); } finally { c.release(); } };
      await run('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update_delete');
      try {
        await run(`UPDATE audit_log SET actor_org_id = 'NV-FRAMED' WHERE id = $1`, [victim.id]);
        const r = await hr.c.get('/audit/verify');
        expect(r.body).toMatchObject({ ok: false, brokenAtId: String(victim.id), reason: expect.stringMatching(/contents/) });
        await run(`UPDATE audit_log SET actor_org_id = $2 WHERE id = $1`, [victim.id, victim.actor_org_id]);
        expect((await hr.c.get('/audit/verify')).body.ok).toBe(true);

        // A deleted row in the middle breaks the link to the next one.
        const mid = (await t.db.query(`SELECT id FROM audit_log ORDER BY id OFFSET 10 LIMIT 1`)).rows[0];
        const saved = (await t.db.query('SELECT * FROM audit_log WHERE id = $1', [mid.id])).rows[0];
        await run('DELETE FROM audit_log WHERE id = $1', [mid.id]);
        const broken = (await hr.c.get('/audit/verify')).body;
        expect(broken.ok).toBe(false);
        expect(broken.reason).toMatch(/link/);
        await run(
          `INSERT INTO audit_log (id, ts, actor_id, actor_org_id, action, target_type, target_id, outcome, ip, user_agent, details, prev_hash, hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [saved.id, saved.ts, saved.actor_id, saved.actor_org_id, saved.action, saved.target_type, saved.target_id, saved.outcome, saved.ip, saved.user_agent, JSON.stringify(saved.details), saved.prev_hash, saved.hash],
        );
      } finally {
        await run('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update_delete');
      }
      expect((await hr.c.get('/audit/verify')).body.ok).toBe(true);
    });
  });
});

describe('rate limiting', () => {
  it('throttles repeated requests to the sign-in endpoints', async () => {
    const t = await startApp(await freshDatabase('nuvia_e2e_throttle'), { AUTH_RATE_LIMIT_PER_MINUTE: '5' });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 8; i++) codes.push((await client(t.server).post('/auth/login', { orgId: 'nobody', password: 'x' })).status);
      expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
      expect(codes.slice(5).every((c) => c === 429)).toBe(true);
      expect((await client(t.server).get('/health')).status).toBe(200); // other routes unaffected
    } finally {
      await t.close();
    }
  });
});
