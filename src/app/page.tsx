'use client';
import { go } from '@/lib/nav';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { Loading } from '@/components/ui';

export default function Home() {
  const { ready, session, profile, mfaRequired } = useAuth();
  useEffect(() => {
    if (!ready) return;
    if (!session || mfaRequired || !profile) go('/login/', true);
    else go(profile.role === 'manager' ? '/admin/' : '/member/', true);
  }, [ready, session, profile, mfaRequired]);
  return <Loading />;
}
