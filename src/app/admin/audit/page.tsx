'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { q, useData } from '@/lib/hooks';
import { dateTime } from '@/lib/format';
import { auditActionLabels, entityLabels } from '@/lib/labels';
import { exportXlsx } from '@/lib/export';
import { Button, Card, DataTable, Field, Input, Modal, PageHeader, Select, Tag } from '@/components/ui';

const IGNORE = new Set(['updated_at', 'created_at']);

export default function AuditPage() {
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [view, setView] = useState<any>(null);
  const sb = supabase();
  const users = useData<any[]>(() => q(sb.from('app_users').select('id, full_name')));
  const d = useData<any[]>(() => {
    let x = sb.from('audit_logs').select('*').order('id', { ascending: false }).limit(1000);
    if (entity) x = x.eq('entity', entity);
    if (from) x = x.gte('occurred_at', from);
    return q(x);
  }, [entity, from]);
  const um = new Map((users.data ?? []).map(u => [u.id, u.full_name]));
  const actor = (id: string | null) => (id ? um.get(id) ?? id.slice(0, 8) : 'النظام');

  const exportLog = () => exportXlsx('سجل-التدقيق', [{
    name: 'السجل', header: ['#', 'الوقت', 'المستخدم', 'الإجراء', 'الكيان', 'المعرف', 'ملاحظة'],
    rows: (d.data ?? []).map(l => [l.id, l.occurred_at, actor(l.actor_id), auditActionLabels[l.action] ?? l.action, entityLabels[l.entity] ?? l.entity, l.entity_id, l.note]),
  }]);

  return (
    <>
      <PageHeader title="سجل التدقيق" subtitle="سجل غير قابل للتعديل أو الحذف لكل تغيير على البيانات المالية والإعدادات"
        actions={<Button variant="secondary" icon={<Download className="size-4" />} onClick={exportLog}>Excel</Button>} />
      <div className="mb-4 flex flex-wrap gap-3">
        <Field label="الكيان"><Select value={entity} onChange={e => setEntity(e.target.value)} placeholder="الكل" options={Object.entries(entityLabels).map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="منذ"><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
      </div>
      <Card pad={false}>
        <DataTable rows={d.data} loading={d.loading} pageSize={50} onRowClick={setView} searchable={r => `${r.entity} ${r.entity_id ?? ''} ${r.note ?? ''} ${actor(r.actor_id)}`}
          columns={[
            { key: 'id', header: '#', render: r => <span className="num text-xs text-muted">{r.id}</span> },
            { key: 'occurred_at', header: 'الوقت', render: r => dateTime(r.occurred_at) },
            { key: 'actor', header: 'المستخدم', render: r => actor(r.actor_id) },
            { key: 'action', header: 'الإجراء', render: r => <Tag tone={r.action === 'policy_change' ? 'amber' : r.action === 'insert' ? 'green' : r.action === 'update' ? 'blue' : 'neutral'}>{auditActionLabels[r.action] ?? r.action}</Tag> },
            { key: 'entity', header: 'الكيان', render: r => entityLabels[r.entity] ?? r.entity },
            { key: 'summary', header: 'التغيير', className: 'max-w-[360px] truncate text-xs text-muted', render: r => summarize(r) },
          ]} />
      </Card>
      <Modal wide open={!!view} onClose={() => setView(null)} title={`سجل #${view?.id ?? ''}`}>
        {view && <>
          <p className="text-sm text-muted">{dateTime(view.occurred_at)} — {actor(view.actor_id)} — {entityLabels[view.entity] ?? view.entity}</p>
          {view.note && <p className="text-sm">{view.note}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div><div className="mb-1 text-xs text-muted">قبل</div><pre dir="ltr" className="max-h-80 overflow-auto rounded-lg bg-canvas p-3 text-[11px]">{JSON.stringify(view.old_data, null, 2) ?? '—'}</pre></div>
            <div><div className="mb-1 text-xs text-muted">بعد</div><pre dir="ltr" className="max-h-80 overflow-auto rounded-lg bg-canvas p-3 text-[11px]">{JSON.stringify(view.new_data, null, 2) ?? '—'}</pre></div>
          </div>
        </>}
      </Modal>
    </>
  );
}

function summarize(r: any) {
  if (r.action === 'update' && r.old_data && r.new_data) {
    const ch = Object.keys(r.new_data).filter(k => !IGNORE.has(k) && JSON.stringify(r.old_data[k]) !== JSON.stringify(r.new_data[k]));
    return ch.map(k => `${k}: ${fmt(r.old_data[k])} ← ${fmt(r.new_data[k])}`).join(' · ') || '—';
  }
  const x = r.new_data ?? r.old_data;
  if (!x) return r.note ?? '—';
  return [x.tx_no, x.description, x.full_name, x.name, x.amount && `${x.amount}`, x.status].filter(Boolean).join(' · ') || r.note || '—';
}
const fmt = (v: any) => (v === null || v === undefined ? '∅' : typeof v === 'object' ? '{…}' : String(v));
