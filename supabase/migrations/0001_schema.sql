-- =====================================================================
-- Al-Najdi Family Fund — core schema
-- All money columns are numeric(14,2). No floating point anywhere.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- helpers ----------
create or replace function public.fund_today() returns date
language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date $$;

-- ---------- settings ----------
create table public.fund_settings (
  id                         smallint primary key default 1 check (id = 1),
  fund_name                  text not null default 'صندوق النجدي الادخاري',
  logo_url                   text,
  currency                   text not null default 'SAR' check (currency = 'SAR'),
  monthly_contribution       numeric(14,2) not null default 200 check (monthly_contribution > 0),
  contribution_due_day       smallint not null default 10 check (contribution_due_day between 1 and 28),
  contribution_start_period  date not null default date '2026-01-01',
  -- Treatment of mandatory contributions per the fund bylaws:
  --   equity_non_refundable : credited to members' capital (equity)
  --   liability_refundable  : credited to a refundable liability account
  contribution_treatment     text not null default 'equity_non_refundable'
                               check (contribution_treatment in ('equity_non_refundable','liability_refundable')),
  loan_max_amount            numeric(14,2) not null default 50000 check (loan_max_amount > 0),
  loan_max_months            smallint not null default 24 check (loan_max_months between 1 and 120),
  loan_default_fee_pct       numeric(6,3) not null default 0 check (loan_default_fee_pct >= 0 and loan_default_fee_pct <= 100),
  loan_one_active_per_member boolean not null default true,
  loan_block_if_overdue      boolean not null default true,
  loan_grace_days            smallint not null default 5 check (loan_grace_days >= 0),
  withdrawal_notice_days     smallint not null default 0 check (withdrawal_notice_days >= 0),
  withdrawal_min_amount      numeric(14,2) not null default 0 check (withdrawal_min_amount >= 0),
  allow_negative_cash        boolean not null default false,
  approval_requirements      jsonb not null default '{"loan":"manager","withdrawal":"manager","deposit":"manager"}'::jsonb,
  investment_categories      jsonb not null default
    '[{"key":"bank_deposit","label":"ودائع بنكية وودائع لأجل"},{"key":"equity","label":"أسهم"},{"key":"fund","label":"صناديق استثمارية"},{"key":"real_estate","label":"عقار"},{"key":"other","label":"استثمارات أخرى معتمدة"}]'::jsonb,
  expense_categories         jsonb not null default
    '["رسوم بنكية","رسوم إدارية","تقنية واشتراكات","مصاريف قانونية","أخرى"]'::jsonb,
  fiscal_year_start_month    smallint not null default 1 check (fiscal_year_start_month between 1 and 12),
  notification_prefs         jsonb not null default
    '{"contribution_reminder_days_before":3,"repayment_reminder_days_before":3,"maturity_notice_days_before":30,"channels":{"in_app":true,"email":false,"sms":false,"whatsapp":false}}'::jsonb,
  -- Profit allocation is intentionally NOT assumed. Configure when bylaws approve one.
  profit_allocation_policy   jsonb not null default '{"method":"none","note":"لا يوجد توزيع أرباح معتمد حالياً"}'::jsonb,
  demo_mode                  boolean not null default false,
  updated_at                 timestamptz not null default now(),
  updated_by                 uuid
);
insert into public.fund_settings (id) values (1);

