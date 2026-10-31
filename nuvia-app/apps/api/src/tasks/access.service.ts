import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../auth/roles';
import { DbService, Q } from '../common/db.service';

export interface ProjectAccess {
  projectId: string;
  archived: boolean;
  memberRole: 'lead' | 'member' | null;
  /** See the project and its tasks. */
  view: boolean;
  /** Comment, attach files, and move tasks assigned to you. */
  participate: boolean;
  /** Create and assign tasks, edit any task, manage members. */
  manage: boolean;
}

/**
 * The one place that decides who may do what with a project's tasks. Enforced on the server for every request.
 *  - employee:  sees projects they belong to; participates; changes the status of tasks assigned to them.
 *  - team lead: the same, and manages projects where they are a lead member.
 *  - HR/admin:  sees and manages every project.
 *  - executive: sees every project, read-only.
 */
export function accessFor(user: AuthUser, projectId: string, archived: boolean, memberRole: 'lead' | 'member' | null): ProjectAccess {
  const hr = user.role === 'hr_admin';
  const exec = user.role === 'executive';
  const member = memberRole !== null;
  return {
    projectId,
    archived,
    memberRole,
    view: hr || exec || member,
    participate: hr || (member && !exec),
    manage: hr || (user.role === 'team_lead' && memberRole === 'lead'),
  };
}

@Injectable()
export class TaskAccess {
  constructor(private readonly db: DbService) {}

  /** Access for a project. Throws 404 when the person can't see it, so other projects' existence isn't revealed. */
  async project(user: AuthUser, projectId: string, q: Q = this.db): Promise<ProjectAccess> {
    const { rows } = await q.query(
      `SELECT p.id, p.archived_at, m.role FROM projects p
       LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = $2 WHERE p.id = $1`,
      [projectId, user.id],
    );
    const r = rows[0];
    if (!r) throw new NotFoundException();
    const a = accessFor(user, r.id, r.archivedAt !== null, r.role ?? null);
    if (!a.view) throw new NotFoundException();
    return a;
  }

  /** Which of these users may see the project. Used so notifications never reach someone who was removed from it. */
  async viewers(q: Q, projectId: string, userIds: string[]): Promise<string[]> {
    if (!userIds.length) return [];
    const { rows } = await q.query(
      `SELECT u.id FROM users u WHERE u.id = ANY($1::uuid[]) AND u.active
         AND (u.role IN ('hr_admin','executive') OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = $2 AND m.user_id = u.id))`,
      [userIds, projectId],
    );
    return rows.map((r) => r.id);
  }
}
