'use client';
import { supabase } from './supabase';
import { q, useData } from './hooks';

export type Settings = {
  fund_name: string; logo_url: string | null; currency: string; monthly_contribution: string; contribution_due_day: number;
  contribution_start_period: string; contribution_treatment: string; loan_max_amount: string; loan_max_months: number;
  loan_default_fee_pct: string; loan_one_active_per_member: boolean; loan_block_if_overdue: boolean; loan_grace_days: number;
  loan_auto_approve?: boolean; loan_reserve_pct?: string; loan_min_cash?: string; ai_members_enabled?: boolean; backup_email?: string | null; backup_enabled?: boolean;
  withdrawal_notice_days: number; withdrawal_min_amount: string; allow_negative_cash: boolean; approval_requirements: any;
  investment_categories: { key: string; label: string }[]; expense_categories: string[]; income_categories?: string[]; fiscal_year_start_month: number;
  notification_prefs: any; profit_allocation_policy: any; demo_mode: boolean; updated_at: string; welcome_phrases: string[]; monthly_report_auto: boolean; monthly_report_note: string | null; monthly_report_email: boolean; member_investments_view: 'hidden' | 'names' | 'full';
};

export function useSettings() {
  return useData<Settings>(() => q(supabase().from('fund_settings').select('*').eq('id', 1).single()));
}

export function categoryLabel(s: Settings | null, key: string) {
  return s?.investment_categories?.find(c => c.key === key)?.label ?? key;
}

export function useActiveMembers() {
  return useData<{ id: string; full_name: string; member_no: string }[]>(() =>
    q(supabase().from('members').select('id, full_name, member_no').eq('status', 'active').order('member_no')));
}
