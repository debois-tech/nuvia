import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/roles';
import { Clock } from '../common/clock';
import { DbService, Q } from '../common/db.service';
import { AlertsService } from './alerts.service';
import { loadGoalTaskStats, loadMilestones, MilestoneRow } from './goal-queries';
import { HealthService } from './health.service';
import { CreateGoalBody, CreateMilestoneBody, LinkBody, UpdateGoalBody, UpdateMilestoneBody } from './schemas';

type GoalHealth = 'on_track' | 'at_risk' | 'off_track' | null;

@Injectable()
export class GoalsService {
  constructor(
    private readonly db: DbService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly health: HealthService,
    private readonly alerts: AlertsService,
  ) {}

  private async assertOwner(q: Q, ownerId: string | null | undefined) {
    if (!ownerId) return;
    const r = await q.query('SELECT 1 FROM users WHERE id = $1 AND active', [ownerId]);
    if (!r.rowCount) throw new BadRequestException('The owner must be an active user');
  }

  private async goalRow(q: Q, id: string, lock = false) {
    const r = (await q.query(`SELECT * FROM goals WHERE id = $1 ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
    if (!r) throw new NotFoundException();
    return r;
  }

  private goalHealth(g: { status: string; dueDate: string }, ms: MilestoneRow[], today: string): GoalHealth {
    if (g.status !== 'active') return null;
    if (g.dueDate < today || ms.some((m) => m.state === 'overdue')) return 'off_track';
    if (ms.some((m) => m.state === 'at_risk')) return 'at_risk';
    return 'on_track';
  }

  private shape(g: any, ms: MilestoneRow[], stats: Map<string, { total: number; done: number }>, today: string) {
    const t = stats.get(g.id) ?? { total: 0, done: 0 };
    return {
      id: g.id,
      title: g.title,
      description: g.description,
      ownerId: g.ownerId,
      ownerName: g.ownerName ?? null,
      startDate: g.startDate,
      dueDate: g.dueDate,
      status: g.status as 'active' | 'done' | 'dropped',
      completedAt: g.completedAt ? new Date(g.completedAt).toISOString() : null,
      health: this.goalHealth(g, ms, today),
      milestones: ms.map((m) => ({
        id: m.id, title: m.title, ownerId: m.ownerId, ownerName: m.ownerName, dueDate: m.dueDate, doneAt: m.doneAt, state: m.state, daysLeft: m.daysLeft,
        tasksTotal: m.tasksTotal, tasksDone: m.tasksDone,
        // All linked work is finished but nobody has ticked the milestone: a nudge, never automatic.
        suggestDone: !m.doneAt && m.tasksTotal > 0 && m.tasksDone === m.tasksTotal,
      })),
      progress: { milestonesDone: ms.filter((m) => m.state === 'done').length, milestonesTotal: ms.length, tasksDone: t.done, tasksTotal: t.total },
    };
  }

  /** People who can own a goal or milestone (everyone active, executives included). */
  async people() {
    return (await this.db.query(`SELECT id, org_id, name, role FROM users WHERE active ORDER BY name`)).rows;
  }

  async list() {
    const today = this.health.today();
    const { rules } = await this.health.rules();
    const goals = (await this.db.query(`SELECT g.*, u.name AS owner_name FROM goals g LEFT JOIN users u ON u.id = g.owner_id ORDER BY (g.status = 'active') DESC, g.due_date, g.title`)).rows;
    const ms = await loadMilestones(this.db, today, rules);
    const stats = await loadGoalTaskStats(this.db);
    const shaped = goals.map((g) => this.shape(g, ms.filter((m) => m.goalId === g.id), stats, today));
    return {
      today,
      goals: shaped,
      summary: {
        active: shaped.filter((g) => g.status === 'active').length,
        onTrack: shaped.filter((g) => g.health === 'on_track').length,
        atRisk: shaped.filter((g) => g.health === 'at_risk').length,
        offTrack: shaped.filter((g) => g.health === 'off_track').length,
        done: shaped.filter((g) => g.status === 'done').length,
      },
    };
  }

  async get(id: string) {
    const today = this.health.today();
    const { rules } = await this.health.rules();
    const g = (await this.db.query(`SELECT g.*, u.name AS owner_name FROM goals g LEFT JOIN users u ON u.id = g.owner_id WHERE g.id = $1`, [id])).rows[0];
    if (!g) throw new NotFoundException();
    const ms = await loadMilestones(this.db, today, rules, id);
    const stats = await loadGoalTaskStats(this.db, id);
    const links = (
      await this.db.query(
        `SELECT l.id, l.milestone_id,
                p.id AS project_id, p.key AS project_key, p.name AS project_name, p.archived_at,
                (SELECT count(*)::int FROM tasks x WHERE x.project_id = p.id AND x.status <> 'done') AS open_tasks,
                (SELECT count(*)::int FROM tasks x WHERE x.project_id = p.id AND x.status = 'done') AS done_tasks,
                t.id AS task_id, t.number AS task_number, t.title AS task_title, t.status AS task_status, t.due_date AS task_due, tp.key AS task_project_key, ta.name AS task_assignee
         FROM goal_links l
         LEFT JOIN projects p ON p.id = l.project_id
         LEFT JOIN tasks t ON t.id = l.task_id LEFT JOIN projects tp ON tp.id = t.project_id LEFT JOIN users ta ON ta.id = t.assignee_id
         WHERE l.goal_id = $1 ORDER BY l.created_at`,
        [id],
      )
    ).rows.map((r) =>
      r.projectId
        ? { id: r.id, milestoneId: r.milestoneId, kind: 'project' as const, projectId: r.projectId, key: r.projectKey, name: r.projectName, archived: r.archivedAt !== null, openTasks: r.openTasks, doneTasks: r.doneTasks }
        : { id: r.id, milestoneId: r.milestoneId, kind: 'task' as const, taskId: r.taskId, ref: `${r.taskProjectKey}-${r.taskNumber}`, title: r.taskTitle, status: r.taskStatus, dueDate: r.taskDue, assignee: r.taskAssignee },
    );
    return { ...this.shape(g, ms, stats, today), links };
  }

  async create(user: AuthUser, b: z.output<typeof CreateGoalBody>) {
    if (b.dueDate < b.startDate) throw new BadRequestException('The due date must not be before the start date');
    const now = this.clock.now();
    const id = await this.db.tx(async (q) => {
      await this.assertOwner(q, b.ownerId);
      const r = await q.query(
        `INSERT INTO goals (title, description, owner_id, start_date, due_date, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
        [b.title, b.description, b.ownerId ?? null, b.startDate, b.dueDate, user.id, now],
      );
      await this.audit.record(user.id, 'goal.create', { type: 'goal', id: r.rows[0].id }, { title: b.title }, q);
      return r.rows[0].id as string;
    });
    return this.get(id);
  }

