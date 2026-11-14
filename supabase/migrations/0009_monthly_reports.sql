-- =====================================================================
-- Monthly account reports: a frozen snapshot per member per month,
-- issued by the manager (or automatically on the 1st) and delivered in-app.
-- =====================================================================

alter table public.fund_settings add column if not exists monthly_report_auto boolean not null default true;
alter table public.fund_settings add column if not exists monthly_report_note text;

create table public.monthly_reports (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id),
  period      date not null check (period = date_trunc('month', period)::date),
  report      jsonb not null,
  note        text check (length(note) <= 600),
  created_at  timestamptz not null default now(),
  created_by  uuid,
  read_at     timestamptz,
  unique (member_id, period)
);
create index on public.monthly_reports(period);

create or replace function public._month_ar(p date) returns text
language sql immutable set search_path = public as $$
  select (array['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'])[extract(month from p)::int]
         || ' ' || extract(year from p)::int
$$;

/** Builds the snapshot for one member and one month. Figures are as of the end of that month
    (balances) or within it (activity); arrears and loan schedule reflect the moment of issue. */
create or replace function public._build_member_report(p_member uuid, p_period date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from date := date_trunc('month', p_period)::date;
        v_to date := (date_trunc('month', p_period) + interval '1 month - 1 day')::date;
        v_dep_open numeric; v_dep_in numeric; v_dep_out numeric; v_contrib_total numeric; v_contrib_month numeric;
        v_loan_out numeric; v_loan_paid numeric;
begin
  select coalesce(sum(case when tx_type = 'deposit' then amount else -amount end) filter (where tx_date < v_from), 0),
         coalesce(sum(amount) filter (where tx_type = 'deposit' and tx_date between v_from and v_to), 0),
         coalesce(sum(amount) filter (where tx_type = 'withdrawal_payment' and tx_date between v_from and v_to), 0)
    into v_dep_open, v_dep_in, v_dep_out
    from public.v_active_tx where member_id = p_member and tx_type in ('deposit','withdrawal_payment');

  select coalesce(sum(cp.amount) filter (where cp.paid_on <= v_to), 0),
         coalesce(sum(cp.amount) filter (where cp.paid_on between v_from and v_to), 0)
    into v_contrib_total, v_contrib_month
    from public.contribution_payments cp join public.v_active_tx t on t.id = cp.financial_transaction_id
   where cp.member_id = p_member;

  select coalesce(sum(amount) filter (where tx_type = 'loan_repayment' and tx_date between v_from and v_to), 0)
    into v_loan_paid from public.v_active_tx where member_id = p_member;
  select coalesce(sum(outstanding), 0) into v_loan_out from public.v_loan_summary
   where member_id = p_member and status in ('disbursed','active','overdue');

  return jsonb_build_object(
    'period', v_from, 'period_label', public._month_ar(v_from), 'from', v_from, 'to', v_to, 'generated_at', now(),
    'fund_name', (public.settings()).fund_name,
    'member', (select jsonb_build_object('id', id, 'full_name', full_name, 'member_no', member_no, 'join_date', join_date) from public.members where id = p_member),
    'contribution', jsonb_build_object(
       'month', (select jsonb_build_object('due', amount_due, 'paid', amount_paid, 'outstanding', amount_outstanding, 'status', status, 'due_date', due_date)
                   from public.v_contribution_status where member_id = p_member and period = v_from),
       'paid_in_month', v_contrib_month,
       'total_paid', v_contrib_total,
       'arrears_amount', (select coalesce(sum(amount_outstanding), 0) from public.v_contribution_status where member_id = p_member and period <= v_from and is_overdue),
       'arrears_months', (select count(*) from public.v_contribution_status where member_id = p_member and period <= v_from and is_overdue),
       'year', (select coalesce(jsonb_agg(jsonb_build_object('period', period, 'status', status) order by period), '[]')
                  from public.v_contribution_status where member_id = p_member
                   and period between date_trunc('year', v_from)::date and v_from)),
    'deposits', jsonb_build_object('opening', v_dep_open, 'in', v_dep_in, 'out', v_dep_out, 'closing', v_dep_open + v_dep_in - v_dep_out),
    'loans', jsonb_build_object(
       'outstanding', v_loan_out, 'paid_in_month', v_loan_paid,
       'items', (select coalesce(jsonb_agg(jsonb_build_object('loan_no', l.loan_no, 'status', l.status, 'approved', l.approved_amount,
                   'repaid', l.amount_repaid, 'outstanding', l.outstanding,
                   'next_due_date', n.due_date, 'next_amount', n.amount_remaining,
                   'overdue_amount', (select coalesce(sum(amount_remaining),0) from public.v_installment_status where loan_id = l.id and status = 'overdue'))
                   order by l.loan_no), '[]')
                  from public.v_loan_summary l
                  left join lateral (select due_date, amount_remaining from public.v_installment_status
                                      where loan_id = l.id and status <> 'paid' order by seq limit 1) n on true
                 where l.member_id = p_member and l.status in ('disbursed','active','overdue'))),
    'activity', (select coalesce(jsonb_agg(jsonb_build_object('date', tx_date, 'type', tx_type, 'description', description, 'amount', amount)
                   order by tx_date, tx_no), '[]')
                   from public.v_active_tx where member_id = p_member and tx_date between v_from and v_to),
    'net_position', v_contrib_total + (v_dep_open + v_dep_in - v_dep_out) - v_loan_out,
    'fund', jsonb_build_object(
       'active_members', (select count(*) from public.members where status = 'active'),
       'collection_rate', (select case when sum(amount_due) > 0 then round(sum(amount_paid) / sum(amount_due), 4) else 0 end
                             from public.v_contribution_status where period = v_from))
  );
end $$;

create or replace function public._issue_monthly_reports(p_period date, p_note text, p_notify boolean) returns int
language plpgsql security definer set search_path = public as $$
declare v_p date := date_trunc('month', p_period)::date; r record; v_id uuid; n int := 0;
begin
  if v_p > date_trunc('month', public.fund_today())::date then raise exception 'لا يمكن إصدار تقرير لشهر لم يبدأ'; end if;
  for r in select m.id, m.user_id from public.members m
            where m.status = 'active' and m.join_date <= (v_p + interval '1 month - 1 day')::date loop
    insert into public.monthly_reports(member_id, period, report, note, created_by)
    values (r.id, v_p, public._build_member_report(r.id, v_p), nullif(trim(p_note), ''), auth.uid())
    on conflict (member_id, period) do update
      set report = excluded.report, note = excluded.note, created_at = now(), created_by = excluded.created_by
    returning id into v_id;
    if p_notify and r.user_id is not null then
      perform public._notify(r.user_id, 'monthly_report', 'تقرير حسابك لشهر ' || public._month_ar(v_p),
        'ملخص اشتراكاتك وودائعك وقروضك للشهر — اضغط للاطلاع', '/member/reports?id=' || v_id, 'report-' || v_id);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.issue_monthly_reports(p_period date default null, p_note text default null, p_notify boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare n int; v_p date := coalesce(p_period, (date_trunc('month', public.fund_today()) - interval '1 month')::date);
begin
  perform public.assert_manager();
  n := public._issue_monthly_reports(v_p, p_note, p_notify);
  perform public._log('create', 'monthly_reports', to_char(v_p, 'YYYY-MM'), jsonb_build_object('count', n, 'notify', p_notify), null,
                      'إصدار التقارير الشهرية لشهر ' || public._month_ar(v_p));
  return n;
end $$;

/** Called by pg_cron on the 1st: issues last month's reports once, if auto-issue is on. */
create or replace function public.auto_monthly_reports() returns int
language plpgsql security definer set search_path = public as $$
declare s public.fund_settings := public.settings(); v_p date := (date_trunc('month', public.fund_today()) - interval '1 month')::date;
begin
  if auth.uid() is not null then perform public.assert_manager(); end if;
  if not s.monthly_report_auto then return 0; end if;
  if exists (select 1 from public.monthly_reports where period = v_p) then return 0; end if;
  return public._issue_monthly_reports(v_p, s.monthly_report_note, true);
end $$;

create or replace function public.set_monthly_report_prefs(p_auto boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare o public.fund_settings := public.settings();
begin
  perform public.assert_manager();
  update public.fund_settings set monthly_report_auto = p_auto, monthly_report_note = nullif(trim(p_note), ''), updated_at = now(), updated_by = auth.uid() where id = 1;
  perform public._log('update', 'fund_settings', '1', jsonb_build_object('monthly_report_auto', p_auto, 'monthly_report_note', p_note),
                      jsonb_build_object('monthly_report_auto', o.monthly_report_auto, 'monthly_report_note', o.monthly_report_note), 'إعدادات التقارير الشهرية');
end $$;

create or replace function public.mark_report_read(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.monthly_reports set read_at = coalesce(read_at, now())
   where id = p_id and member_id = public.current_member_id();
end $$;

-- security
alter table public.monthly_reports enable row level security;
revoke all on public.monthly_reports from public, anon, authenticated;
grant select on public.monthly_reports to authenticated;
create policy own_or_manager on public.monthly_reports for select to authenticated
  using (member_id = (select public.current_member_id()) or (select public.is_manager()));

revoke execute on function public._month_ar(date), public._build_member_report(uuid,date), public._issue_monthly_reports(date,text,boolean),
  public.issue_monthly_reports(date,text,boolean), public.auto_monthly_reports(), public.set_monthly_report_prefs(boolean,text),
  public.mark_report_read(uuid) from public, anon, authenticated;
grant execute on function public.issue_monthly_reports(date,text,boolean), public.set_monthly_report_prefs(boolean,text),
  public.mark_report_read(uuid) to authenticated;
