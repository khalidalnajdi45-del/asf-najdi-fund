-- 0026 «ماليتي» — personal finance for each user (phase 1).
-- Strictly private: keyed by auth.uid(), no table grants at all, every read/write goes through
-- owner-scoped SECURITY DEFINER functions. The fund manager cannot see another user's data.
-- Also: AI chat history becomes owner-only (members may discuss their personal finances with NAJD).

create table public.pf_categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  kind       text not null check (kind in ('income','expense')),
  name       text not null check (length(trim(name)) between 1 and 40),
  color      text not null default '#8a7a5c',
  sort       int not null default 100,
  unique (user_id, kind, name)
);

create table public.pf_recurring (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  kind           text not null check (kind in ('income','expense')),
  amount         numeric(14,2) not null check (amount > 0),
  category_id    uuid references public.pf_categories(id) on delete set null,
  note           text check (length(note) <= 120),
  day_of_month   int not null check (day_of_month between 1 and 28),
  start_month    date not null,
  last_generated date,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table public.pf_transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  kind         text not null check (kind in ('income','expense')),
  amount       numeric(14,2) not null check (amount > 0 and amount < 100000000),
  category_id  uuid references public.pf_categories(id) on delete set null,
  note         text check (length(note) <= 160),
  tx_date      date not null,
  source       text not null default 'manual' check (source in ('manual','sms','recurring')),
  recurring_id uuid references public.pf_recurring(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index on public.pf_transactions(user_id, tx_date);

create table public.pf_budgets (
  user_id       uuid not null,
  category_id   uuid not null references public.pf_categories(id) on delete cascade,
  monthly_limit numeric(14,2) not null check (monthly_limit > 0),
  primary key (user_id, category_id)
);

create table public.pf_goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  title       text not null check (length(trim(title)) between 1 and 60),
  target      numeric(14,2) not null check (target > 0),
  saved       numeric(14,2) not null default 0 check (saved >= 0),
  target_date date,
  created_at  timestamptz not null default now()
);

alter table public.pf_categories   enable row level security;
alter table public.pf_recurring    enable row level security;
alter table public.pf_transactions enable row level security;
alter table public.pf_budgets      enable row level security;
alter table public.pf_goals        enable row level security;
revoke all on public.pf_categories, public.pf_recurring, public.pf_transactions, public.pf_budgets, public.pf_goals
  from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function public._pf_uid() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'غير مصرح'; end if;
  return auth.uid();
end $$;

/** First use: give the user a sensible set of categories (family-fund flavoured). */
create or replace function public._pf_ensure(p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.pf_categories where user_id = p_uid) then return; end if;
  insert into public.pf_categories(user_id, kind, name, color, sort) values
    (p_uid,'expense','مصروف البيت','#1f5f4a',1),
    (p_uid,'expense','بقالة وتموين','#3f8a6e',2),
    (p_uid,'expense','مطاعم ومقاهي','#c9a227',3),
    (p_uid,'expense','مواصلات ووقود','#b5673f',4),
    (p_uid,'expense','فواتير واتصالات','#6f5aa0',5),
    (p_uid,'expense','سكن وإيجار','#2f4858',6),
    (p_uid,'expense','تعليم','#4f7cac',7),
    (p_uid,'expense','صحة','#c0504d',8),
    (p_uid,'expense','تسوق وملابس','#d08c60',9),
    (p_uid,'expense','مناسبات العائلة','#8e6c8a',10),
    (p_uid,'expense','سفر وترفيه','#5b9aa0',11),
    (p_uid,'expense','التزامات الصندوق','#a8842c',12),
    (p_uid,'expense','أخرى','#8a8f98',99),
    (p_uid,'income','الراتب','#1f5f4a',1),
    (p_uid,'income','دخل إضافي','#c9a227',2),
    (p_uid,'income','أخرى','#8a8f98',99);
end $$;

create or replace function public._pf_cat(p_uid uuid, p_cat uuid, p_kind text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.pf_categories where id = p_cat and user_id = p_uid and kind = p_kind
$$;

/** Post due recurring entries up to today (idempotent). */
create or replace function public._pf_run_recurring(p_uid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record; m date; t date := public.fund_today();
begin
  for r in select * from public.pf_recurring where user_id = p_uid and active loop
    m := coalesce((date_trunc('month', r.last_generated) + interval '1 month')::date, date_trunc('month', r.start_month)::date);
    while m <= date_trunc('month', t)::date loop
      exit when m = date_trunc('month', t)::date and r.day_of_month > extract(day from t);
      insert into public.pf_transactions(user_id, kind, amount, category_id, note, tx_date, source, recurring_id)
      values (p_uid, r.kind, r.amount, r.category_id, r.note, m + (r.day_of_month - 1), 'recurring', r.id);
      update public.pf_recurring set last_generated = m + (r.day_of_month - 1) where id = r.id;
      m := (m + interval '1 month')::date;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------- read
/** Everything the «ماليتي» page needs for one month. */
create or replace function public.pf_overview(p_month date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := public._pf_uid();
  v_m   uuid := public.current_member_id();
  m0 date := date_trunc('month', coalesce(p_month, public.fund_today()))::date;
  m1 date := (m0 + interval '1 month - 1 day')::date;
begin
  perform public._pf_ensure(v_uid);
  perform public._pf_run_recurring(v_uid);
  return jsonb_build_object(
    'month', m0,
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'name', name, 'color', color) order by kind, sort, name), '[]')
                     from public.pf_categories where user_id = v_uid),
    'income',  (select coalesce(sum(amount),0) from public.pf_transactions where user_id = v_uid and kind = 'income'  and tx_date between m0 and m1),
    'expense', (select coalesce(sum(amount),0) from public.pf_transactions where user_id = v_uid and kind = 'expense' and tx_date between m0 and m1),
    'by_category', (select coalesce(jsonb_agg(x order by (x->>'spent')::numeric desc), '[]') from (
        select jsonb_build_object('category_id', c.id, 'name', c.name, 'color', c.color,
                 'spent', coalesce(s.spent,0), 'budget', b.monthly_limit) x
          from public.pf_categories c
          left join (select category_id, sum(amount) spent from public.pf_transactions
                      where user_id = v_uid and kind = 'expense' and tx_date between m0 and m1 group by 1) s on s.category_id = c.id
          left join public.pf_budgets b on b.user_id = v_uid and b.category_id = c.id
         where c.user_id = v_uid and c.kind = 'expense' and (s.spent > 0 or b.monthly_limit is not null)
        union all
        select jsonb_build_object('category_id', null, 'name', 'بدون تصنيف', 'color', '#8a8f98', 'spent', sum(amount), 'budget', null)
          from public.pf_transactions where user_id = v_uid and kind = 'expense' and category_id is null and tx_date between m0 and m1
        having sum(amount) > 0) q),
    'transactions', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'amount', t.amount, 'category_id', t.category_id,
                        'category', c.name, 'color', c.color, 'note', t.note, 'date', t.tx_date, 'source', t.source) order by t.tx_date desc, t.created_at desc), '[]')
                       from public.pf_transactions t left join public.pf_categories c on c.id = t.category_id
                      where t.user_id = v_uid and t.tx_date between m0 and m1),
    'trend', (select coalesce(jsonb_agg(jsonb_build_object('month', g.m::date, 'income', coalesce(s.inc,0), 'expense', coalesce(s.exp,0)) order by g.m), '[]')
                from generate_series(m0 - interval '5 months', m0, interval '1 month') g(m)
                left join (select date_trunc('month', tx_date)::date mm, sum(amount) filter (where kind='income') inc, sum(amount) filter (where kind='expense') exp
                             from public.pf_transactions where user_id = v_uid and tx_date between (m0 - interval '5 months')::date and m1 group by 1) s on s.mm = g.m::date),
    'recurring', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'amount', r.amount, 'category_id', r.category_id, 'category', c.name,
                     'note', r.note, 'day', r.day_of_month, 'active', r.active) order by r.kind desc, r.day_of_month), '[]')
                    from public.pf_recurring r left join public.pf_categories c on c.id = r.category_id where r.user_id = v_uid),
    'goals', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'target', target, 'saved', saved, 'target_date', target_date) order by created_at), '[]')
                from public.pf_goals where user_id = v_uid),
    -- what this month owes the fund (read-only context from the member's own account)
    'fund_due', case when v_m is null then null else jsonb_build_object(
        'contribution', (select coalesce(sum(amount_outstanding),0) from public.v_contribution_status
                          where member_id = v_m and status not in ('paid','waived') and due_date <= m1),
        'installments', (select coalesce(sum(i.amount_remaining),0) from public.v_installment_status i join public.loans l on l.id = i.loan_id
                          where l.member_id = v_m and i.status <> 'paid' and i.due_date <= m1)) end
  );
