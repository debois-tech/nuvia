import { can, PERMISSIONS, permissionsFor, ROLES, ROLE_PERMISSIONS } from './roles';

describe('role permissions', () => {
  it('employees can only reach their own attendance and tasks', () => {
    expect(permissionsFor('employee')).toEqual(['attendance:self', 'tasks:self']);
  });

  it('leads manage tasks and see their team but cannot manage users or read the audit log', () => {
    expect(can('lead', 'tasks:manage')).toBe(true);
    expect(can('lead', 'attendance:team')).toBe(true);
    expect(can('lead', 'users:manage')).toBe(false);
    expect(can('lead', 'audit:read')).toBe(false);
    expect(can('lead', 'leadership:view')).toBe(false);
  });

  it('HR/admin manage users and read the audit log but never see revenue', () => {
    expect(can('hr_admin', 'users:manage')).toBe(true);
    expect(can('hr_admin', 'audit:read')).toBe(true);
    expect(can('hr_admin', 'attendance:all')).toBe(true);
    expect(can('hr_admin', 'leadership:view')).toBe(false);
    expect(can('hr_admin', 'leadership:set_targets')).toBe(false);
  });

  it('executives get leadership data and read access, but no write powers over people or tasks', () => {
    expect(can('executive', 'leadership:view')).toBe(true);
    expect(can('executive', 'leadership:set_targets')).toBe(true);
    expect(can('executive', 'tasks:read_all')).toBe(true);
    expect(can('executive', 'users:manage')).toBe(false);
    expect(can('executive', 'tasks:manage')).toBe(false);
  });

  it('only executives hold leadership permissions', () => {
    for (const role of ROLES) {
      const has = can(role, 'leadership:view') || can(role, 'leadership:set_targets');
      expect(has).toBe(role === 'executive');
    }
  });

  it('every permission in every role is a known permission', () => {
    for (const role of ROLES) for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
  });

  it('an unknown role has no permissions', () => {
    expect(can('intern' as any, 'attendance:self')).toBe(false);
  });
});
