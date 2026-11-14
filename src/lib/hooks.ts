'use client';
import { currentSearch } from '@/lib/nav';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cleanError } from './supabase';

/** Load async data; re-runs when deps change. `reload()` refreshes after a mutation. */
export function useData<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(async () => {
    const id = ++seq.current;
    setLoading(true);
    try {
      const d = await loader();
      if (id === seq.current) { setData(d); setError(null); }
    } catch (e: any) {
      if (id === seq.current) setError(cleanError(e?.message ?? String(e)));
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run, setData };
}

/** Read a query-string parameter (static export friendly — no Suspense needed). */
export function useParam(name: string): string | null {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setV(new URLSearchParams(currentSearch()).get(name));
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, [name]);
  return v;
}

/** Unwrap a Supabase query result */
export async function q<T = any>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(cleanError(error.message));
  return data as T;
}