-- ---------- users & members ----------
create table public.app_users (
  id          uuid primary key,              -- = auth.users.id
  role        text not null check (role in ('manager','member')),
  email       text not null unique,
  full_name   text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create sequence public.member_no_seq start 1001;
create table public.members (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references public.app_users(id),
  member_no   text not null unique default ('M-' || nextval('public.member_no_seq')),
  full_name   text not null check (length(trim(full_name)) >= 2),
  phone       text,
  email       text,
  join_date   date not null default public.fund_today(),
  status      text not null default 'active' check (status in ('active','inactive')),
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid
);
create index on public.members(status);

-- ---------- chart of accounts ----------
create table public.accounts (
  id          serial primary key,
  code        text not null unique,
  system_key  text unique,
  name_ar     text not null,
  name_en     text not null,
  type        text not null check (type in ('asset','liability','equity','income','expense')),
  normal_side text not null check (normal_side in ('debit','credit')),
  is_active   boolean not null default true
);
insert into public.accounts (code, system_key, name_ar, name_en, type, normal_side) values
 ('1000','cash',               'النقد والبنك',                     'Cash and bank',                       'asset','debit'),
 ('1100','loans_receivable',   'قروض الأعضاء القائمة',             'Member loans receivable',             'asset','debit'),
 ('1200','investments_cost',   'الاستثمارات (بالتكلفة)',           'Investments at cost',                 'asset','debit'),
 ('1210','investments_fv',     'فروق إعادة تقييم الاستثمارات',      'Investment fair-value adjustment',    'asset','debit'),
 ('2000','member_deposits',    'ودائع الأعضاء الاختيارية (التزام)', 'Member voluntary deposits',           'liability','credit'),
 ('2100','other_liabilities',  'التزامات أخرى',                    'Other liabilities',                   'liability','credit'),
 ('2300','contrib_refundable', 'اشتراكات قابلة للاسترداد',         'Refundable member contributions',     'liability','credit'),
 ('3000','contrib_capital',    'رأس مال الاشتراكات الشهرية',       'Members contribution capital',        'equity','credit'),
 ('3100','retained_earnings',  'الأرباح المبقاة',                  'Retained earnings',                   'equity','credit'),
 ('3200','unrealized_reserve', 'احتياطي أرباح/خسائر غير محققة',     'Unrealized gains reserve',            'equity','credit'),
 ('3900','opening_equity',     'أرصدة افتتاحية',                   'Opening balance equity',              'equity','credit'),
 ('4000','investment_income',  'إيرادات استثمار محققة',             'Realized investment income',          'income','credit'),
 ('4100','loan_fee_income',    'رسوم إدارية على القروض',            'Loan administrative fees',            'income','credit'),
 ('4900','other_income',       'إيرادات أخرى',                     'Other income',                        'income','credit'),
 ('5000','operating_expenses', 'مصروفات تشغيلية',                  'Operating expenses',                  'expense','debit'),
 ('5100','investment_losses',  'خسائر استثمار محققة',               'Realized investment losses',          'expense','debit');

-- ---------- documents ----------
create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint check (size_bytes >= 0 and size_bytes <= 10485760),
  entity_type  text check (entity_type in ('investment','expense','transaction','loan','member','other')),
  entity_id    uuid,
  member_id    uuid references public.members(id),
  uploaded_by  uuid,
  created_at   timestamptz not null default now()
);
create index on public.documents(entity_type, entity_id);

