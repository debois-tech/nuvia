import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { API_URL, TOKEN_COOKIE } from '@/lib/server';

// Executives land on the leadership overview, everyone else on attendance.
export default async function Home() {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;
  if (token) {
    try {
      const res = await fetch(`${API_URL}/auth/me`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (res.ok && (await res.json()).role === 'executive') redirect('/leadership');
    } catch (err) {
      // redirect() throws to do its job; anything else (API down) falls through to the default page.
      if ((err as { digest?: string }).digest?.startsWith('NEXT_REDIRECT')) throw err;
    }
  }
  redirect('/attendance');
}
