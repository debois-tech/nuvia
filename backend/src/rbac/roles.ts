export const ROLES = ['employee', 'lead', 'hr_admin', 'executive'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Every capability the platform checks on the server. Later phases add routes that require these;
 * the map below is the single place that decides who holds what.
 */
export const PERMISSIONS = [
  'attendance:self',        // check in/out, see own attendance and activity log
  'attendance:team',        // see attendance of the people on your team
  'attendance:all',         // see and correct everyone's attendance
  'tasks:self',             // see and update tasks assigned to you
  'tasks:manage',           // create and assign tasks, run a team's board
  'tasks:read_all',         // read tasks across the company
  'users:read',             // list users and their roles
  'users:manage',           // create users, change roles, reset credentials, deactivate
  'audit:read',             // read and verify the audit log
  'leadership:view',        // revenue and company-health dashboards
  'leadership:set_targets', // set timelines, goals and targets
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const EMPLOYEE: Permission[] = ['attendance:self', 'tasks:self'];

export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  employee: new Set(EMPLOYEE),
  lead: new Set<Permission>([...EMPLOYEE, 'attendance:team', 'tasks:manage']),
  hr_admin: new Set<Permission>([...EMPLOYEE, 'attendance:all', 'users:read', 'users:manage', 'audit:read']),
  // CEO / CTO / COO: read access across the company plus the two leadership powers. No users:manage,
  // no tasks:manage and no attendance edits: they look, and they set timelines and targets.
  executive: new Set<Permission>([
    ...EMPLOYEE,
    'attendance:all',
    'tasks:read_all',
    'users:read',
    'audit:read',
    'leadership:view',
    'leadership:set_targets',
  ]),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function permissionsFor(role: Role): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])].sort();
}
