import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/roles';
import { Clock } from '../common/clock';
import { DbService } from '../common/db.service';
import { linkedGoals } from '../leadership/goal-queries';
import { TaskAccess } from './access.service';
import { AddMemberBody, CreateProjectBody, UpdateProjectBody } from './schemas';

@Injectable()
export class ProjectsService {
  constructor(private readonly db: DbService, private readonly clock: Clock, private readonly access: TaskAccess, private readonly audit: AuditService) {}

  async list(user: AuthUser, includeArchived: boolean) {
    const all = user.role === 'hr_admin' || user.role === 'executive';
    const { rows } = await this.db.query(
      `SELECT p.id, p.key, p.name, p.description, p.archived_at, m.role AS member_role,
              (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status <> 'done') AS open_tasks,
              (SELECT count(*)::int FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_tasks
       FROM projects p LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $1
       WHERE ($2::boolean OR m.user_id IS NOT NULL) AND ($3::boolean OR p.archived_at IS NULL)
       ORDER BY (p.archived_at IS NOT NULL), p.name`,
      [user.id, all, includeArchived],
    );
    return rows;
  }

  async create(user: AuthUser, b: z.output<typeof CreateProjectBody>) {
    const now = this.clock.now();
    const id = await this.db.tx(async (q) => {
      const clash = await q.query('SELECT 1 FROM projects WHERE key = $1', [b.key]);
      if (clash.rowCount) throw new ConflictException(`The key ${b.key} is already used by another project`);
      const r = await q.query('INSERT INTO projects (key, name, description, created_by, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id', [b.key, b.name, b.description, user.id, now]);
      const pid = r.rows[0].id as string;
      await q.query(`INSERT INTO project_members (project_id, user_id, role, added_at) VALUES ($1,$2,'lead',$3)`, [pid, user.id, now]);
      await this.audit.record(user.id, 'project.create', { type: 'project', id: pid }, { key: b.key }, q);
      return pid;
    });
    return this.get(user, id);
  }

  async get(user: AuthUser, id: string) {
    const access = await this.access.project(user, id);
    const p = (await this.db.query('SELECT id, key, name, description, archived_at, created_at FROM projects WHERE id = $1', [id])).rows[0];
    const members = (
      await this.db.query(
        `SELECT u.id, u.org_id, u.name, u.role AS user_role, m.role FROM project_members m JOIN users u ON u.id = m.user_id
         WHERE m.project_id = $1 ORDER BY (m.role = 'lead') DESC, u.name`,
        [id],
      )
    ).rows;
    return { ...p, members, goals: await linkedGoals(this.db, { projectId: id }), access: { manage: access.manage, participate: access.participate } };
  }

  async update(user: AuthUser, id: string, b: z.output<typeof UpdateProjectBody>) {
    const access = await this.access.project(user, id);
    if (!access.manage) throw new ForbiddenException();
    const now = this.clock.now();
    await this.db.tx(async (q) => {
      if (b.name !== undefined) await q.query('UPDATE projects SET name = $2 WHERE id = $1', [id, b.name]);
      if (b.description !== undefined) await q.query('UPDATE projects SET description = $2 WHERE id = $1', [id, b.description]);
      if (b.archived !== undefined) await q.query('UPDATE projects SET archived_at = $2 WHERE id = $1', [id, b.archived ? now : null]);
      await this.audit.record(user.id, 'project.update', { type: 'project', id }, { fields: Object.keys(b) }, q);
    });
    return this.get(user, id);
  }

  async addMember(user: AuthUser, id: string, b: z.output<typeof AddMemberBody>) {
    const access = await this.access.project(user, id);
    if (!access.manage) throw new ForbiddenException();
    const target = (await this.db.query('SELECT id, role, active FROM users WHERE id = $1', [b.userId])).rows[0];
    if (!target || !target.active) throw new BadRequestException('That person is not an active user');
    // Only people whose role can manage work may lead a project; the role is re-checked on every request.
    if (b.role === 'lead' && target.role !== 'team_lead' && target.role !== 'hr_admin') throw new BadRequestException('Only team leads and HR/admin can lead a project');
    if (target.role === 'executive') throw new BadRequestException('Executives can already see every project');
    await this.db.tx(async (q) => {
      await q.query(
        `INSERT INTO project_members (project_id, user_id, role, added_at) VALUES ($1,$2,$3,$4)
         ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [id, b.userId, b.role, this.clock.now()],
      );
      await this.audit.record(user.id, 'project.member_set', { type: 'project', id }, { userId: b.userId, role: b.role }, q);
    });
    return this.get(user, id);
  }

  async removeMember(user: AuthUser, id: string, userId: string) {
    const access = await this.access.project(user, id);
    if (!access.manage) throw new ForbiddenException();
    await this.db.tx(async (q) => {
      const m = (await q.query('SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2 FOR UPDATE', [id, userId])).rows[0];
      if (!m) throw new NotFoundException();
      const open = await q.query(`SELECT 1 FROM tasks WHERE project_id = $1 AND assignee_id = $2 AND status <> 'done' LIMIT 1`, [id, userId]);
      if (open.rowCount) throw new ConflictException('Reassign their open tasks first');
      if (m.role === 'lead') {
        const others = await q.query(`SELECT 1 FROM project_members WHERE project_id = $1 AND role = 'lead' AND user_id <> $2`, [id, userId]);
        if (!others.rowCount) throw new ConflictException('A project needs at least one lead');
      }
      await q.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [id, userId]);
      await this.audit.record(user.id, 'project.member_remove', { type: 'project', id }, { userId }, q);
    });
    return this.get(user, id);
  }

  /** People a lead can add to a project. Names and org IDs only. */
  async directory() {
    const { rows } = await this.db.query(`SELECT id, org_id, name, role FROM users WHERE active AND role <> 'executive' ORDER BY name`);
    return rows;
  }
}
