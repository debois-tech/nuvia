import { NextResponse } from 'next/server';
import { API_URL, forwardedFor, TOKEN_COOKIE } from '@/lib/server';

/** Signs in against the API and keeps the token in an httpOnly cookie, so page scripts never see it. */
export async function POST(req: Request) {
  const body = await req.text();
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(forwardedFor(req) ? { 'x-forwarded-for': forwardedFor(req)! } : {}) },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ message: json.message ?? 'Sign-in failed' }, { status: res.status });
  const out = NextResponse.json({ user: json.user });
  out.cookies.set(TOKEN_COOKIE, json.token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 12 * 3600,
  });
  return out;
}
