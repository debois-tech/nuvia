export type Role = 'employee' | 'team_lead' | 'hr_admin' | 'executive';
export interface Me { id: string; orgId: string; name: string; role: Role; workMode: 'office' | 'remote'; managerId: string | null }
export const isReviewer = (r: Role) => r === 'team_lead' || r === 'hr_admin' || r === 'executive';
export const canResolve = (r: Role) => r === 'team_lead' || r === 'hr_admin';

export interface OfficeRecord { id: string; workDate: string; checkInAt: string; checkOutAt: string | null }
export type PeriodKind = 'active' | 'idle' | 'absent' | 'offline';
export interface Period { id: string; kind: PeriodKind; startedAt: string; endedAt: string | null; seconds?: number }
export interface FlagSummary { id: string; periodId: string | null; kind: string; severity: 'low' | 'medium' | 'high'; status: 'open' | 'confirmed' | 'dismissed' | 'excused'; createdAt: string; resolutionNote: string | null; employeeNote: string | null }
export interface Activity {
  date: string;
  totals: { activeSeconds: number; idleSeconds: number; absentSeconds: number; offlineSeconds: number };
  sessions: { id: string; startedAt: string; endedAt: string | null; endReason: string | null; state: string; periods: Period[] }[];
  flags: FlagSummary[];
}
export interface TodayOffice { mode: 'office'; date: string; networkRestricted: boolean; record: OfficeRecord | null }
export interface TodayRemote {
  mode: 'remote'; date: string; enrolledDevices: number; idleMinutes: number;
  session: null | { id: string; startedAt: string; state: string; lastHeartbeatAt: string; trackingActive: boolean };
}
export interface Device { id: string; name: string; createdAt: string; lastSeenAt: string | null; revokedAt: string | null }
export interface ReviewRow {
  id: string; kind: string; severity: 'low' | 'medium' | 'high'; status: FlagSummary['status']; detail: Record<string, unknown>;
  createdAt: string; resolvedAt: string | null; resolutionNote: string | null; employeeNote: string | null;
  userId: string; orgId: string; name: string; periodKind: PeriodKind | null; periodStartedAt: string | null; periodEndedAt: string | null;
}
export interface ReviewDetail {
  flag: ReviewRow & { resolvedByName: string | null };
  periods: Period[];
  prompts: { id: string; kind: string; status: string; attempts: number; createdAt: string; deadlineAt: string; answeredAt: string | null }[];
  heartbeatSummary: { heartbeats: number; activeSeconds: number; otherInputEvents: number } | null;
}
export interface Notification { id: string; kind: string; message: string; flagId: string | null; taskId: string | null; link: string | null; createdAt: string; readAt: string | null }

export const canManageWork = (r: Role) => r === 'team_lead' || r === 'hr_admin';

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export const STATUSES: TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done'];
export const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'urgent'];
export const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', in_review: 'In review', done: 'Done' };
export const PRIORITY_LABEL: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High', urgent: 'Urgent' };

export interface ProjectSummary { id: string; key: string; name: string; description: string; archivedAt: string | null; memberRole: 'lead' | 'member' | null; openTasks: number; doneTasks: number }
export interface Person { id: string; orgId: string; name: string }
export interface ProjectMember extends Person { userRole: Role; role: 'lead' | 'member' }
export interface LinkedGoal { goalId: string; title: string; startDate: string; dueDate: string; milestone: { id: string; title: string; dueDate: string } | null }
export interface ProjectDetail { id: string; key: string; name: string; description: string; archivedAt: string | null; members: ProjectMember[]; goals: LinkedGoal[]; access: { manage: boolean; participate: boolean } }
export interface TaskRow {
  id: string; number: number; title: string; status: TaskStatus; priority: Priority; dueDate: string | null; parentId: string | null; parentNumber: number | null;
  assigneeId: string | null; assigneeName: string | null; assigneeOrgId: string | null; mine: boolean; overdue: boolean;
  projectId: string; projectKey: string; projectName: string;
  subtaskCount: number; subtasksDone: number; commentCount: number; attachmentCount: number; createdAt: string; updatedAt: string;
}
export interface TaskDetail {
  id: string; projectId: string; projectKey: string; projectName: string; projectArchived: boolean; number: number; title: string; description: string;
  status: TaskStatus; priority: Priority; dueDate: string | null; overdue: boolean; createdAt: string; updatedAt: string; completedAt: string | null;
  assignee: Person | null; reporter: Person | null; parent: { id: string; number: number; title: string; projectKey: string } | null;
  subtasks: { id: string; number: number; title: string; status: TaskStatus; priority: Priority; dueDate: string | null; assigneeName: string | null }[];
  comments: { id: string; body: string; createdAt: string; authorId: string; authorName: string }[];
  attachments: { id: string; fileName: string; contentType: string; sizeBytes: number; createdAt: string; uploaderId: string; uploaderName: string; canRemove: boolean }[];
  activity: { id: number; kind: string; detail: Record<string, any>; createdAt: string; actorName: string | null }[];
  goals: LinkedGoal[];
  can: { edit: boolean; changeStatus: boolean; comment: boolean; attach: boolean };
}

