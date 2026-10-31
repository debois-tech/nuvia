import { z } from 'zod';
import { MAX_STEPS_PER_HEARTBEAT, MAX_STEP_LENGTH } from '@nuvia/shared';

const seq = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const SessionStartSchema = z.object({ seq }).strict();
export const SessionStopSchema = z.object({ seq, sessionId: z.string().uuid() }).strict();

export const HeartbeatSchema = z
  .object({
    seq,
    sessionId: z.string().uuid(),
    windowSeconds: z.number().int().min(1).max(300),
    activeSeconds: z.number().int().min(0).max(300),
    otherInputEvents: z.number().int().min(0).max(100_000),
    steps: z
      .array(z.tuple([z.number().int().min(0).max(7), z.number().int().min(1).max(MAX_STEP_LENGTH)]))
      .max(MAX_STEPS_PER_HEARTBEAT),
  })
  .strict()
  .refine((b) => b.activeSeconds <= b.windowSeconds, { message: 'activeSeconds cannot exceed windowSeconds', path: ['activeSeconds'] });

export const PromptResponseSchema = z.object({ seq, answer: z.string().max(32).optional() }).strict();

export const EnrollSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
