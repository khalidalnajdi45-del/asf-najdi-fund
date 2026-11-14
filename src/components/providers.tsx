'use client';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from './ui';
import { DemoGate } from './demo-gate';
export function Providers({ children }: { children: React.ReactNode }) {
  return <DemoGate><ToastProvider><AuthProvider>{children}</AuthProvider></ToastProvider></DemoGate>;
}
