import { NextResponse } from 'next/server';
import { TOKEN_COOKIE } from '@/lib/server';

export async function POST() {
  const out = new NextResponse(null, { status: 204 });
  out.cookies.delete(TOKEN_COOKIE);
  return out;
}
