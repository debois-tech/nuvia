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
export interface Notification { id: string; kind: string; message: string; flagId: string | null; taskId: string | null; createdAt: string; readAt: string | null }

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
export interface ProjectDetail { id: string; key: string; name: string; description: string; archivedAt: string | null; members: ProjectMember[]; access: { manage: boolean; participate: boolean } }
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
