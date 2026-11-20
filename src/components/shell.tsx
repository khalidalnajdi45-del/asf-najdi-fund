'use client';
import { go, currentPath } from '@/lib/nav';
import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  ArrowUpFromLine, BarChart3, Bell, BookOpen, CalendarCheck, FileText, HandCoins, LayoutDashboard, LogOut, Menu,
  PiggyBank, Receipt, ScrollText, Settings, ShieldCheck, TrendingUp, Coins, Gift, Lock, Sparkles, PieChart, User, Users, Wallet, X, FileClock, PartyPopper, Mail, Send,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ForcePasswordChange } from './force-password';
import { loginName } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { Loading } from './ui';
import { WelcomeSplash } from './welcome';

type NavItem = { href: string; label: string; icon: ReactNode; group?: string };

const ic = 'size-[18px]';
export const managerNav: NavItem[] = [
  { href: '/admin/', label: 'لوحة التحكم', icon: <LayoutDashboard className={ic} /> },
  { href: '/admin/advisor/', label: 'نَجْد | NAJD AI', icon: <Sparkles className={ic} /> },
  { href: '/admin/members/', label: 'الأعضاء', icon: <Users className={ic} />, group: 'العمليات' },
  { href: '/admin/contributions/', label: 'الاشتراكات الشهرية', icon: <CalendarCheck className={ic} />, group: 'العمليات' },
  { href: '/admin/deposits/', label: 'الودائع', icon: <PiggyBank className={ic} />, group: 'العمليات' },
  { href: '/admin/withdrawals/', label: 'طلبات السحب', icon: <ArrowUpFromLine className={ic} />, group: 'العمليات' },
  { href: '/admin/loan-applications/', label: 'طلبات القروض', icon: <FileText className={ic} />, group: 'القروض' },
  { href: '/admin/loans/', label: 'إدارة القروض', icon: <HandCoins className={ic} />, group: 'القروض' },
  { href: '/admin/investments/', label: 'الاستثمارات', icon: <TrendingUp className={ic} />, group: 'المالية' },
  { href: '/admin/incomes/', label: 'الإيرادات', icon: <Coins className={ic} />, group: 'المالية' },
  { href: '/admin/distributions/', label: 'توزيع الأرباح', icon: <Gift className={ic} />, group: 'المالية' },
  { href: '/admin/expenses/', label: 'المصروفات', icon: <Receipt className={ic} />, group: 'المالية' },
  { href: '/admin/ledger/', label: 'دفتر الأستاذ', icon: <BookOpen className={ic} />, group: 'المالية' },
  { href: '/admin/reports/', label: 'التقارير المالية', icon: <BarChart3 className={ic} />, group: 'المالية' },
  { href: '/admin/periods/', label: 'الإقفال المالي', icon: <Lock className={ic} />, group: 'المالية' },
  { href: '/admin/messages/', label: 'مراسلة الأعضاء', icon: <Send className={ic} />, group: 'العائلة' },
  { href: '/admin/monthly-reports/', label: 'التقارير الشهرية للأعضاء', icon: <Mail className={ic} />, group: 'العائلة' },
  { href: '/admin/events/', label: 'المناسبات والدعوات', icon: <PartyPopper className={ic} />, group: 'العائلة' },
  { href: '/admin/notifications/', label: 'الإشعارات', icon: <Bell className={ic} />, group: 'النظام' },
  { href: '/admin/audit/', label: 'سجل التدقيق', icon: <ShieldCheck className={ic} />, group: 'النظام' },
  { href: '/admin/settings/', label: 'إعدادات الصندوق', icon: <Settings className={ic} />, group: 'النظام' },
  { href: '/admin/profile/', label: 'حسابي', icon: <User className={ic} />, group: 'النظام' },
];

