export type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'violet';

export const statusLabels: Record<string, [string, Tone]> = {
  // contributions
  paid: ['مسدد', 'green'], partial: ['مسدد جزئياً', 'amber'], unpaid: ['غير مسدد', 'neutral'], overdue: ['متأخر', 'red'], waived: ['معفى', 'neutral'],
  // loans
  pending: ['قيد المراجعة', 'amber'], approved: ['معتمد', 'blue'], rejected: ['مرفوض', 'red'], disbursed: ['قائم', 'violet'],
  active: ['نشط', 'green'], fully_repaid: ['مسدد بالكامل', 'neutral'], cancelled: ['ملغي', 'neutral'],
  // installments
  upcoming: ['قادم', 'neutral'],
  // deposits
  requested: ['بانتظار التأكيد', 'amber'], confirmed: ['مؤكد', 'green'],
  // members / investments
  inactive: ['غير نشط', 'neutral'], matured: ['مستحق', 'blue'], exited: ['تم التخارج', 'neutral'],
};

export const txTypeLabels: Record<string, string> = {
  contribution_payment: 'اشتراك شهري', deposit: 'إيداع اختياري', withdrawal_payment: 'صرف سحب وديعة',
  loan_disbursement: 'صرف قرض', loan_repayment: 'سداد قرض', investment_capital: 'ضخ رأس مال استثمار',
  investment_income: 'عائد استثمار', investment_revaluation: 'إعادة تقييم استثمار', investment_exit: 'تخارج من استثمار',
  expense: 'مصروف', other_income: 'إيراد آخر', profit_distribution: 'توزيع أرباح', manual_journal: 'قيد يدوي', reversal: 'قيد عكسي',
};

export const frequencyLabels: Record<string, string> = { monthly: 'شهري', quarterly: 'ربع سنوي' };

export const accountTypeLabels: Record<string, string> = {
  asset: 'أصول', liability: 'التزامات', equity: 'حقوق ملكية', income: 'إيرادات', expense: 'مصروفات',
};

export const auditActionLabels: Record<string, string> = {
  insert: 'إضافة', update: 'تعديل', delete: 'حذف', policy_change: 'تعديل سياسة', reset_password: 'إعادة تعيين كلمة مرور',
  announcement: 'إعلان',
};

export const entityLabels: Record<string, string> = {
  app_users: 'المستخدمون', members: 'الأعضاء', fund_settings: 'الإعدادات', financial_transactions: 'العمليات المالية',
  contribution_payments: 'مدفوعات الاشتراكات', member_deposits: 'الودائع', deposit_withdrawals: 'السحوبات', loans: 'القروض',
  loan_repayments: 'سدادات القروض', investments: 'الاستثمارات', investment_transactions: 'عمليات الاستثمار',
  expenses: 'المصروفات', incomes: 'الإيرادات', documents: 'المستندات', accounts: 'الحسابات', notifications: 'الإشعارات',
};

/** Loans: "disbursed" (nothing repaid yet) and "active" (repaying) are shown the same — قائم. */
export const loanStatus = (s?: string | null) => (s === 'active' ? 'disbursed' : s);
