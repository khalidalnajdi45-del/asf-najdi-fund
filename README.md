# صندوق النجدي الادخاري — Family Fund Management Platform

منصة لإدارة صندوق عائلي للادخار والاستثمار: الاشتراكات الشهرية الإلزامية، الودائع الاختيارية، القروض الداخلية، الاستثمارات، المصروفات، ودفتر أستاذ بقيد مزدوج غير قابل للتعديل الصامت. واجهة عربية كاملة (RTL) بدورين فقط: **مدير الصندوق** و**العضو**.

---

## 1. Architecture

```
Browser (Next.js static app, Arabic RTL)
   │  supabase-js — publishable key only
   ▼
Supabase
   ├─ Auth (bcrypt password hashing, JWT sessions, optional TOTP 2FA)
   ├─ PostgREST
   │    ├─ SELECT on tables/views  → filtered by Row-Level Security
   │    └─ RPC (SECURITY DEFINER functions) → the ONLY write path
   ├─ Postgres 17 — schema, accounting engine, business rules, audit
   ├─ Storage — private "documents" bucket
   └─ pg_cron — daily jobs (obligations, loan statuses, reminders)
```

**Why the business logic lives in Postgres.** Every financial operation (e.g. disbursing a loan) is one SQL function = one database transaction: the loan row, the repayment schedule, the cash movement, the balanced journal entry, the transaction record, the audit row and the member notification commit together or roll back together. Authorization is re-checked inside each function (`assert_manager()` / `assert_member()`), so nothing depends on the frontend. Clients have **no INSERT/UPDATE/DELETE privilege on any table**.

> Stack note: the brief preferred Next.js + Prisma. Prisma was replaced by plain, versioned SQL migrations because the integrity guarantees here (deferred balance constraints, immutability triggers, RLS, SECURITY DEFINER APIs) are native Postgres features that an ORM can't express, and because the app runs as a static site on Netlify with Supabase as the backend. Next.js, TypeScript, Tailwind CSS and Recharts are used as requested; UI primitives are hand-built in the shadcn style (no runtime dependency).

### Folder structure
```
supabase/
  migrations/0001_schema.sql      tables, chart of accounts, constraints, indexes
  migrations/0002_integrity.sql   immutable ledger, balanced-entry checks, audit triggers
  migrations/0003_core.sql        auth helpers, posting engine, derived balance views
  migrations/0004_operations.sql  the API: every financial operation
  migrations/0005_reports.sql     dashboards, statements, financial reports, integrity_check()
  migrations/0006_security.sql    RLS policies + privileges
  migrations/0007_platform.sql    storage bucket/policies + pg_cron (Supabase only)
  seed.sql                        DEMO data (posted through the real API)
  reset_data.sql                  wipe demo data before go-live
src/
  app/login, app/admin/*, app/member/*   pages (35 routes)
  components/                     UI kit, shell, charts, operation dialogs, statements
  lib/                            supabase client, formatting, auth context, exports
tests/                            Vitest + PGlite (real Postgres in-process)
```

---

## 2. Accounting model

Chart of accounts (codes are fixed; names configurable in DB):

| Code | Account | Type |
|---|---|---|
| 1000 | Cash and bank | Asset |
| 1100 | Member loans receivable | Asset |
| 1200 / 1210 | Investments at cost / fair-value adjustment | Asset |
| 2000 | Member voluntary deposits | **Liability** |
| 2100 | Other liabilities | Liability |
| 2300 | Refundable contributions (if bylaws say so) | Liability |
| 3000 | Members' contribution capital (default) | Equity |
| 3100 / 3200 / 3900 | Retained earnings / **Unrealized gains reserve** / Opening balances | Equity |
| 4000 / 4100 / 4900 | Realized investment income / Loan fees / Other income | Income |
| 5000 / 5100 | Operating expenses / Realized investment losses | Expense |

| Operation | Debit | Credit |
|---|---|---|
| Monthly contribution | Cash | 3000 (or 2300 per bylaws) |
| Voluntary deposit | Cash | 2000 Member deposits |
| Withdrawal **paid** | 2000 | Cash |
| Loan disbursed | 1100 (principal + fee) | Cash, 4100 fee |
| Loan repayment | Cash | 1100 |
| Investment capital | 1200 | Cash |
| Revaluation (unrealized) | 1210 | 3200 reserve — never income, never cash |
| Investment income (cash) | Cash | 4000 |
| Exit | Cash; release 3200→1210 | 1200 cost; 4000 gain / Dr 5100 loss |
| Expense | 5000 | Cash |

### Integrity guarantees (enforced by the database)
- `numeric(14,2)` everywhere; amounts validated to 2 decimals. No floats.
- Every journal entry must balance — deferred constraint trigger checked at COMMIT.
- `financial_transactions`, `journal_entries`, `journal_entry_lines`, payments, repayments, installments, investment transactions, expenses, **audit_logs** are append-only (UPDATE/DELETE raise an error). Corrections use `reverse_transaction()` which posts an equal-and-opposite entry linked to the original.
- Balances (contributions, deposits, loan outstanding, installment status, investment value) are **derived** from posted, non-reversed transactions — never stored, so they cannot drift.
- `integrity_check()` reconciles every sub-ledger with the general ledger and verifies Assets = Liabilities + Equity (+ current surplus). Shown on the dashboard and ledger page.
- Idempotency: every money operation accepts a client key (`p_key`, unique); double-submits return the original transaction. Over-payment of contributions/loans is rejected.
- Withdrawal requests never reduce balances until **approved and paid**; loan approval never moves cash until **disbursed**.
- Cash cannot go negative (configurable).
- Mandatory contributions and voluntary deposits are separate accounts, tables, views and screens.
- Manual journals cannot touch sub-ledger-controlled accounts (2000, 1100, 1200, 1210, 3000, 2300, 3200).