-- ---------- financial transactions (source of every money movement) ----------
create sequence public.tx_no_seq start 100001;
create table public.financial_transactions (
  id               uuid primary key default gen_random_uuid(),
  tx_no            text not null unique default ('TX-' || nextval('public.tx_no_seq')),
  tx_type          text not null check (tx_type in (
                     'contribution_payment','deposit','withdrawal_payment','loan_disbursement','loan_repayment',
                     'investment_capital','investment_income','investment_revaluation','investment_exit',
                     'expense','manual_journal','reversal')),
  tx_date          date not null,
  description      text not null,
  amount           numeric(14,2) not null check (amount >= 0),
  member_id        uuid references public.members(id),
  loan_id          uuid,
  investment_id    uuid,
  document_id      uuid references public.documents(id),
  reference        text,
  idempotency_key  text unique,
  reverses_tx_id   uuid unique references public.financial_transactions(id),
  created_by       uuid not null,
  approved_by      uuid not null,
  approved_at      timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create index on public.financial_transactions(member_id, tx_date);
create index on public.financial_transactions(loan_id);
create index on public.financial_transactions(investment_id);
create index on public.financial_transactions(tx_type, tx_date);

-- ---------- journal ----------
create sequence public.je_no_seq start 1;
create table public.journal_entries (
  id                       uuid primary key default gen_random_uuid(),
  entry_no                 bigint not null unique default nextval('public.je_no_seq'),
  entry_date               date not null,
  description              text not null,
  financial_transaction_id uuid not null unique references public.financial_transactions(id),
  reverses_entry_id        uuid unique references public.journal_entries(id),
  created_by               uuid not null,
  created_at               timestamptz not null default now()
);
create index on public.journal_entries(entry_date);

create table public.journal_entry_lines (
  id          bigserial primary key,
  entry_id    uuid not null references public.journal_entries(id),
  account_id  int not null references public.accounts(id),
  member_id   uuid references public.members(id),
  debit       numeric(14,2) not null default 0 check (debit >= 0),
  credit      numeric(14,2) not null default 0 check (credit >= 0),
  memo        text,
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
create index on public.journal_entry_lines(entry_id);
create index on public.journal_entry_lines(account_id);
create index on public.journal_entry_lines(member_id);

-- ---------- contributions ----------
create table public.contributions (            -- monthly obligations
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id),
  period      date not null check (extract(day from period) = 1),
  amount_due  numeric(14,2) not null check (amount_due > 0),
  due_date    date not null,
  created_at  timestamptz not null default now(),
  unique (member_id, period)
);
create index on public.contributions(period);

create table public.contribution_payments (
  id                       uuid primary key default gen_random_uuid(),
  contribution_id          uuid not null references public.contributions(id),
  member_id                uuid not null references public.members(id),
  amount                   numeric(14,2) not null check (amount > 0),
  paid_on                  date not null,
  reference                text,
  financial_transaction_id uuid not null unique references public.financial_transactions(id),
  created_by               uuid not null,
  created_at               timestamptz not null default now()
);
create index on public.contribution_payments(contribution_id);
create index on public.contribution_payments(member_id);

-- ---------- voluntary deposits ----------
create table public.member_deposits (
  id                       uuid primary key default gen_random_uuid(),
  member_id                uuid not null references public.members(id),
  amount                   numeric(14,2) not null check (amount > 0),
  status                   text not null default 'requested' check (status in ('requested','confirmed','rejected','cancelled')),
  method                   text,
  request_note             text,
  requested_at             timestamptz not null default now(),
  deposited_on             date,
  reference                text,
  financial_transaction_id uuid unique references public.financial_transactions(id),
  decided_by               uuid,
  decided_at               timestamptz,
  decision_note            text,
  check (status <> 'confirmed' or financial_transaction_id is not null)
);
create index on public.member_deposits(member_id, status);

create table public.deposit_withdrawals (
  id                       uuid primary key default gen_random_uuid(),
  member_id                uuid not null references public.members(id),
  amount                   numeric(14,2) not null check (amount > 0),
  status                   text not null default 'pending' check (status in ('pending','approved','rejected','paid','cancelled')),
  reason                   text,
  requested_at             timestamptz not null default now(),
  decided_by               uuid,
  decided_at               timestamptz,
  decision_note            text,
  paid_on                  date,
  reference                text,
  financial_transaction_id uuid unique references public.financial_transactions(id),
  check (status <> 'paid' or financial_transaction_id is not null)
);
create index on public.deposit_withdrawals(member_id, status);

-- ---------- loans ----------
create sequence public.loan_no_seq start 501;
create table public.loans (
  id                  uuid primary key default gen_random_uuid(),
  loan_no             text not null unique default ('L-' || nextval('public.loan_no_seq')),
  member_id           uuid not null references public.members(id),
  requested_amount    numeric(14,2) not null check (requested_amount > 0),
  purpose             text not null,
  preferred_months    smallint not null check (preferred_months between 1 and 120),
  notes               text,
  request_date        date not null default public.fund_today(),
  status              text not null default 'pending' check (status in
                        ('pending','approved','rejected','disbursed','active','fully_repaid','overdue','cancelled')),
  approved_amount     numeric(14,2) check (approved_amount > 0),
  fee_amount          numeric(14,2) not null default 0 check (fee_amount >= 0),
  installments_count  smallint check (installments_count between 1 and 120),
  frequency           text check (frequency in ('monthly','quarterly')),
  first_due_date      date,
  decided_by          uuid,
  decided_at          timestamptz,
  decision_note       text,
  disbursed_on        date,
  disbursement_tx_id  uuid unique references public.financial_transactions(id),
  closed_on           date,
  created_at          timestamptz not null default now(),
  check (status not in ('approved','disbursed','active','fully_repaid','overdue')
         or (approved_amount is not null and installments_count is not null and frequency is not null))
);
create index on public.loans(member_id, status);
alter table public.financial_transactions add constraint ft_loan_fk foreign key (loan_id) references public.loans(id);

create table public.loan_installments (
  id          uuid primary key default gen_random_uuid(),
  loan_id     uuid not null references public.loans(id),
  seq         smallint not null,
  due_date    date not null,
  amount_due  numeric(14,2) not null check (amount_due > 0),
  unique (loan_id, seq)
);

create table public.loan_repayments (
  id                       uuid primary key default gen_random_uuid(),
  loan_id                  uuid not null references public.loans(id),
  member_id                uuid not null references public.members(id),
  amount                   numeric(14,2) not null check (amount > 0),
  paid_on                  date not null,
  reference                text,
  financial_transaction_id uuid not null unique references public.financial_transactions(id),
  created_by               uuid not null,
  created_at               timestamptz not null default now()
);
create index on public.loan_repayments(loan_id);

-- ---------- investments ----------
create table public.investments (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  category       text not null,
  description    text,
  provider       text,
  investment_date date not null,
  maturity_date  date,
  status         text not null default 'active' check (status in ('active','matured','exited')),
  notes          text,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
alter table public.financial_transactions add constraint ft_inv_fk foreign key (investment_id) references public.investments(id);

create table public.investment_transactions (
  id                       uuid primary key default gen_random_uuid(),
  investment_id            uuid not null references public.investments(id),
  kind                     text not null check (kind in ('capital_in','income','revaluation','exit')),
  tx_date                  date not null,
  cash_amount              numeric(14,2) not null default 0 check (cash_amount >= 0),   -- cash moved
  cost_delta               numeric(14,2) not null default 0,                            -- change in cost basis
  unrealized_delta         numeric(14,2) not null default 0,                            -- change in unrealized reserve
  realized_pl              numeric(14,2) not null default 0,                            -- realized profit (+) / loss (-)
  valuation_after          numeric(14,2),
  note                     text,
  financial_transaction_id uuid not null unique references public.financial_transactions(id),
  created_at               timestamptz not null default now()
);
create index on public.investment_transactions(investment_id, tx_date);

-- ---------- expenses ----------
create table public.expenses (
  id                       uuid primary key default gen_random_uuid(),
  category                 text not null,
  description              text not null,
  payee                    text,
  amount                   numeric(14,2) not null check (amount > 0),
  expense_date             date not null,
  reference                text,
  financial_transaction_id uuid not null unique references public.financial_transactions(id),
  created_by               uuid not null,
  created_at               timestamptz not null default now()
);

-- ---------- notifications ----------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.app_users(id),
  type        text not null,
  title       text not null,
  body        text,
  link        text,
  is_read     boolean not null default false,
  read_at     timestamptz,
  dedupe_key  text,
  created_at  timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index on public.notifications(user_id, is_read, created_at desc);

-- Outbox: integration point for email / SMS / WhatsApp senders.
create table public.notification_deliveries (
  id              bigserial primary key,
  notification_id uuid not null references public.notifications(id),
  channel         text not null check (channel in ('email','sms','whatsapp')),
  status          text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  attempts        int not null default 0,
  last_error      text,
  created_at      timestamptz not null default now()
);

-- ---------- audit ----------
create table public.audit_logs (
  id          bigserial primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid,
  action      text not null,
  entity      text not null,
  entity_id   text,
  old_data    jsonb,
  new_data    jsonb,
  note        text
);
create index on public.audit_logs(entity, entity_id);
create index on public.audit_logs(occurred_at desc);
