import { useState } from 'react';

import { Badge, DownloadButton, Loading, Notice, PageHead, formatINR, showDateTime, useAsync, useAuth, type MemberPage } from '@kit';

const PAGE = 25;
const TABS: { key: string; label: string }[] = [{ key: 'active', label: 'Active' }, { key: 'cancelled', label: 'Cancelled' }, { key: 'expired', label: 'Expired' }, { key: '', label: 'All' }];
const TONE: Record<string, 'success' | 'warning' | 'muted'> = { active: 'success', cancelled: 'warning', expired: 'muted' };

export function MembersPage() {
  const { client } = useAuth();
  const [status, setStatus] = useState('active');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useAsync(() => client.get<MemberPage>(`/v1/admin/members?limit=${PAGE}&offset=${offset}${status ? `&status=${status}` : ''}${term ? `&q=${encodeURIComponent(term)}` : ''}`), [client, status, term, offset]);
  const total = list.data?.total ?? 0;

  return (
    <>
      <PageHead title="Members" sub="Everyone who has bought, or been given, a VIBE membership. Open the customer to see their payments or to give time."
        actions={<DownloadButton path={`/v1/admin/exports/members?x=1${status ? `&status=${status}` : ''}${term ? `&q=${encodeURIComponent(term)}` : ''}`} filename="vibe-members.csv" />} />
      <div className="tabs" role="tablist">
        {TABS.map((t) => <button key={t.label} role="tab" aria-selected={status === t.key} className={`tab${status === t.key ? ' on' : ''}`} onClick={() => { setStatus(t.key); setOffset(0); }}>{t.label}</button>)}
      </div>
      <form className="row" style={{ marginBottom: 14 }} onSubmit={(e) => { e.preventDefault(); setOffset(0); setTerm(q.trim()); }}>
        <input style={{ maxWidth: 320 }} placeholder="Name, VIBE ID or phone digits" aria-label="Search members" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn">Search</button>
        {term ? <button type="button" className="btn ghost" onClick={() => { setQ(''); setTerm(''); setOffset(0); }}>Clear</button> : null}
      </form>
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Member</th><th>Plan</th><th>Status</th><th>Joined</th><th>Runs until</th><th>Paid</th><th>Saved</th></tr></thead>
              <tbody>
                {list.data?.items.map((m) => (
                  <tr key={m.customerId}>
                    <td><strong>{m.name}</strong><div className="muted small">VIBE ID {m.vibeId} · {m.memberNo ?? '—'}</div></td>
                    <td>{m.plan || '—'}</td>
                    <td><Badge tone={TONE[m.status] ?? 'muted'}>{m.status === 'cancelled' ? 'Cancelled (still running)' : m.status}</Badge></td>
                    <td className="small">{showDateTime(m.joinedAt)}</td>
                    <td className="small">{showDateTime(m.validUntil)}</td>
                    <td>{formatINR(m.totalPaid)}</td>
                    <td>{formatINR(m.totalSaved)}</td>
                  </tr>
                ))}
                {list.data?.items.length === 0 ? <tr><td colSpan={7} className="muted">No members here.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="muted small">{total === 0 ? '' : `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total}`}</span>
            <div className="row">
              <button className="btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
              <button className="btn sm" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</button>
            </div>
          </div>
        </>
      )}
      <p className="muted small">Memberships don’t renew by themselves yet (that needs the payment partner’s recurring payments). A member whose date passes becomes Expired until they buy again.</p>
    </>
  );
}