### Configurable per bylaws (Fund Settings)
Contribution amount / due day / start month; **contribution treatment** (non-refundable equity vs refundable liability — locked after the first payment); loan max amount, max months, default fee % (0 = interest-free qard), one-loan rule, block-if-overdue, grace days; withdrawal notice days & minimum; investment & expense categories; fiscal year; reminder timings and external channels; **profit allocation policy** (none assumed). Every change is logged with before/after values.

---

## 3. Local development

Requirements: Node 22+.

```bash
npm install
cp .env.example .env.local      # fill in your Supabase URL + publishable key
npm run dev                     # http://localhost:3000
npm test                        # financial + permission tests (no external DB needed)
npm run build                   # static export → ./out
```

### Database setup (new Supabase project)
1. Create a project (region `eu-central-1` or the closest to Saudi Arabia).
2. Apply `supabase/migrations/0001…0007` in order (SQL editor, `supabase db push`, or the Supabase MCP).
3. Either load demo data: run `supabase/seed.sql`, **or** create the real manager:
   ```sql
   select public._create_auth_user('manager@example.com', 'StrongPassword!', 'اسم المدير', 'manager');
   ```
4. Supabase → Authentication → Providers → Email: **disable "Allow new users to sign up"** (accounts are created only by the manager).
5. Copy the project URL and publishable key into `.env.local` / Netlify environment variables.

Demo logins (after `seed.sql`):
- Manager: `manager@najdi-fund.demo` / `Demo@2026!`
- Members: `member01@najdi-fund.demo` … `member12@najdi-fund.demo` / `Member@2026!`

### Going live with real data
1. Run `supabase/reset_data.sql` once (wipes demo data and demo logins).
2. Create the real manager (step 3 above), sign in, review **Fund Settings** (especially contribution treatment and start month).
3. Add members (Members → عضو جديد). Their historical monthly obligations are generated from their join month.
4. Import history through the normal screens (or the same SQL functions): past contributions with their real dates, deposits, loans (approve → disburse with the historical date → repayments), investments, expenses. Opening bank balances that don't belong to a member can be entered as a manual journal against account 3900.

---

## 4. Production deployment (Netlify + Supabase)

1. Netlify → new site from this folder/repo. Build command `npm run build`, publish dir `out` (already in `netlify.toml`, which also sets security headers + CSP).
2. Environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. Supabase → Authentication → URL configuration: set Site URL to the Netlify URL.
4. Backups: Supabase takes daily backups (Pro plan adds point-in-time recovery). For an extra off-site copy run `supabase db dump` on a schedule, and export reports monthly from the Reports page.
5. Optional: Authentication → MFA is enabled by default for TOTP; each user can turn on 2FA from their profile page.

---

## 5. Integration points

| Area | Status | How to extend |
|---|---|---|
| In-app notifications | ✅ working | `notifications` table, read/unread, links |
| Email / SMS / WhatsApp | queue ready | When a channel is enabled in settings, `_notify()` inserts rows into `notification_deliveries (status='pending')`. Add a Supabase Edge Function on a cron that reads pending rows, sends via your provider (e.g. Unifonic/Twilio/WhatsApp Cloud API), and marks them `sent`/`failed`. |
| Scheduled jobs | ✅ pg_cron daily 06:00 Riyadh | `run_daily_jobs()` — also runs on every manager dashboard load (idempotent) |
| PDF export | ✅ browser print → "Save as PDF" | Print stylesheet renders Arabic RTL correctly; swap for a server renderer if needed |
| Excel export | ✅ SheetJS (RTL workbook) | — |
| Documents | ✅ private bucket, 10 MB, PDF/images/Office | Manager uploads; signed URLs expire after 60 s |

---

## 6. Tests

`npm test` boots a real Postgres (PGlite) in-process, applies the same migrations, and runs:

creating members (bcrypt hashes, obligations) · recording contributions (balanced journal, partial/overdue, idempotency, over-payment) · voluntary deposits (request ≠ balance change; not income) · withdrawals (balance only drops after approve **and** pay) · loan request → approve (no cash) → disburse (atomic schedule; failed disbursement leaves nothing) → repayments → early payoff · investments (unrealized ≠ cash/income, realized income, full & partial exits with gain/loss) · expenses · reversals & immutability (UPDATE/DELETE blocked, unbalanced entries rejected at commit) · member data isolation via RLS (cannot read others, cannot write tables, cannot fetch another member's statement) · notifications · dashboards, monthly report, trial balance, cash-flow roll-forward · every entry balances and all sub-ledgers reconcile · policy-change audit · the full demo seed reconciles.
