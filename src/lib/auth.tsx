'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { setArabicDigits } from './format';

export type Profile = { id: string; role: 'manager' | 'member'; email: string; full_name: string; is_active: boolean };
export type FundInfo = { fund_name: string; logo_url: string | null; demo_mode: boolean; monthly_contribution: string };

type Ctx = {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  memberId: string | null;
  fund: FundInfo | null;
  mfaRequired: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [fund, setFund] = useState<FundInfo | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);

  const load = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) { setProfile(null); setMemberId(null); setMfaRequired(false); setReady(true); return; }
    const sb = supabase();
    const aal = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    const needMfa = aal.data?.nextLevel === 'aal2' && aal.data?.currentLevel !== 'aal2';
    setMfaRequired(!!needMfa);
    const [{ data: p }, { data: m }, { data: f }] = await Promise.all([
      sb.from('app_users').select('*').eq('id', s.user.id).maybeSingle(),
      sb.from('members').select('id').eq('user_id', s.user.id).maybeSingle(),
      sb.from('fund_settings').select('fund_name, logo_url, demo_mode, monthly_contribution').eq('id', 1).maybeSingle(),
    ]);
    setProfile((p as Profile) ?? null);
    setMemberId(m?.id ?? null);
    setFund((f as FundInfo) ?? null);
    setReady(true);
  }, []);

  useEffect(() => {
    try { setArabicDigits(localStorage.getItem('najdi-fund-digits') === 'arab'); } catch {}
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((event, s) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED' || event === 'MFA_CHALLENGE_VERIFIED') {
        setTimeout(() => load(s), 0);
      } else {
        setSession(s);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const value: Ctx = {
    ready, session, profile, memberId, fund, mfaRequired,
    refresh: async () => { const { data } = await supabase().auth.getSession(); await load(data.session); },
    signOut: async () => { await supabase().auth.signOut(); },
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const c = useContext(AuthCtx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
}
