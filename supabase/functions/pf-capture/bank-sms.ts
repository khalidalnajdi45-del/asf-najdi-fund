/** Reads Saudi bank SMS alerts (الراجحي، الأهلي، الإنماء، الرياض، البلاد، STC Bank…) pasted by the user.
 *  Runs entirely on the device — the message text is never sent anywhere. */
export type ParsedSms = { kind: 'income' | 'expense'; amount: number; date: string | null; merchant: string | null; guess: string | null; raw: string };

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const norm = (s: string) => s.replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d))).replace(/٫/g, '.').replace(/٬/g, ',').replace(/[\u200e\u200f\u061c]/g, '');
const money = (v: string) => Number(v.replace(/,/g, ''));

const AMOUNT = [
  /(?:مبلغ|المبلغ|بمبلغ|Amount|Amt)\s*[:：]?\s*(?:SAR|SR|ر\.?\s?س\.?|ريال)?\s*([\d,]+(?:\.\d{1,2})?)/i,
  /(?:SAR|SR|ر\.?\s?س\.?)\s*([\d,]+(?:\.\d{1,2})?)/i,
  /([\d,]+(?:\.\d{1,2})?)\s*(?:SAR|SR|ر\.?\s?س\.?|ريال|رس)\b/i,
  /([\d,]+(?:\.\d{1,2})?)\s*(?:SAR|SR|ريال)/i,
];
const INCOME = /(وارد|واردة|إيداع|ايداع|راتب|رواتب|استلام|استرداد|مسترد|إرجاع|ارجاع|credited|credit\b|deposit|received|incoming|salary|refund)/i;
const EXPENSE = /(شراء|مدفوعات|سداد|خصم|صادر|صادرة|سحب|POS|purchase|debit|paid|payment|withdraw|online|مدى|apple ?pay)/i;
const MERCHANT = /(?:لدى|عند|في\s*متجر|من\s*متجر|التاجر|المتجر|At|Merchant|from|To)\s*[:：]?\s*([^\n\r]{2,40})/i;
const DATE = [/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/, /(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/];

const RULES: [RegExp, string][] = [
  [/(starbucks|ستاربكس|كافيه|cafe|coffee|قهوة|مطعم|restaurant|mcdonald|ماكدونالدز|kfc|البيك|albaik|hunger|هنقر|jahez|جاهز|مرسول|marsool|toyou|كيتا|keeta|شاورما|burger|بيتزا|pizza|dunkin|tim hortons|barns|بارنز|kudu|كودو)/i, 'مطاعم ومقاهي'],
  [/(panda|بنده|هايبر|othaim|العثيم|danube|الدانوب|tamimi|التميمي|lulu|لولو|carrefour|كارفور|nesto|نستو|farm|المزرعة|بقالة|تموينات|nana|نعناع|ninja|نينجا|سوبرماركت|supermarket)/i, 'بقالة وتموين'],
  [/(aldrees|الدريس|sasco|ساسكو|petromin|بترومين|naft|نفط|محطة|petrol|fuel|وقود|بنزين|uber|اوبر|careem|كريم|parking|مواقف|سلامة|saher|ساهر)/i, 'مواصلات ووقود'],
  [/(stc|mobily|موبايلي|zain|زين|كهرباء|electric|مياه|water|internet|انترنت|فاتورة|سداد\s*فواتير|bill)/i, 'فواتير واتصالات'],
  [/(nahdi|النهدي|al-dawaa|الدواء|صيدلية|pharmacy|مستشفى|hospital|clinic|عيادة|مجمع طبي|dental)/i, 'صحة'],
  [/(noon|نون|amazon|امازون|jarir|جرير|extra|اكسترا|ikea|ايكيا|centrepoint|سنتربوينت|shein|شي ان|namshi|نمشي|zara|h&m|mall|مول)/i, 'تسوق وملابس'],
  [/(مدارس|مدرسة|school|جامعة|university|رسوم دراسية|tuition|academy|أكاديمية|دورة|course)/i, 'تعليم'],
  [/(إيجار|ايجار|rent|ejar|إيجار|عقار)/i, 'سكن وإيجار'],
  [/(flynas|ناس|flyadeal|طيران|saudia|السعودية للطيران|booking|airbnb|فندق|hotel|cinema|سينما|muvi|vox)/i, 'سفر وترفيه'],
  [/(راتب|رواتب|salary|payroll)/i, 'الراتب'],
];

function parseDate(t: string): string | null {
  let m = t.match(DATE[0]);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = t.match(DATE[1]);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return iso(y, +m[2], +m[1]); }
  return null;
}
function iso(y: number, mo: number, d: number) {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null; // ignore Hijri dates (14xx)
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseSms(raw: string): ParsedSms | null {
  const t = norm(raw);
  // strip card / account numbers so they're never mistaken for the amount
  const clean = t.replace(/(?:بطاقة|البطاقة|card|حساب|الحساب|account|acc)\s*[:：]?\s*[*xX#\d\s-]{2,}/gi, ' ');
  let amount = 0;
  for (const re of AMOUNT) { const m = clean.match(re); if (m) { amount = money(m[1]); if (amount > 0) break; } }
  if (!(amount > 0)) return null;
  const kind: 'income' | 'expense' = INCOME.test(t) && !/(شراء|purchase|POS)/i.test(t) ? 'income' : EXPENSE.test(t) || !INCOME.test(t) ? 'expense' : 'income';
  let merchant = t.match(MERCHANT)?.[1]?.replace(/\s*(?:في|on|بتاريخ|date|مبلغ|SAR).*$/i, '').trim() || null;
  if (merchant && /^[\d\s:/.-]+$/.test(merchant)) merchant = null;
  const guess = RULES.find(([re]) => re.test(t))?.[1] ?? null;
  return { kind, amount: Math.round(amount * 100) / 100, date: parseDate(t), merchant, guess: kind === 'income' && guess !== 'الراتب' ? null : guess, raw: raw.trim() };
}

/** Several messages pasted at once: split on blank lines (or repeated headers). */
export function parseMany(text: string): ParsedSms[] {
  return text.split(/\n\s*\n+/).map(x => x.trim()).filter(Boolean).map(parseSms).filter((x): x is ParsedSms => !!x);
}
