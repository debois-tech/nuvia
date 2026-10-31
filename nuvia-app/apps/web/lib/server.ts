export const TOKEN_COOKIE = 'nuvia_token';
export const API_URL = process.env.API_URL ?? 'http://127.0.0.1:4000';

/** Client address as set by the reverse proxy in front of this app. The API needs it for the office-network check. */
export function forwardedFor(req: Request): string | undefined {
  return req.headers.get('x-forwarded-for') ?? undefined;
}
