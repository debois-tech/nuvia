import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/roles';
import { Clock } from '../common/clock';
import { DbService, Q } from '../common/db.service';
import { workDateOf } from '../common/tz';
import { APP_CONFIG, AppConfig } from '../config/config';
import { linkedGoals } from '../leadership/goal-queries';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectAccess, TaskAccess } from './access.service';
import { CommentBody, CreateTaskBody, ListTasksQuery, STATUS_LABEL, TaskStatus, UpdateTaskBody } from './schemas';

const label = (t: { projectKey: string; number: number }) => `${t.projectKey}-${t.number}`;

@Injectable()
export class TasksService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly access: TaskAccess,
    private readonly audit: AuditService,
    private readonly notes: NotificationsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  private today() {
    return workDateOf(this.clock.now(), this.cfg.timezone);
  }

  /** Loads a task the person may see (404 otherwise) with their access to its project. */
  async load(user: AuthUser, id: string, q: Q = this.db, lock = false) {
    const { rows } = await q.query(
      `SELECT t.*, p.key AS project_key, p.name AS project_name FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = $1 ${lock ? 'FOR UPDATE OF t' : ''}`,
      [id],
    );
    const task = rows[0];
    if (!task) throw new NotFoundException();
    const access = await this.access.project(user, task.projectId, q);
    return { task, access };
  }

  private writable(access: ProjectAccess) {
    if (access.archived) throw new ConflictException('This project is archived. Unarchive it to make changes.');
  }

  private async activity(q: Q, taskId: string, actorId: string, kind: string, detail: object = {}) {
    await q.query('INSERT INTO task_activity (task_id, actor_id, kind, detail, created_at) VALUES ($1,$2,$3,$4,$5)', [taskId, actorId, kind, JSON.stringify(detail), this.clock.now()]);
  }

  private async assertAssignable(q: Q, projectId: string, assigneeId: string) {
    const { rows } = await q.query(
      `SELECT 1 FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 AND m.user_id = $2 AND u.active`,
      [projectId, assigneeId],
    );
    if (!rows.length) throw new BadRequestException('Tasks can only be assigned to active members of the project');
  }

  async list(user: AuthUser, f: z.output<typeof ListTasksQuery>) {
    const all = user.role === 'hr_admin' || user.role === 'executive';
    const today = this.today();
    const params: unknown[] = [user.id, today];
    const where: string[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (!all) where.push('EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = t.project_id AND m.user_id = $1)');
    if (f.projectId) add('t.project_id = ?', f.projectId);
    else where.push('p.archived_at IS NULL');
    if (f.assignee === 'me') where.push('t.assignee_id = $1');
    else if (f.assignee === 'none') where.push('t.assignee_id IS NULL');
    else if (f.assignee) add('t.assignee_id = ?', f.assignee);
    if (f.status) add('t.status = ?', f.status);
    if (f.priority) add('t.priority = ?', f.priority);
    if (f.due === 'overdue') where.push(`t.status <> 'done' AND t.due_date < $2`);
    if (f.due === 'soon') {
      params.push(addDays(today, this.cfg.dueSoonDays));
      where.push(`t.status <> 'done' AND t.due_date >= $2 AND t.due_date <= $${params.length}`);
    }
    if (f.due === 'none') where.push('t.due_date IS NULL');
    if (f.q) {
      params.push(`%${f.q.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`(t.title ILIKE $${params.length} OR (p.key || '-' || t.number) ILIKE $${params.length})`);
    }
    params.push(f.limit);
    const { rows } = await this.db.query(
      `SELECT t.id, t.number, t.title, t.status, t.priority, t.due_date, t.parent_id, t.assignee_id, t.created_at, t.updated_at, t.completed_at,
              p.id AS project_id, p.key AS project_key, p.name AS project_name,
              a.name AS assignee_name, a.org_id AS assignee_org_id,
              par.number AS parent_number,
              (t.assignee_id = $1::uuid) AS mine,
              (t.status <> 'done' AND t.due_date IS NOT NULL AND t.due_date < $2::date) AS overdue,
              (SELECT count(*)::int FROM tasks s WHERE s.parent_id = t.id) AS subtask_count,
              (SELECT count(*)::int FROM tasks s WHERE s.parent_id = t.id AND s.status = 'done') AS subtasks_done,
              (SELECT count(*)::int FROM task_comments c WHERE c.task_id = t.id) AS comment_count,
              (SELECT count(*)::int FROM task_attachments x WHERE x.task_id = t.id AND x.deleted_at IS NULL) AS attachment_count
       FROM tasks t JOIN projects p ON p.id = t.project_id
       LEFT JOIN users a ON a.id = t.assignee_id LEFT JOIN tasks par ON par.id = t.parent_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY (t.status = 'done'), CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                t.due_date ASC NULLS LAST, t.created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return rows;
  }

  async get(user: AuthUser, id: string) {
    const { task, access } = await this.load(user, id);
    const today = this.today();
    const [assignee, reporter, parent, subtasks, comments, attachments, activity] = await Promise.all([
      task.assigneeId ? this.db.query('SELECT id, org_id, name FROM users WHERE id = $1', [task.assigneeId]) : null,
      this.db.query('SELECT id, org_id, name FROM users WHERE id = $1', [task.reporterId]),
      task.parentId ? this.db.query(`SELECT t.id, t.number, t.title, p.key AS project_key FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = $1`, [task.parentId]) : null,
      this.db.query(
        `SELECT t.id, t.number, t.title, t.status, t.priority, t.due_date, a.name AS assignee_name FROM tasks t LEFT JOIN users a ON a.id = t.assignee_id
         WHERE t.parent_id = $1 ORDER BY t.number`,
        [id],
      ),
      this.db.query(`SELECT c.id, c.body, c.created_at, u.id AS author_id, u.name AS author_name FROM task_comments c JOIN users u ON u.id = c.author_id WHERE c.task_id = $1 ORDER BY c.created_at, c.id`, [id]),
      this.db.query(
        `SELECT x.id, x.file_name, x.content_type, x.size_bytes, x.created_at, u.id AS uploader_id, u.name AS uploader_name
         FROM task_attachments x JOIN users u ON u.id = x.uploader_id WHERE x.task_id = $1 AND x.deleted_at IS NULL ORDER BY x.created_at`,
        [id],
      ),
      this.db.query(`SELECT a.id, a.kind, a.detail, a.created_at, u.name AS actor_name FROM task_activity a LEFT JOIN users u ON u.id = a.actor_id WHERE a.task_id = $1 ORDER BY a.id`, [id]),
    ]);
    const mine = task.assigneeId === user.id;
    return {
      id: task.id,
      projectId: task.projectId,
      projectKey: task.projectKey,
      projectName: task.projectName,
      projectArchived: access.archived,
      number: task.number,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      overdue: task.status !== 'done' && task.dueDate !== null && task.dueDate < today,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
      assignee: assignee?.rows[0] ?? null,
      reporter: reporter.rows[0] ?? null,
      parent: parent?.rows[0] ?? null,
      subtasks: subtasks.rows,
      comments: comments.rows,
      attachments: attachments.rows.map((x) => ({ ...x, canRemove: !access.archived && (access.manage || x.uploaderId === user.id) })),
      activity: activity.rows,
      goals: await linkedGoals(this.db, { projectId: task.projectId, taskId: id }),
      can: {
        edit: access.manage && !access.archived,
        changeStatus: !access.archived && (access.manage || (access.participate && mine)),
        comment: !access.archived && access.participate,
        attach: !access.archived && access.participate,
      },
    };
  }

  async create(user: AuthUser, b: z.output<typeof CreateTaskBody>) {
    const access = await this.access.project(user, b.projectId);
    if (!access.manage) throw new ForbiddenException();
    this.writable(access);
    const now = this.clock.now();
    const id = await this.db.tx(async (q) => {
      if (b.assigneeId) await this.assertAssignable(q, b.projectId, b.assigneeId);
      if (b.parentId) {
        const par = (await q.query('SELECT project_id, parent_id FROM tasks WHERE id = $1', [b.parentId])).rows[0];
        if (!par || par.projectId !== b.projectId) throw new BadRequestException('The parent task must be in the same project');
        if (par.parentId) throw new BadRequestException('Sub-tasks cannot have sub-tasks');
      }
      // The row lock on the project serialises numbering: two creators never get the same number.
      const p = (await q.query('UPDATE projects SET next_number = next_number + 1 WHERE id = $1 RETURNING key, next_number - 1 AS number', [b.projectId])).rows[0];
      const r = await q.query(
        `INSERT INTO tasks (project_id, number, parent_id, title, description, priority, assignee_id, reporter_id, due_date, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id`,
        [b.projectId, p.number, b.parentId ?? null, b.title, b.description, b.priority, b.assigneeId ?? null, user.id, b.dueDate ?? null, now],
      );
      const taskId = r.rows[0].id as string;
      await this.activity(q, taskId, user.id, 'created', { assigneeId: b.assigneeId ?? null });
      if (b.assigneeId && b.assigneeId !== user.id) {
        await this.notes.notifyUsers(q, [b.assigneeId], 'task_assigned', `${user.name} assigned you ${p.key}-${p.number}: ${b.title}`, { taskId });
      }
      await this.audit.record(user.id, 'task.create', { type: 'task', id: taskId }, { project: p.key, number: p.number }, q);
      return taskId;
    });
    return this.get(user, id);
  }

  async update(user: AuthUser, id: string, b: z.output<typeof UpdateTaskBody>) {
    const now = this.clock.now();
    await this.db.tx(async (q) => {
      const { task, access } = await this.load(user, id, q, true);
      this.writable(access);
      const { status, ...rest } = b;
      if (Object.keys(rest).length && !access.manage) throw new ForbiddenException();
      if (status !== undefined && !(access.manage || (access.participate && task.assigneeId === user.id))) throw new ForbiddenException();

      const sets: string[] = [];
      const params: unknown[] = [id];
      const set = (col: string, v: unknown) => {
        params.push(v);
        sets.push(`${col} = $${params.length}`);
      };
      const events: [string, object][] = [];
      const ref = label(task);
      const notify: { users: (string | null)[]; kind: string; text: string }[] = [];
      let resetReminders = false;
      const assigneeAfter = b.assigneeId !== undefined ? b.assigneeId : task.assigneeId;

      if (b.title !== undefined && b.title !== task.title) { set('title', b.title); events.push(['title_changed', { from: task.title, to: b.title }]); }
      if (b.description !== undefined && b.description !== task.description) { set('description', b.description); events.push(['description_changed', {}]); }
      if (b.priority !== undefined && b.priority !== task.priority) { set('priority', b.priority); events.push(['priority_changed', { from: task.priority, to: b.priority }]); }
      if (b.dueDate !== undefined && b.dueDate !== task.dueDate) {
        set('due_date', b.dueDate);
        events.push(['due_changed', { from: task.dueDate, to: b.dueDate }]);
        resetReminders = true;
        notify.push({ users: [assigneeAfter], kind: 'task_due_changed', text: `${user.name} changed the due date of ${ref}: ${task.title} to ${b.dueDate ?? 'none'}` });
      }
      if (b.assigneeId !== undefined && b.assigneeId !== task.assigneeId) {
        if (b.assigneeId) await this.assertAssignable(q, task.projectId, b.assigneeId);
        set('assignee_id', b.assigneeId);
        events.push(['assigned', { from: task.assigneeId, to: b.assigneeId }]);
        resetReminders = true;
        notify.push({ users: [b.assigneeId], kind: 'task_assigned', text: `${user.name} assigned you ${ref}: ${task.title}` });
        notify.push({ users: [task.assigneeId], kind: 'task_unassigned', text: `${user.name} took ${ref}: ${task.title} off you` });
      }
      if (status !== undefined && status !== task.status) {
        set('status', status);
        set('completed_at', status === 'done' ? now : null);
        events.push(['status_changed', { from: task.status, to: status }]);
        if (task.status === 'done') resetReminders = true;
        notify.push({ users: [task.reporterId, assigneeAfter], kind: 'task_status', text: `${user.name} moved ${ref}: ${task.title} to ${STATUS_LABEL[status as TaskStatus]}` });
      }
      if (!sets.length) return;
      if (resetReminders) sets.push('due_soon_notified_at = NULL', 'overdue_notified_at = NULL');
      params.push(now);
      sets.push(`updated_at = $${params.length}`);
      await q.query(`UPDATE tasks SET ${sets.join(', ')} WHERE id = $1`, params);
      for (const [kind, detail] of events) await this.activity(q, id, user.id, kind, detail);

      // Only people who can still see the project hear about it, and never the person who made the change.
      for (const n of notify) {
        const ids = (n.users.filter(Boolean) as string[]).filter((u) => u !== user.id);
        const allowed = await this.access.viewers(q, task.projectId, ids);
        await this.notes.notifyUsers(q, allowed, n.kind, n.text, { taskId: id });
      }
      await this.audit.record(user.id, 'task.update', { type: 'task', id }, { fields: events.map(([k]) => k) }, q);
    });
    return this.get(user, id);
  }

  async comment(user: AuthUser, id: string, b: z.output<typeof CommentBody>) {
    const now = this.clock.now();
    await this.db.tx(async (q) => {
      const { task, access } = await this.load(user, id, q);
      if (!access.participate) throw new ForbiddenException();
      this.writable(access);
      await q.query('INSERT INTO task_comments (task_id, author_id, body, created_at) VALUES ($1,$2,$3,$4)', [id, user.id, b.body, now]);
      await this.activity(q, id, user.id, 'commented');
      await q.query('UPDATE tasks SET updated_at = $2 WHERE id = $1', [id, now]);
      const ids = [task.assigneeId, task.reporterId].filter((u): u is string => !!u && u !== user.id);
      const allowed = await this.access.viewers(q, task.projectId, ids);
      await this.notes.notifyUsers(q, allowed, 'task_comment', `${user.name} commented on ${label(task)}: ${task.title}`, { taskId: id });
    });
    return this.get(user, id);
  }
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
