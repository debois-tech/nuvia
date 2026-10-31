import { z } from 'zod';
import { DATE_RE } from '../common/tz';
import { FIELDS } from './sheets/mapping';

const uuid = z.string().uuid();
const validDate = z.string().regex(DATE_RE).refine((s) => new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, 'Not a real date');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

/** Query string of both import calls. The file itself is the raw request body. */
export const ImportQuery = z.object({
  name: z.string().trim().max(200).default('upload'),
  sheet: z.string().max(100).optional(),
  headerRow: z.coerce.number().int().min(1).max(1000).optional(),
  /** JSON like {"month":0,"revenue":2}: field -> column number (first column is 0). */
  mapping: z.string().max(1000).optional(),
});

export const MappingSchema = z
  .object(Object.fromEntries(FIELDS.map((f) => [f, z.number().int().min(0).max(99).optional()])) as Record<(typeof FIELDS)[number], z.ZodOptional<z.ZodNumber>>)
  .strict();

export const FinanceQuery = z.object({ from: month.optional(), to: month.optional(), compareFrom: month.optional(), compareTo: month.optional(), compare: z.enum(['prev', 'yoy']).optional() });
export const OverviewQuery = FinanceQuery;

export const CreateGoalBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).default(''),
    ownerId: uuid.nullable().optional(),
    startDate: validDate,
    dueDate: validDate,
  })
  .strict();

export const UpdateGoalBody = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000),
    ownerId: uuid.nullable(),
    startDate: validDate,
    dueDate: validDate,
    status: z.enum(['active', 'done', 'dropped']),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');

export const CreateMilestoneBody = z
  .object({ title: z.string().trim().min(1).max(200), dueDate: validDate, ownerId: uuid.nullable().optional() })
  .strict();

export const UpdateMilestoneBody = z
  .object({ title: z.string().trim().min(1).max(200), dueDate: validDate, ownerId: uuid.nullable(), done: z.boolean() })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Nothing to change');

export const LinkBody = z
  .object({ projectId: uuid.optional(), taskId: uuid.optional(), milestoneId: uuid.nullable().optional() })
  .strict()
  .refine((b) => (b.projectId === undefined) !== (b.taskId === undefined), 'Link either a project or a task');