end $$;

-- ---------------------------------------------------------------- write
create or replace function public.pf_add_tx(p_kind text, p_amount numeric, p_category uuid, p_date date, p_note text default null, p_source text default 'manual')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._pf_uid(); v uuid;
begin
  perform public._pf_ensure(v_uid);
  if p_kind not in ('income','expense') then raise exception 'نوع غير صالح'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  if p_date is null or p_date > public.fund_today() + 366 then raise exception 'تاريخ غير صالح'; end if;
  if (select count(*) from public.pf_transactions where user_id = v_uid) >= 20000 then raise exception 'وصلت للحد الأعلى من العمليات'; end if;
  insert into public.pf_transactions(user_id, kind, amount, category_id, note, tx_date, source)
  values (v_uid, p_kind, round(p_amount, 2), public._pf_cat(v_uid, p_category, p_kind), nullif(left(trim(p_note), 160), ''), p_date,
          case when p_source = 'sms' then 'sms' else 'manual' end)
  returning id into v;
  return v;
end $$;

create or replace function public.pf_update_tx(p_id uuid, p_amount numeric, p_category uuid, p_date date, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._pf_uid(); k text;
begin
  select kind into k from public.pf_transactions where id = p_id and user_id = v_uid;
  if k is null then raise exception 'العملية غير موجودة'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  update public.pf_transactions set amount = round(p_amount,2), category_id = public._pf_cat(v_uid, p_category, k),
         tx_date = coalesce(p_date, tx_date), note = nullif(left(trim(p_note), 160), '')
   where id = p_id and user_id = v_uid;
end $$;

create or replace function public.pf_delete_tx(p_id uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.pf_transactions where id = p_id and user_id = public._pf_uid()
$$;

create or replace function public.pf_set_budget(p_category uuid, p_limit numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._pf_uid();
begin
  if public._pf_cat(v_uid, p_category, 'expense') is null then raise exception 'تصنيف غير صالح'; end if;
  if coalesce(p_limit,0) <= 0 then
    delete from public.pf_budgets where user_id = v_uid and category_id = p_category;
  else
    insert into public.pf_budgets values (v_uid, p_category, round(p_limit,2))
    on conflict (user_id, category_id) do update set monthly_limit = excluded.monthly_limit;
  end if;
end $$;

create or replace function public.pf_add_category(p_kind text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._pf_uid(); v uuid;
  pal text[] := array['#1f5f4a','#c9a227','#b5673f','#6f5aa0','#4f7cac','#c0504d','#5b9aa0','#8e6c8a','#d08c60','#3f8a6e'];
begin
  perform public._pf_ensure(v_uid);
  if p_kind not in ('income','expense') then raise exception 'نوع غير صالح'; end if;
  if (select count(*) from public.pf_categories where user_id = v_uid) >= 60 then raise exception 'وصلت للحد الأعلى من التصنيفات'; end if;
  insert into public.pf_categories(user_id, kind, name, color, sort)
  values (v_uid, p_kind, trim(p_name), pal[1 + (select count(*) from public.pf_categories where user_id = v_uid)::int % 10], 50)
  on conflict (user_id, kind, name) do update set name = excluded.name
  returning id into v;
  return v;
end $$;

create or replace function public.pf_delete_category(p_id uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.pf_categories where id = p_id and user_id = public._pf_uid()
$$;

create or replace function public.pf_add_recurring(p_kind text, p_amount numeric, p_category uuid, p_day int, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._pf_uid(); v uuid; t date := public.fund_today();
begin
  perform public._pf_ensure(v_uid);
  if p_kind not in ('income','expense') then raise exception 'نوع غير صالح'; end if;
  if coalesce(p_amount,0) <= 0 then raise exception 'المبلغ يجب أن يكون أكبر من صفر'; end if;
  if p_day not between 1 and 28 then raise exception 'اليوم بين 1 و 28'; end if;
  if (select count(*) from public.pf_recurring where user_id = v_uid) >= 40 then raise exception 'وصلت للحد الأعلى'; end if;
  -- starts this month if the day hasn't passed yet, otherwise next month (no surprise back-posting)
  insert into public.pf_recurring(user_id, kind, amount, category_id, note, day_of_month, start_month)
  values (v_uid, p_kind, round(p_amount,2), public._pf_cat(v_uid, p_category, p_kind), nullif(left(trim(p_note),120), ''), p_day,
          case when p_day >= extract(day from t) then date_trunc('month', t)::date else (date_trunc('month', t) + interval '1 month')::date end)
  returning id into v;
  return v;
end $$;

create or replace function public.pf_set_recurring_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._pf_uid(); t date := public.fund_today();
begin
  -- resuming never back-fills the paused months
  update public.pf_recurring set active = p_active,
         last_generated = case when p_active and not active then
           case when day_of_month < extract(day from t) then date_trunc('month', t)::date + (day_of_month - 1)
                else (date_trunc('month', t) - interval '1 month')::date + (day_of_month - 1) end
           else last_generated end
   where id = p_id and user_id = v_uid;
end $$;

create or replace function public.pf_delete_recurring(p_id uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.pf_recurring where id = p_id and user_id = public._pf_uid()
$$;

create or replace function public.pf_add_goal(p_title text, p_target numeric, p_date date default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := public._pf_uid(); v uuid;
begin
  if coalesce(p_target,0) <= 0 then raise exception 'المبلغ المستهدف يجب أن يكون أكبر من صفر'; end if;
  if (select count(*) from public.pf_goals where user_id = v_uid) >= 20 then raise exception 'وصلت للحد الأعلى من الأهداف'; end if;
  insert into public.pf_goals(user_id, title, target, target_date) values (v_uid, trim(p_title), round(p_target,2), p_date) returning id into v;
  return v;
end $$;

create or replace function public.pf_goal_save(p_id uuid, p_amount numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.pf_goals set saved = greatest(0, saved + round(coalesce(p_amount,0),2))
   where id = p_id and user_id = public._pf_uid();
end $$;

create or replace function public.pf_delete_goal(p_id uuid) returns void
language sql security definer set search_path = public as $$
  delete from public.pf_goals where id = p_id and user_id = public._pf_uid()
$$;

revoke execute on function public._pf_uid(), public._pf_ensure(uuid), public._pf_cat(uuid,uuid,text), public._pf_run_recurring(uuid)
  from public, anon, authenticated;
revoke execute on function public.pf_overview(date), public.pf_add_tx(text,numeric,uuid,date,text,text), public.pf_update_tx(uuid,numeric,uuid,date,text),
  public.pf_delete_tx(uuid), public.pf_set_budget(uuid,numeric), public.pf_add_category(text,text), public.pf_delete_category(uuid),
  public.pf_add_recurring(text,numeric,uuid,int,text), public.pf_set_recurring_active(uuid,boolean), public.pf_delete_recurring(uuid),
  public.pf_add_goal(text,numeric,date), public.pf_goal_save(uuid,numeric), public.pf_delete_goal(uuid) from public, anon;
grant execute on function public.pf_overview(date), public.pf_add_tx(text,numeric,uuid,date,text,text), public.pf_update_tx(uuid,numeric,uuid,date,text),
  public.pf_delete_tx(uuid), public.pf_set_budget(uuid,numeric), public.pf_add_category(text,text), public.pf_delete_category(uuid),
  public.pf_add_recurring(text,numeric,uuid,int,text), public.pf_set_recurring_active(uuid,boolean), public.pf_delete_recurring(uuid),
  public.pf_add_goal(text,numeric,date), public.pf_goal_save(uuid,numeric), public.pf_delete_goal(uuid) to authenticated;

-- ---------------------------------------------------------------- AI chats are private to their owner
drop policy if exists owner_read on public.ai_messages;
create policy owner_read on public.ai_messages for select to authenticated using (user_id = (select auth.uid()));