  async update(user: AuthUser, id: string, b: z.output<typeof UpdateGoalBody>) {
    const now = this.clock.now();
    await this.db.tx(async (q) => {
      const g = await this.goalRow(q, id, true);
      await this.assertOwner(q, b.ownerId);
      const start = b.startDate ?? g.startDate;
      const due = b.dueDate ?? g.dueDate;
      if (due < start) throw new BadRequestException('The due date must not be before the start date');
      if (b.startDate !== undefined || b.dueDate !== undefined) {
        const out = (await q.query('SELECT title, due_date FROM milestones WHERE goal_id = $1 AND (due_date < $2 OR due_date > $3) ORDER BY due_date LIMIT 1', [id, start, due])).rows[0];
        if (out) throw new ConflictException(`The milestone "${out.title}" (${out.dueDate}) would fall outside the goal's dates. Move it first.`);
      }
      let completedAt = g.completedAt;
      if (b.status !== undefined && b.status !== g.status) {
        if (b.status === 'done') {
          const open = await q.query('SELECT title FROM milestones WHERE goal_id = $1 AND done_at IS NULL ORDER BY due_date LIMIT 1', [id]);
          if (open.rowCount) throw new ConflictException(`Finish the milestone "${open.rows[0].title}" before marking the goal done`);
          completedAt = now;
        } else completedAt = null;
      }
      await q.query(
        `UPDATE goals SET title = $2, description = $3, owner_id = $4, start_date = $5, due_date = $6, status = $7, completed_at = $8, updated_at = $9 WHERE id = $1`,
        [id, b.title ?? g.title, b.description ?? g.description, b.ownerId !== undefined ? b.ownerId : g.ownerId, start, due, b.status ?? g.status, completedAt, now],
      );
      await this.audit.record(user.id, 'goal.update', { type: 'goal', id }, { fields: Object.keys(b), status: b.status }, q);
    });
    await this.alerts.sync();
    return this.get(id);
  }

  async createMilestone(user: AuthUser, goalId: string, b: z.output<typeof CreateMilestoneBody>) {
    const now = this.clock.now();
    await this.db.tx(async (q) => {
      const g = await this.goalRow(q, goalId, true);
      if (g.status !== 'active') throw new ConflictException('This goal is closed. Reopen it to add milestones.');
      if (b.dueDate < g.startDate || b.dueDate > g.dueDate) throw new BadRequestException(`A milestone must fall within the goal's dates (${g.startDate} to ${g.dueDate})`);
      await this.assertOwner(q, b.ownerId);
      const r = await q.query('INSERT INTO milestones (goal_id, title, owner_id, due_date, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5) RETURNING id', [goalId, b.title, b.ownerId ?? null, b.dueDate, now]);
      await this.audit.record(user.id, 'milestone.create', { type: 'milestone', id: r.rows[0].id }, { goalId, title: b.title }, q);
    });
    await this.alerts.sync();
    return this.get(goalId);
  }

