import { z } from 'zod';
import { DATE_RE } from '../common/tz';

export const STATUSES = ['todo', 'in_progress', 'in_review', 'done'] as const;
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskStatus = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', in_review: 'In review', done: 'Done' };

const uuid = z.string().uuid();
const validDate = z.string().regex(DATE_RE).refine((s) => new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, 'Not a real date');

export const CreateProjectBody = z
  .object({
    key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{1,7}$/, '2 to 8 letters or digits, starting with a letter'),
    name: z.string().trim().min(1).max(100),
    description: z.string().trim().max(2000).default(''),
  })
  .strict();

export const UpdateProjectBody = z
  .object({ name: z.string().trim().min(1).max(100), description: z.string().trim().max(2000), archived: z.boolean() })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');

export const AddMemberBody = z.object({ userId: uuid, role: z.enum(['lead', 'member']).default('member') }).strict();

export const CreateTaskBody = z
  .object({
    projectId: uuid,
    title: z.string().trim().min(1).max(200),
    description: z.string().max(20000).default(''),
    priority: z.enum(PRIORITIES).default('medium'),
    assigneeId: uuid.nullable().optional(),
    dueDate: validDate.nullable().optional(),
    parentId: uuid.optional(),
  })
  .strict();

export const UpdateTaskBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(20000),
    priority: z.enum(PRIORITIES),
    assigneeId: uuid.nullable(),
    dueDate: validDate.nullable(),
    status: z.enum(STATUSES),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');

export const CommentBody = z.object({ body: z.string().trim().min(1).max(5000) }).strict();

export const ListTasksQuery = z.object({
  projectId: uuid.optional(),
  /** 'me', 'none' (unassigned) or a user id. */
  assignee: z.union([z.literal('me'), z.literal('none'), uuid]).optional(),
  status: z.enum(STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  due: z.enum(['overdue', 'soon', 'none']).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(300),
});
