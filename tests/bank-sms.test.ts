import { describe, it, expect } from 'vitest';
import { parseSms, parseMany } from '../src/lib/bank-sms';

describe('bank SMS parser', () => {
  it('reads a mada POS purchase', () => {
    const p = parseSms('شراء عبر نقاط البيع\nبطاقة: 4567 ;مدى\nمبلغ: SAR 45.50\nلدى: STARBUCKS RIYADH\nفي: 2026-11-18 14:22')!;
    expect(p).toMatchObject({ kind: 'expense', amount: 45.5, date: '2026-11-18', guess: 'مطاعم ومقاهي' });
    expect(p.merchant).toMatch(/STARBUCKS/);
  });
  it('reads English purchase with comma thousands', () => {
    const p = parseSms('Purchase\nCard: **1234\nAmount: SAR 1,250.00\nAt: PANDA HYPER\nDate: 20/11/26')!;
    expect(p).toMatchObject({ kind: 'expense', amount: 1250, date: '2026-11-20', guess: 'بقالة وتموين' });
  });
  it('reads incoming salary with Arabic digits', () => {
    const p = parseSms('حوالة واردة - راتب\nحساب: ٠١٢٣*\nمبلغ: ١٢٬٠٠٠٫٠٠ ريال')!;
    expect(p).toMatchObject({ kind: 'income', amount: 12000, guess: 'الراتب' });
  });
  it('splits multiple messages and skips junk', () => {
    expect(parseMany('شراء\nمبلغ: 20 SAR\nلدى: ALDREES\n\nرمز التحقق 4455\n\nسداد فاتورة STC\nبمبلغ 230 ر.س')).toHaveLength(2);
  });
});

describe('bank SMS parser — OTP', () => {
  it('ignores one-time codes that quote an amount', () => {
    expect(parseSms('رمز التحقق 4321 لعملية شراء بمبلغ 45.50 SAR لدى STARBUCKS. لا تشارك الرمز')).toBeNull();
    expect(parseSms('Your OTP for purchase of SAR 120.00 at NOON is 998877')).toBeNull();
  });
});