  private async milestoneRow(q: Q, id: string) {
    const m = (await q.query('SELECT m.*, g.status AS goal_status, g.start_date AS goal_start, g.due_date AS goal_due FROM milestones m JOIN goals g ON g.id = m.goal_id WHERE m.id = $1 FOR UPDATE OF m', [id])).rows[0];
    if (!m) throw new NotFoundException();
    return m;
  }

  async updateMilestone(user: AuthUser, id: string, b: z.output<typeof UpdateMilestoneBody>) {
    const now = this.clock.now();
    const goalId = await this.db.tx(async (q) => {
      const m = await this.milestoneRow(q, id);
      if (m.goalStatus !== 'active') throw new ConflictException('This goal is closed. Reopen it to change its milestones.');
      await this.assertOwner(q, b.ownerId);
      const due = b.dueDate ?? m.dueDate;
      if (due < m.goalStart || due > m.goalDue) throw new BadRequestException(`A milestone must fall within the goal's dates (${m.goalStart} to ${m.goalDue})`);
      const doneAt = b.done === undefined ? m.doneAt : b.done ? m.doneAt ?? now : null;
      await q.query('UPDATE milestones SET title = $2, due_date = $3, owner_id = $4, done_at = $5, updated_at = $6 WHERE id = $1', [id, b.title ?? m.title, due, b.ownerId !== undefined ? b.ownerId : m.ownerId, doneAt, now]);
      await this.audit.record(user.id, 'milestone.update', { type: 'milestone', id }, { fields: Object.keys(b) }, q);
      return m.goalId as string;
    });
    await this.alerts.sync();
    return this.get(goalId);
  }

  async deleteMilestone(user: AuthUser, id: string) {
    const goalId = await this.db.tx(async (q) => {
      const m = await this.milestoneRow(q, id);
      if (m.goalStatus !== 'active') throw new ConflictException('This goal is closed. Reopen it to change its milestones.');
      await q.query('DELETE FROM goal_links WHERE milestone_id = $1', [id]);
      await q.query('DELETE FROM milestones WHERE id = $1', [id]);
      await this.audit.record(user.id, 'milestone.delete', { type: 'milestone', id }, { goalId: m.goalId, title: m.title }, q);
      return m.goalId as string;
    });
    await this.alerts.sync();
    return this.get(goalId);
  }

  async addLink(user: AuthUser, goalId: string, b: z.output<typeof LinkBody>) {
    await this.db.tx(async (q) => {
      const g = await this.goalRow(q, goalId, true);
      if (g.status !== 'active') throw new ConflictException('This goal is closed. Reopen it to link work to it.');
      if (b.milestoneId) {
        const m = await q.query('SELECT 1 FROM milestones WHERE id = $1 AND goal_id = $2', [b.milestoneId, goalId]);
        if (!m.rowCount) throw new BadRequestException('That milestone does not belong to this goal');
      }
      if (b.projectId) {
        const p = (await q.query('SELECT archived_at FROM projects WHERE id = $1', [b.projectId])).rows[0];
        if (!p) throw new BadRequestException('That project does not exist');
        if (p.archivedAt) throw new BadRequestException('That project is archived');
      } else {
        const t = (await q.query('SELECT 1 FROM tasks WHERE id = $1', [b.taskId])).rowCount;
        if (!t) throw new BadRequestException('That task does not exist');
      }
      const dup = await q.query(
        `SELECT 1 FROM goal_links WHERE goal_id = $1 AND milestone_id IS NOT DISTINCT FROM $2::uuid AND project_id IS NOT DISTINCT FROM $3::uuid AND task_id IS NOT DISTINCT FROM $4::uuid`,
        [goalId, b.milestoneId ?? null, b.projectId ?? null, b.taskId ?? null],
      );
      if (dup.rowCount) throw new ConflictException('That is already linked here');
      const r = await q.query('INSERT INTO goal_links (goal_id, milestone_id, project_id, task_id, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [goalId, b.milestoneId ?? null, b.projectId ?? null, b.taskId ?? null, user.id, this.clock.now()]);
      await this.audit.record(user.id, 'goal.link', { type: 'goal', id: goalId }, { linkId: r.rows[0].id, projectId: b.projectId, taskId: b.taskId, milestoneId: b.milestoneId ?? null }, q);
    });
    await this.alerts.sync();
    return this.get(goalId);
  }

  async removeLink(user: AuthUser, goalId: string, linkId: string) {
    await this.db.tx(async (q) => {
      const g = await this.goalRow(q, goalId, true);
      if (g.status !== 'active') throw new ConflictException('This goal is closed. Reopen it to change its links.');
      const r = await q.query('DELETE FROM goal_links WHERE id = $1 AND goal_id = $2 RETURNING project_id, task_id, milestone_id', [linkId, goalId]);
      if (!r.rowCount) throw new NotFoundException();
      await this.audit.record(user.id, 'goal.unlink', { type: 'goal', id: goalId }, { linkId, projectId: r.rows[0].projectId, taskId: r.rows[0].taskId }, q);
    });
    await this.alerts.sync();
    return this.get(goalId);
  }
}
