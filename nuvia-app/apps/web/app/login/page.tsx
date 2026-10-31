'use client';
import { FormEvent, useState } from 'react';

export default function Login() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgId: f.get('orgId'), password: f.get('password') }),
    });
    if (res.ok) {
      location.href = '/attendance';
      return;
    }
    setError((await res.json().catch(() => ({}))).message ?? 'Sign-in failed');
    setBusy(false);
  }

  return (
    <main className="login card">
      <h1>Sign in to Nuvia</h1>
      <form onSubmit={submit}>
        <label htmlFor="orgId">Org ID</label>
        <input id="orgId" name="orgId" autoComplete="username" required autoFocus />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
        {error && <p className="err" role="alert">{error}</p>}
        <p><button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></p>
      </form>
    </main>
  );
}
