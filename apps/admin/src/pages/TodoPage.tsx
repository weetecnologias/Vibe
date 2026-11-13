import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge, Loading, Notice, PageHead, showDateTime, useAsync, useAuth, type TodoList, type TodoType } from '@kit';

import { useWorkspace } from '../workspace';

const LABEL: Record<TodoType, string> = {
  application: 'New businesses', kyc: 'KYC and bank', offer: 'Offers', promotion: 'Promotions', event: 'Events', dispute: 'Disputes', refund: 'Refunds', deletion: 'Account deletions',
};

function age(iso: string | null): string {
  if (!iso) return '';
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h} h waiting`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? '' : 's'} waiting`;
}

/** Everything waiting for someone at VIBE in the category being looked at, oldest first: one list instead of a page per kind of approval. */
export function TodoPage() {
  const { client } = useAuth();
  const { current } = useWorkspace();
  const list = useAsync(() => client.get<TodoList>('/v1/admin/todo'), [client]);
  const [type, setType] = useState<TodoType | ''>('');
  const items = (list.data?.items ?? []).filter((i) => !type || i.type === type);
  const counts = list.data?.counts ?? {};

  return (
    <>
      <PageHead title="To do" sub={`What is waiting for a decision${current.id ? ` in ${current.name}` : ' across VIBE'}, oldest first. Open an item to act on it.`} actions={<button className="btn" onClick={list.reload}>Refresh</button>} />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={type === ''} className={`tab${type === '' ? ' on' : ''}`} onClick={() => setType('')}>Everything · {list.data?.items.length ?? 0}</button>
        {(Object.keys(LABEL) as TodoType[]).filter((k) => counts[k]).map((k) => (
          <button key={k} role="tab" aria-selected={type === k} className={`tab${type === k ? ' on' : ''}`} onClick={() => setType(k)}>{LABEL[k]} · {counts[k]}</button>
        ))}
      </div>
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="card" style={{ padding: 0 }}>
          {items.map((i) => (
            <div key={`${i.type}-${i.id}`} className="todo-row">
              <div className="stack" style={{ gap: 2 }}>
                <div className="row" style={{ gap: 8 }}><Badge tone={i.type === 'dispute' || i.type === 'refund' ? 'pink' : 'warning'}>{LABEL[i.type]}</Badge><strong>{i.title}</strong></div>
                <span className="small">{i.detail}</span>
                <span className="muted small">{i.category}{i.since ? ` · ${showDateTime(i.since)} · ${age(i.since)}` : ''}</span>
              </div>
              <Link className="btn sm primary" to={i.link}>Open</Link>
            </div>
          ))}
          {items.length === 0 ? <p className="muted" style={{ padding: 16, margin: 0 }}>Nothing waiting. Every approval, check and refund is done.</p> : null}
        </div>
      )}
    </>
  );
}
