import type { Pool } from 'pg';
import { hashPassword } from '../auth/password';

export const DEMO_USERS = [
  { orgId: 'EXEC-1', name: 'Asha Executive', role: 'executive', mode: 'office', manager: null },
  { orgId: 'HR-1', name: 'Hari HR', role: 'hr_admin', mode: 'office', manager: null },
  { orgId: 'LEAD-1', name: 'Leena Lead', role: 'team_lead', mode: 'office', manager: null },
  { orgId: 'EMP-1', name: 'Omar Office', role: 'employee', mode: 'office', manager: 'LEAD-1' },
  { orgId: 'EMP-2', name: 'Ria Remote', role: 'employee', mode: 'remote', manager: 'LEAD-1' },
  { orgId: 'EMP-3', name: 'Ravi Remote', role: 'employee', mode: 'remote', manager: null },
] as const;

/** Development data only. Safe to run twice. */
export async function seedDemoUsers(pool: Pool, password: string): Promise<number> {
  let created = 0;
  for (const u of DEMO_USERS) {
    const r = await pool.query(
      `INSERT INTO users (org_id, name, role, work_mode, password_hash, manager_id)
       VALUES ($1,$2,$3,$4,$5,(SELECT id FROM users WHERE org_id = $6))
       ON CONFLICT (org_id) DO NOTHING`,
      [u.orgId, u.name, u.role, u.mode, await hashPassword(password), u.manager],
    );
    created += r.rowCount ?? 0;
  }
  return created;
}
