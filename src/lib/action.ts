'use client';
import { useState } from 'react';
import { cleanError } from './supabase';
import { useToast } from '@/components/ui';

/** Wraps a mutation: busy flag, inline error, success toast. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
    setBusy(true); setError(null);
    try {
      const r = await fn();
      if (success) toast.ok(success);
      return r;
    } catch (e: any) {
      const m = cleanError(e?.message ?? String(e));
      setError(m);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}
