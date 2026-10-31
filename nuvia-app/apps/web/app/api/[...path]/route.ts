import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { API_URL, forwardedFor, TOKEN_COOKIE } from '@/lib/server';

// Browser calls /api/<path> and this forwards to the API with the token from the cookie.
// Agent endpoints are signed by the desktop agent directly against the API and are not reachable through here.
const BLOCKED = /^(agent|auth\/login)(\/|$)/;

// Response headers worth passing on. Downloads need the disposition and the hardening headers intact.
const PASS = ['content-type', 'content-disposition', 'content-length', 'x-content-type-options', 'content-security-policy'];

async function proxy(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const target = path.join('/');
  if (BLOCKED.test(target)) return NextResponse.json({ message: 'Not found' }, { status: 404 });
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  const url = new URL(req.url);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD' && req.body !== null;
  const contentLength = req.headers.get('content-length');
  const res = await fetch(`${API_URL}/${target}${url.search}`, {
    method: req.method,
    headers: {
      ...(hasBody ? { 'content-type': req.headers.get('content-type') ?? 'application/json' } : {}),
      ...(hasBody && contentLength ? { 'content-length': contentLength } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(forwardedFor(req) ? { 'x-forwarded-for': forwardedFor(req)! } : {}),
    },
    // The body is streamed through untouched, so file uploads stay binary and are never held in memory here.
    body: hasBody ? req.body : undefined,
    ...(hasBody ? { duplex: 'half' } : {}),
    cache: 'no-store',
  } as RequestInit);
  const headers = new Headers();
  for (const h of PASS) {
    const v = res.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new NextResponse(res.status === 204 || res.status === 304 ? null : res.body, { status: res.status, headers });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
