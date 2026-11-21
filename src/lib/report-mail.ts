'use client';
import { IS_DEMO, supabase } from './supabase';

export type MailResult = { total?: number; sent?: number; failed?: number; no_email?: number; skipped?: string; demo?: boolean };

/** Asks the send-report-emails Edge Function to e-mail reports. The demo has no mail server, so it only simulates. */
export async function sendReportEmails(body: { backup?: boolean; period?: string; ids?: string[]; resend?: boolean; message_id?: string; retry?: boolean; credentials?: { member_id: string; username: string; password: string } }): Promise<MailResult & { to?: string }> {
  if (IS_DEMO) { await new Promise(r => setTimeout(r, 700)); return { demo: true }; }
  const { data, error } = await (supabase() as any).functions.invoke('send-report-emails', { body });
  if (error) {
    let msg = error.message as string;
    try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* keep message */ }
    throw new Error(msg);
  }
  return data as MailResult;
}

export function mailSummary(r: MailResult) {
  if (r.demo) return 'النسخة التجريبية لا ترسل بريداً فعلياً — اطّلع على «معاينة البريد» لترى ما سيصل الأعضاء';
  if (r.skipped) return r.skipped;
  const parts = [`أُرسل ${r.sent ?? 0} بريد`];
  if (r.failed) parts.push(`تعذر ${r.failed}`);
  if (r.no_email) parts.push(`${r.no_email} بلا بريد`);
  if (!r.total) return 'لا توجد تقارير بانتظار الإرسال بالبريد لهذا الشهر';
  return parts.join(' · ');
}

/** Delivers a message created with create_member_message to its pending recipients. */
export async function sendMemberMessage(messageId: string, retry = false): Promise<MailResult> {
  return sendReportEmails({ message_id: messageId, retry });
}

/** E-mails a member their username + temporary password (to their personal e-mail). */
export async function sendCredentials(member_id: string, username: string, password: string) {
  return sendReportEmails({ credentials: { member_id, username, password } });
}
