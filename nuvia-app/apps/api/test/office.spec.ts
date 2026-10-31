import { ipInRanges, parseCidrs } from '../src/attendance/office/network';
import { Harness, MIN } from './harness';

describe('office network matching', () => {
  const ranges = parseCidrs(['203.0.113.0/24', '2001:db8::/32']);
  it('matches IPv4, IPv4-mapped IPv6 and IPv6', () => {
    expect(ipInRanges('203.0.113.77', ranges)).toBe(true);
    expect(ipInRanges('::ffff:203.0.113.77', ranges)).toBe(true);
    expect(ipInRanges('2001:db8::1', ranges)).toBe(true);
  });
  it('rejects outside, missing and garbage addresses', () => {
    expect(ipInRanges('203.0.114.1', ranges)).toBe(false);
    expect(ipInRanges('10.0.0.1', ranges)).toBe(false);
    expect(ipInRanges(undefined, ranges)).toBe(false);
    expect(ipInRanges('not-an-ip', ranges)).toBe(false);
  });
  it('fails loudly on a bad CIDR in config', () => {
    expect(() => parseCidrs(['203.0.113.0/99'])).toThrow(/not a valid CIDR/);
  });
});

describe('office check-in and check-out', () => {
  let h: Harness;
  beforeAll(async () => (h = await Harness.create()));
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.reset();
    await h.createUsers(
      { orgId: 'LEAD', role: 'team_lead' },
      { orgId: 'OTHERLEAD', role: 'team_lead' },
      { orgId: 'HR', role: 'hr_admin' },
      { orgId: 'EMP', manager: 'LEAD' },
      { orgId: 'OTHER', manager: 'OTHERLEAD' },
      { orgId: 'REM', mode: 'remote' },
    );
  });

  it('requires sign-in', async () => {
    await h.http().post('/attendance/office/check-in').expect(401);
  });

  it('records check-in then check-out with the date in the office timezone', async () => {
    const t = await h.login('EMP');
    const inRes = await h.as(t).post('/attendance/office/check-in').expect(201);
    expect(inRes.body.workDate).toBe('2026-03-02');
    h.clock.advance(8 * 60 * MIN);
    const outRes = await h.as(t).post('/attendance/office/check-out').expect(200);
    expect(new Date(outRes.body.checkOutAt).getTime() - new Date(outRes.body.checkInAt).getTime()).toBe(8 * 60 * MIN);
    const today = await h.as(t).get('/attendance/office/today').expect(200);
    expect(today.body.record.checkOutAt).toBeTruthy();
  });

  it('uses the local date, not UTC, across midnight', async () => {
    h.clock.set(new Date('2026-03-02T19:00:00Z')); // 00:30 on 3 March in Kolkata
    const t = await h.login('EMP');
    const r = await h.as(t).post('/attendance/office/check-in').expect(201);
    expect(r.body.workDate).toBe('2026-03-03');
  });

  it('rejects a second check-in, a second check-out and a check-out without check-in', async () => {
    const t = await h.login('EMP');
    await h.as(t).post('/attendance/office/check-out').expect(409);
    await h.as(t).post('/attendance/office/check-in').expect(201);
    await h.as(t).post('/attendance/office/check-in').expect(409);
    await h.as(t).post('/attendance/office/check-out').expect(200);
    await h.as(t).post('/attendance/office/check-out').expect(409);
  });

  it('keeps remote-mode accounts out of office check-in', async () => {
    await h.as(await h.login('REM')).post('/attendance/office/check-in').expect(403);
  });

  it('shows leads only their own team, and HR everyone', async () => {
    await h.as(await h.login('EMP')).post('/attendance/office/check-in').expect(201);
    const lead = await h.as(await h.login('LEAD')).get('/attendance/office/day?date=2026-03-02').expect(200);
    expect(lead.body.map((r: any) => r.orgId)).toEqual(['EMP']);
    expect(lead.body[0].checkInAt).toBeTruthy();
    const hr = await h.as(await h.login('HR')).get('/attendance/office/day?date=2026-03-02').expect(200);
    expect(hr.body.map((r: any) => r.orgId).sort()).toEqual(['EMP', 'HR', 'LEAD', 'OTHER', 'OTHERLEAD']);
    await h.as(await h.login('EMP')).get('/attendance/office/day').expect(403);
  });
});

describe('office network restriction', () => {
  let h: Harness;
  beforeAll(async () => (h = await Harness.create({ officeNetworkCidrs: ['203.0.113.0/24'], trustProxy: true })));
  afterAll(() => h.close());
  beforeEach(async () => {
    await h.reset();
    await h.createUsers({ orgId: 'EMP' });
  });

  it('blocks check-in from outside the office network', async () => {
    const t = await h.login('EMP');
    const r = await h.http().post('/attendance/office/check-in').set('Authorization', `Bearer ${t}`).set('X-Forwarded-For', '198.51.100.9').expect(403);
    expect(r.body.message).toMatch(/office network/);
    await h.as(t).get('/attendance/office/today').expect(200).expect((res) => expect(res.body.record).toBeNull());
  });

  it('allows check-in from inside it and stores the address', async () => {
    const t = await h.login('EMP');
    await h.http().post('/attendance/office/check-in').set('Authorization', `Bearer ${t}`).set('X-Forwarded-For', '203.0.113.20').expect(201);
    const row = await h.db.query('SELECT check_in_ip FROM office_attendance');
    expect(row.rows[0].checkInIp).toBe('203.0.113.20');
  });

  it('can still check out from anywhere (restriction is on check-in)', async () => {
    const t = await h.login('EMP');
    await h.http().post('/attendance/office/check-in').set('Authorization', `Bearer ${t}`).set('X-Forwarded-For', '203.0.113.20').expect(201);
    await h.http().post('/attendance/office/check-out').set('Authorization', `Bearer ${t}`).set('X-Forwarded-For', '198.51.100.9').expect(200);
  });
});

describe('office network restriction ignores spoofed headers by default', () => {
  let h: Harness;
  beforeAll(async () => (h = await Harness.create({ officeNetworkCidrs: ['203.0.113.0/24'], trustProxy: false })));
  afterAll(() => h.close());
  it('does not believe X-Forwarded-For when no proxy is trusted', async () => {
    await h.reset();
    await h.createUsers({ orgId: 'EMP' });
    const t = await h.login('EMP');
    await h.http().post('/attendance/office/check-in').set('Authorization', `Bearer ${t}`).set('X-Forwarded-For', '203.0.113.20').expect(403);
  });
});
