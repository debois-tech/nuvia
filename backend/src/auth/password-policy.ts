export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/** Returns a message describing the first problem, or null if the password is acceptable. */
export function passwordProblem(password: string, ctx: { orgId: string; email?: string; current?: string }): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  const lower = password.toLowerCase();
  if (lower.includes(ctx.orgId.toLowerCase())) return 'Password must not contain your org ID';
  const emailName = ctx.email?.split('@')[0]?.toLowerCase();
  if (emailName && emailName.length >= 4 && lower.includes(emailName)) return 'Password must not contain your email name';
  if (new Set(password).size < 5) return 'Password is too repetitive';
  if (ctx.current !== undefined && password === ctx.current) return 'New password must differ from the current one';
  return null;
}