export const memberNav: NavItem[] = [
  { href: '/member/', label: 'الرئيسية', icon: <LayoutDashboard className={ic} /> },
  { href: '/member/contributions/', label: 'اشتراكاتي', icon: <CalendarCheck className={ic} /> },
  { href: '/member/deposits/', label: 'ودائعي', icon: <Wallet className={ic} /> },
  { href: '/member/loans/', label: 'قروضي', icon: <HandCoins className={ic} /> },
  { href: '/member/finance/', label: 'ماليتي', icon: <PieChart className={ic} /> },
  { href: '/member/transactions/', label: 'عملياتي', icon: <FileClock className={ic} /> },
  { href: '/member/reports/', label: 'تقاريري الشهرية', icon: <Mail className={ic} /> },
  { href: '/member/investments/', label: 'استثمارات الصندوق', icon: <TrendingUp className={ic} /> },
  { href: '/member/advisor/', label: 'نَجْد | NAJD AI', icon: <Sparkles className={ic} /> },
  { href: '/member/statements/', label: 'كشوف الحساب', icon: <ScrollText className={ic} /> },
  { href: '/member/events/', label: 'المناسبات', icon: <PartyPopper className={ic} /> },
  { href: '/member/notifications/', label: 'الإشعارات', icon: <Bell className={ic} /> },
  { href: '/member/profile/', label: 'ملفي الشخصي', icon: <User className={ic} /> },
];

/** Mobile bottom bar: the most used pages one tap away; «المزيد» opens the full menu. */
const MEMBER_TABS = ['/member/', '/member/contributions/', '/member/loans/', '/member/deposits/'];
const MANAGER_TABS = ['/admin/', '/admin/members/', '/admin/contributions/', '/admin/loans/'];
const SHORT: Record<string, string> = { '/admin/': 'الرئيسية', '/admin/contributions/': 'الاشتراكات', '/admin/loans/': 'القروض', '/member/contributions/': 'اشتراكاتي' };

function BottomBar({ items, active, onMore, moreActive }: { items: NavItem[]; active: (h: string) => boolean; onMore: () => void; moreActive: boolean }) {
  const tab = (on: boolean) => clsx('relative flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5 text-[10.5px] transition-colors', on ? 'font-semibold text-brand-700' : 'text-muted');
  const dot = <span className="absolute top-0 h-[3px] w-8 rounded-b-full bg-gold-500" />;
  return (
    <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="mx-auto flex max-w-lg">
        {items.map(i => {
          const on = active(i.href);
          return <a key={i.href} href={i.href} className={tab(on)}>{on && dot}
            <span className={clsx('flex size-8 items-center justify-center rounded-xl transition-colors', on && 'bg-brand-50')}>{i.icon}</span>{SHORT[i.href] ?? i.label}</a>;
        })}
        <button onClick={onMore} className={tab(moreActive)}>{moreActive && dot}
          <span className={clsx('flex size-8 items-center justify-center rounded-xl', moreActive && 'bg-brand-50')}><Menu className="size-[18px]" /></span>المزيد</button>
      </div>
    </nav>
  );
}

function useUnread(userId?: string) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const load = async () => {
      const { count } = await supabase().from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_read', false);
      if (alive) setN(count ?? 0);
    };
    load();
    const t = setInterval(load, 60_000);
    const h = () => load();
    window.addEventListener('notifications-changed', h);
    return () => { alive = false; clearInterval(t); window.removeEventListener('notifications-changed', h); };
  }, [userId]);
  return n;
}

