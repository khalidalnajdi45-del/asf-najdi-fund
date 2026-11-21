// Single-file HTML demo entry (built by scripts/build-html.mjs). Hash-routed SPA over the same pages.
import { createRoot } from 'react-dom/client';
import { useEffect, useState, type ComponentType } from 'react';
import './app/globals.css';
import { Providers } from '@/components/providers';
import { AppShell } from '@/components/shell';
import { currentPath, go } from '@/lib/nav';
import P0 from '@/app/admin/loan-applications/page';
import EvA from '@/app/admin/events/page';
import EvM from '@/app/member/events/page';
import MrA from '@/app/admin/monthly-reports/page';
import MrM from '@/app/member/reports/page';
import InvM from '@/app/member/investments/page';
import MsgA from '@/app/admin/messages/page';
import P1 from '@/app/admin/investments/view/page';
import P2 from '@/app/member/withdrawals/new/page';
import P3 from '@/app/member/contributions/page';
import P4 from '@/app/member/notifications/page';
import P5 from '@/app/admin/contributions/page';
import P6 from '@/app/admin/notifications/page';
import P7 from '@/app/member/deposits/new/page';
import P8 from '@/app/member/transactions/page';
import P9 from '@/app/admin/members/view/page';
import P10 from '@/app/admin/investments/page';
import P11 from '@/app/admin/withdrawals/page';
import P12 from '@/app/member/loans/view/page';
import P13 from '@/app/member/statements/page';
import P14 from '@/app/admin/loans/view/page';
import P15 from '@/app/member/loans/new/page';
import P16 from '@/app/admin/statement/page';
import P17 from '@/app/member/deposits/page';
import P18 from '@/app/admin/deposits/page';
import P19 from '@/app/admin/expenses/page';
import PInc from '@/app/admin/incomes/page';
import PDist from '@/app/admin/distributions/page';
import PPer from '@/app/admin/periods/page';
import PAdv from '@/app/admin/advisor/page';
import PMAdv from '@/app/member/advisor/page';
import PMFin from '@/app/member/finance/page';
import P20 from '@/app/admin/settings/page';
import P21 from '@/app/member/profile/page';
import P22 from '@/app/admin/members/page';
import P23 from '@/app/admin/profile/page';
import P24 from '@/app/admin/reports/page';
import P25 from '@/app/admin/ledger/page';
import P26 from '@/app/member/loans/page';
import P27 from '@/app/admin/audit/page';
import P28 from '@/app/admin/loans/page';
import P29 from '@/app/member/page';
import P30 from '@/app/admin/page';
import P31 from '@/app/login/page';
import P32 from '@/app/page';
import { registerSW } from '@/lib/push';

const ROUTES: Record<string, ComponentType> = {
  '/admin/loan-applications/': P0,
  '/admin/events/': EvA,
  '/member/events/': EvM,
  '/admin/monthly-reports/': MrA,
  '/member/reports/': MrM,
  '/member/investments/': InvM,
  '/admin/messages/': MsgA,
  '/admin/investments/view/': P1,
  '/member/withdrawals/new/': P2,
  '/member/contributions/': P3,
  '/member/notifications/': P4,
  '/admin/contributions/': P5,
  '/admin/notifications/': P6,
  '/member/deposits/new/': P7,
  '/member/transactions/': P8,
  '/admin/members/view/': P9,
  '/admin/investments/': P10,
  '/admin/withdrawals/': P11,
  '/member/loans/view/': P12,
  '/member/statements/': P13,
  '/admin/loans/view/': P14,
  '/member/loans/new/': P15,
  '/admin/statement/': P16,
  '/member/deposits/': P17,
  '/admin/deposits/': P18,
  '/admin/expenses/': P19,
  '/admin/incomes/': PInc,
  '/admin/distributions/': PDist,
  '/admin/periods/': PPer,
  '/admin/advisor/': PAdv,
  '/member/advisor/': PMAdv,
  '/member/finance/': PMFin,
  '/admin/settings/': P20,
  '/member/profile/': P21,
  '/admin/members/': P22,
  '/admin/profile/': P23,
  '/admin/reports/': P24,
  '/admin/ledger/': P25,
  '/member/loans/': P26,
  '/admin/audit/': P27,
  '/admin/loans/': P28,
  '/member/': P29,
  '/admin/': P30,
  '/login/': P31,
  '/': P32,
};

// Same-app links (<a href="/...">) become hash routes
document.addEventListener('click', e => {
  const a = (e.target as HTMLElement).closest?.('a');
  const href = a?.getAttribute('href');
  if (a && href && href.startsWith('/') && !a.target) { e.preventDefault(); go(href); }
});

function App() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => { setHash(location.hash); window.scrollTo(0, 0); document.getElementById('app-scroll')?.scrollTo(0, 0); };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  const path = currentPath();
  const Page = ROUTES[path] ?? ROUTES['/'];
  const page = <Page key={hash} />;
  if (path.startsWith('/admin/')) return <AppShell role="manager">{page}</AppShell>;
  if (path.startsWith('/member/')) return <AppShell role="member">{page}</AppShell>;
  return page;
}

// Push: register the service worker (real site only) and follow taps on notifications
registerSW();
navigator.serviceWorker?.addEventListener('message', e => {
  if (e.data?.type === 'open' && typeof e.data.url === 'string') { const h = e.data.url.split('#')[1]; if (h) location.hash = h; }
});

createRoot(document.getElementById('root')!).render(<Providers><App /></Providers>);
