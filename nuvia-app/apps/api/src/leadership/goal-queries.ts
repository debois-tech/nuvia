import type { Q } from '../common/db.service';
import type { HealthRules } from './health';

export type MilestoneState = 'done' | 'overdue' | 'at_risk' | 'on_track';

export interface MilestoneRow {
  id: string;
  goalId: string;
  goalTitle: string;
  goalStatus: 'active' | 'done' | 'dropped';
  title: string;
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string;
  doneAt: string | null;
  tasksTotal: number;
  tasksDone: number;
  /** Whole days until the due date (negative once past). */
  daysLeft: number;
  state: MilestoneState;
}

export const daysBetween = (from: string, to: string) => Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000);

/**
 * done: marked done. overdue: past its date and not done. at risk: due within `warnDays` while the linked work is
 * under `warnProgressBelowPct` done (a milestone with no linked work can't be judged, so it is never at risk).
 */
export function milestoneState(m: { doneAt: string | null; dueDate: string; tasksTotal: number; tasksDone: number }, today: string, rules: HealthRules['milestones']): { state: MilestoneState; daysLeft: number } {
  const daysLeft = daysBetween(today, m.dueDate);
  if (m.doneAt) return { state: 'done', daysLeft };
  if (daysLeft < 0) return { state: 'overdue', daysLeft };
  if (daysLeft <= rules.warnDays && m.tasksTotal > 0 && (m.tasksDone / m.tasksTotal) * 100 < rules.warnProgressBelowPct) return { state: 'at_risk', daysLeft };
  return { state: 'on_track', daysLeft };
}

/** Linked tasks are the ones linked directly plus every task of a linked project, each counted once. */
export async function loadMilestones(q: Q, today: string, rules: HealthRules, goalId: string | null = null): Promise<MilestoneRow[]> {
  const { rows } = await q.query(
    `WITH lt AS (
       SELECT l.milestone_id, t.id AS task_id, t.status FROM goal_links l JOIN tasks t ON t.id = l.task_id WHERE l.milestone_id IS NOT NULL
       UNION
       SELECT l.milestone_id, t.id, t.status FROM goal_links l JOIN tasks t ON t.project_id = l.project_id WHERE l.milestone_id IS NOT NULL AND l.project_id IS NOT NULL
     ), stats AS (
       SELECT milestone_id, count(*)::int AS total, (count(*) FILTER (WHERE status = 'done'))::int AS done FROM lt GROUP BY milestone_id
     )
     SELECT m.id, m.goal_id, g.title AS goal_title, g.status AS goal_status, m.title, m.owner_id, u.name AS owner_name, m.due_date, m.done_at,
            coalesce(s.total, 0) AS tasks_total, coalesce(s.done, 0) AS tasks_done
     FROM milestones m JOIN goals g ON g.id = m.goal_id LEFT JOIN users u ON u.id = m.owner_id LEFT JOIN stats s ON s.milestone_id = m.id
     WHERE ($1::uuid IS NULL OR m.goal_id = $1)
     ORDER BY m.due_date, m.created_at`,
    [goalId],
  );
  return rows.map((r) => ({ ...r, doneAt: r.doneAt ? new Date(r.doneAt).toISOString() : null, ...milestoneState(r, today, rules.milestones) }));
}

/** Distinct tasks linked to each goal (directly, through a milestone, or through a linked project). */
export async function loadGoalTaskStats(q: Q, goalId: string | null = null): Promise<Map<string, { total: number; done: number }>> {
  const { rows } = await q.query(
    `WITH lt AS (
       SELECT l.goal_id, t.id AS task_id, t.status FROM goal_links l JOIN tasks t ON t.id = l.task_id
       UNION
       SELECT l.goal_id, t.id, t.status FROM goal_links l JOIN tasks t ON t.project_id = l.project_id WHERE l.project_id IS NOT NULL
     )
     SELECT goal_id, count(DISTINCT task_id)::int AS total, (count(DISTINCT task_id) FILTER (WHERE status = 'done'))::int AS done
     FROM lt WHERE ($1::uuid IS NULL OR goal_id = $1) GROUP BY goal_id`,
    [goalId],
  );
  return new Map(rows.map((r) => [r.goalId as string, { total: r.total as number, done: r.done as number }]));
}

export interface LinkedGoal {
  goalId: string;
  title: string;
  startDate: string;
  dueDate: string;
  milestone: { id: string; title: string; dueDate: string } | null;
}

/**
 * The live goals a project or task serves. Shown on project and task pages to everyone who can see them, so people
 * can see which company goal their work feeds. Only titles and dates leave the leadership area.
 */
export async function linkedGoals(q: Q, target: { projectId: string; taskId?: string }): Promise<LinkedGoal[]> {
  const { rows } = await q.query(
    `SELECT DISTINCT g.id AS goal_id, g.title, g.start_date, g.due_date, m.id AS m_id, m.title AS m_title, m.due_date AS m_due
     FROM goal_links l JOIN goals g ON g.id = l.goal_id LEFT JOIN milestones m ON m.id = l.milestone_id
     WHERE g.status = 'active' AND (l.project_id = $1 OR ($2::uuid IS NOT NULL AND l.task_id = $2))
     ORDER BY g.due_date, g.title, m_due NULLS FIRST`,
    [target.projectId, target.taskId ?? null],
  );
  return rows.map((r) => ({
    goalId: r.goalId,
    title: r.title,
    startDate: r.startDate,
    dueDate: r.dueDate,
    milestone: r.mId ? { id: r.mId, title: r.mTitle, dueDate: r.mDue } : null,
  }));
}