export function AppShell({ role, children }: { role: 'manager' | 'member'; children: ReactNode }) {
  const { ready, session, profile, fund, mfaRequired, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('');
  const unread = useUnread(profile?.id);
  const nav = role === 'manager' ? managerNav : memberNav.filter(n => n.href !== '/member/advisor/' || fund?.ai_members_enabled);

  useEffect(() => { const f = () => { setPath(currentPath()); setOpen(false); }; f(); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  useEffect(() => {
    if (!ready) return;
    if (!session || mfaRequired) { go('/login/', true); return; }
    if (profile && profile.role !== role) go(profile.role === 'manager' ? '/admin/' : '/member/', true);
  }, [ready, session, profile, role, mfaRequired]);

  if (!ready || !session || !profile || profile.role !== role) return <div className="min-h-screen"><Loading /></div>;
  if (!profile.is_active) {
    return <div className="flex min-h-screen items-center justify-center p-6 text-center text-muted">الحساب غير نشط. يرجى التواصل مع مدير الصندوق. <button className="mr-2 text-brand-600 underline" onClick={signOut}>خروج</button></div>;
  }

  if ((session.user as any)?.user_metadata?.must_change_password) return <ForcePasswordChange />;

  const active = (href: string) => (href === '/admin/' || href === '/member/') ? path === href || path === href.slice(0, -1) : path.startsWith(href.slice(0, -1));
  const notifHref = role === 'manager' ? '/admin/notifications/' : '/member/notifications/';
  let lastGroup: string | undefined;

  const sidebar = (
    <nav className="flex h-full flex-col">
      <a href={nav[0].href} className="flex items-center gap-3 px-5 py-5">
        <img src={fund?.logo_url || '/brand/mark-gold.svg'} alt="" className="h-9 w-11 shrink-0 object-contain" />
        <div className="min-w-0">
          <div className="truncate font-display text-[15px] font-semibold text-white">{fund?.fund_name ?? 'الصندوق العائلي'}</div>
          <div className="text-[11px] text-brand-200"><span className="text-gold-300">ASF</span> · {role === 'manager' ? 'بوابة مدير الصندوق' : 'بوابة العضو'}</div>
        </div>
      </a>
      <div className="no-scrollbar flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-3 pb-4">
        {nav.map(item => {
          const header = item.group && item.group !== lastGroup ? item.group : null;
          lastGroup = item.group;
          return (
            <div key={item.href}>
              {header && <div className="px-3 pb-1 pt-4 text-[11px] font-medium text-brand-200/80">{header}</div>}
              <a href={item.href}
                className={clsx('flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors',
                  active(item.href) ? 'bg-white/10 font-medium text-white shadow-[inset_-3px_0_0_var(--color-gold-500)]' : 'text-brand-100 hover:bg-white/5 hover:text-white')}>
                {item.icon}<span className="flex-1">{item.label}</span>
                {item.href === notifHref && unread > 0 && <span className="rounded-full bg-gold-500 px-1.5 text-[11px] font-semibold text-brand-900 num">{unread}</span>}
              </a>
            </div>
          );
        })}
      </div>
      <div className="border-t border-white/10 p-3">
        <div className="mb-2 px-2 text-xs text-brand-200">
          <div className="truncate font-medium text-white">{profile.full_name}</div>
          <div className="truncate" dir="ltr">{loginName(profile.email)}</div>
        </div>
        <button onClick={async () => { await signOut(); go('/login/', true); }}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-brand-100 hover:bg-white/5 hover:text-white">
          <LogOut className="size-4" /> تسجيل الخروج
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen lg:h-dvh lg:overflow-hidden lg:pr-64">
      <aside className="shurfa no-print fixed inset-y-0 right-0 z-30 hidden w-64 bg-brand-900 lg:block">{sidebar}</aside>
      {open && (
        <div className="no-print fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setOpen(false)} />
          <aside className="shurfa absolute inset-y-0 right-0 w-72 bg-brand-900 shadow-xl">
            <button className="absolute left-3 top-5 text-brand-100" onClick={() => setOpen(false)} aria-label="إغلاق"><X className="size-5" /></button>
            {sidebar}
          </aside>
        </div>
      )}
      <div id="app-scroll" className="app-scroll lg:h-dvh lg:overflow-y-auto">
      <header className="no-print sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur lg:hidden">
        <button onClick={() => setOpen(true)} aria-label="القائمة" className="rounded-md p-1.5 hover:bg-white"><Menu className="size-5" /></button>
        <span className="flex items-center gap-2 text-sm font-semibold"><img src="/brand/mark-plum.svg" alt="" className="h-6 w-7" />{fund?.fund_name}</span>
        <a href={notifHref} className="relative rounded-md p-1.5 hover:bg-white" aria-label="الإشعارات">
          <Bell className="size-5" />
          {unread > 0 && <span className="absolute -top-0.5 -left-0.5 size-2.5 rounded-full bg-gold-500" />}
        </a>
      </header>
      {fund?.demo_mode && (
        <div className="no-print border-b border-gold-100 bg-gold-100/70 px-4 py-1.5 text-center text-xs text-gold-700">
          بيانات تجريبية — جميع الأسماء والمبالغ في هذه النسخة للعرض والاختبار فقط
        </div>
      )}
      <main className="mx-auto max-w-[1280px] px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
      <BottomBar items={(role === 'manager' ? MANAGER_TABS : MEMBER_TABS).map(h => nav.find(n => n.href === h)!).filter(Boolean)}
        active={active} onMore={() => setOpen(true)} moreActive={!(role === 'manager' ? MANAGER_TABS : MEMBER_TABS).some(h => active(h))} />
      <WelcomeSplash />
    </div>
  );
}
