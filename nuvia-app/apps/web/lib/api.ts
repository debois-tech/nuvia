'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly body: any = null) { super(message); }
}

export async function api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  return handle<T>(
    await fetch(`/api/${path}`, {
      method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
      headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    }),
  );
}

/** Uploads a file as the raw request body (no multipart). Its name and type travel in the query string. */
export async function uploadFile<T = unknown>(path: string, file: File): Promise<T> {
  const qs = new URLSearchParams({ name: file.name, type: file.type || 'application/octet-stream' });
  return handle<T>(await fetch(`/api/${path}?${qs}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file, cache: 'no-store' }));
}

/** Uploads a file as the raw request body with extra query parameters (used by the sheet import). */
export async function uploadRaw<T = unknown>(path: string, file: File, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams({ name: file.name });
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
  return handle<T>(await fetch(`/api/${path}?${qs}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: file, cache: 'no-store' }));
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
    location.href = '/login';
    throw new HttpError(401, 'Signed out');
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const issues = Array.isArray(json?.issues) && json.issues.length ? `: ${json.issues.map((i: { path?: string; message: string }) => (i.path ? `${i.path} ${i.message}` : i.message)).join('; ')}` : '';
    throw new HttpError(res.status, typeof json?.message === 'string' ? json.message + issues : `Request failed (${res.status})`, json);
  }
  return json as T;
}

/** Loads a resource, optionally refreshing it on an interval. `reload()` refetches on demand. */
export function useApi<T>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    try {
      const d = await api<T>(path);
      if (mine === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    setLoading(true);
    void reload();
    if (!refreshMs) return;
    const t = setInterval(() => void reload(), refreshMs);
    return () => clearInterval(t);
  }, [reload, refreshMs]);
  return { data, error, loading, reload };
}

export const fmtDate = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  return n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}
export const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–');
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function fmtDuration(seconds: number) {
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