export const FLAG_LABEL: Record<string, string> = {
  absent: 'Marked absent: did not answer the activity prompt',
  challenge_failed: 'Failed or ignored a random presence check',
  agent_offline: 'Desktop agent stopped reporting',
  mouse_only_extended: 'Hours of mouse-only activity',
  scripted_movement: 'Cursor movement looks scripted',
  scripted_identical_windows: 'Same cursor path replayed minute after minute',
};
export const flagLabel = (k: string) => FLAG_LABEL[k] ?? k.replace(/_/g, ' ');

// ---- Leadership (executives only) ----
export const isExecutive = (r: Role) => r === 'executive';
export type HealthStatus = 'on_track' | 'at_risk' | 'off_track';
export type MeasureStatus = HealthStatus | 'no_data';
export interface Measure { key: 'revenue' | 'milestones' | 'margin' | 'runway'; label: string; status: MeasureStatus; value: number | null; unit: '%' | 'months' | ''; summary: string; rule: string }
export interface HealthRules {
  revenue: { onTrackMin: number; atRiskMin: number };
  margin: { onTrackMin: number; atRiskMin: number };
  runway: { onTrackMinMonths: number; atRiskMinMonths: number };
  milestones: { onTrackMaxLatePct: number; atRiskMaxLatePct: number; warnDays: number; warnProgressBelowPct: number };
}
export interface Health {
  status: HealthStatus | 'unknown'; reason: string; measures: Measure[]; asOf: string | null; window: { from: string; to: string; label: string } | null;
  rules: HealthRules; rulesConfirmed: null | { by: string | null; at: string };
}
export interface AlertItem { key: string; kind: string; severity: 'warning' | 'critical'; title: string; detail: string; link: string; raisedAt: string }
export interface GoalSummary { active: number; onTrack: number; atRisk: number; offTrack: number; done: number }
export interface ImportRecord { id: string; fileName: string; sheetName: string | null; rowCount: number; periodFrom: string; periodTo: string; warnings: string[]; uploadedAt: string; uploadedBy: string }
export interface Funnel { created: number; assigned: number; started: number; inReview: number; done: number }
export interface WeekdayCounts { byWeekday: number[]; total: number }
export interface ActivityBlock {
  range: { from: string; to: string }; compareRange: { from: string; to: string } | null;
  tasks: Funnel; completed: WeekdayCounts; checkIns: WeekdayCounts;
  compare: { tasks: Funnel; completed: WeekdayCounts; checkIns: WeekdayCounts } | null;
}
export interface Overview { health: Health; alerts: AlertItem[]; goals: GoalSummary; latestImport: ImportRecord | null; activity: ActivityBlock }

export interface FinanceMonth { period: string; label: string; revenue: number | null; target: number | null; cost: number | null; cashIn: number | null; cashOut: number | null; closingCash: number | null; attainmentPct: number | null }
export interface FinanceQuarter { label: string; from: string; to: string; months: number; complete: boolean; revenue: number | null; target: number | null; cost: number | null; attainmentPct: number | null }
export interface FinanceDepartment { department: string; revenue: number | null; cost: number | null; target: number | null; attainmentPct: number | null }
export interface FinanceTotals { revenue: number | null; target: number | null; attainmentPct: number | null; cost: number | null; marginPct: number | null; cashIn: number | null; cashOut: number | null }
export interface FinanceDashboard {
  currency: string; fiscalYearStartMonth: number; asOf: string | null; available: { from: string; to: string } | null;
  range: { from: string; to: string } | null; fiscalYear: string | null;
  months: FinanceMonth[]; quarters: FinanceQuarter[]; departments: FinanceDepartment[]; totals: FinanceTotals | null;
  compare: null | { range: { from: string; to: string }; totals: FinanceTotals; departments: { department: string; revenue: number | null }[] };
}

export type MilestoneState = 'done' | 'overdue' | 'at_risk' | 'on_track';
export interface Milestone { id: string; title: string; ownerId: string | null; ownerName: string | null; dueDate: string; doneAt: string | null; state: MilestoneState; daysLeft: number; tasksTotal: number; tasksDone: number; suggestDone: boolean }
export interface Goal {
  id: string; title: string; description: string; ownerId: string | null; ownerName: string | null; startDate: string; dueDate: string;
  status: 'active' | 'done' | 'dropped'; completedAt: string | null; health: HealthStatus | null; milestones: Milestone[];
  progress: { milestonesDone: number; milestonesTotal: number; tasksDone: number; tasksTotal: number };
}
export type GoalLink =
  | { id: string; milestoneId: string | null; kind: 'project'; projectId: string; key: string; name: string; archived: boolean; openTasks: number; doneTasks: number }
  | { id: string; milestoneId: string | null; kind: 'task'; taskId: string; ref: string; title: string; status: TaskStatus; dueDate: string | null; assignee: string | null };
export interface GoalDetail extends Goal { links: GoalLink[] }
export interface GoalList { today: string; goals: Goal[]; summary: GoalSummary }

export interface PreviewSheet { name: string; headerRow: number; headers: string[]; rowCount: number; sample: (string | number | null)[][]; suggested: Partial<Record<string, number>> }
export interface ImportPreview { selected: string; fields: { field: string; label: string; required: boolean }[]; sheets: PreviewSheet[] }
export interface ImportResult { importId: string; rows: number; periodFrom: string; periodTo: string; replaced: number; warnings: string[] }
