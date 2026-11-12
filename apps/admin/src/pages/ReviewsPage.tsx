import { useState } from 'react';

import { Badge, Field, Loading, Modal, Notice, PageHead, errorText, showDateTime, useAsync, useAuth, type ReviewItem } from '@kit';

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);
type Filter = '' | 'low' | 'hidden';

/** Every rating customers gave after a visit. Hide one that breaks the rules (abuse, personal details, not about the visit); it drops out of the place's rating. */
export function ReviewsPage() {
  const { client } = useAuth();
  const [filter, setFilter] = useState<Filter>('');
  const list = useAsync(() => client.get<ReviewItem[]>(`/v1/admin/reviews${filter ? `?filter=${filter}` : ''}`), [client, filter]);
  const [hiding, setHiding] = useState<ReviewItem | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const unhide = async (r: ReviewItem) => {
    setError(null);
    try { await client.post(`/v1/admin/reviews/${r.id}/unhide`); setNotice('Review shown again.'); list.reload(); } catch (e) { setError(errorText(e)); }
  };
  const hide = async () => {
    if (!hiding) return;
    setError(null);
    try { await client.post(`/v1/admin/reviews/${hiding.id}/hide`, { reason: reason.trim() }); setNotice('Review hidden. It no longer counts towards the rating.'); setHiding(null); setReason(''); list.reload(); } catch (e) { setError(errorText(e)); }
  };

  const tabs: { key: Filter; label: string }[] = [{ key: '', label: 'All' }, { key: 'low', label: '1–2 stars' }, { key: 'hidden', label: 'Hidden' }];
  return (
    <>
      <PageHead title="Reviews" sub="Ratings from real visits (a confirmed code or a paid bill). Hiding one needs a reason and is written to the audit log." />
      <div className="tabs" role="tablist">
        {tabs.map((t) => <button key={t.key || 'all'} role="tab" aria-selected={filter === t.key} className={`tab${filter === t.key ? ' on' : ''}`} onClick={() => setFilter(t.key)}>{t.label}</button>)}
      </div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error && !hiding ? <Notice tone="error">{error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Rating</th><th>Place</th><th>Customer</th><th>Review</th><th>When</th><th /></tr></thead>
            <tbody>
              {list.data?.map((r) => (
                <tr key={r.id} className={r.hidden ? 'dim' : ''}>
                  <td><span className="stars">{stars(r.rating)}</span></td>
                  <td className="small"><strong>{r.businessName}</strong><div className="muted">{r.offerTitle} · {r.mode === 'code' ? 'code' : 'paid in VIBE'}</div></td>
                  <td className="small">{r.customerName}<div className="muted">ID {r.vibeId}</div></td>
                  <td className="small" style={{ maxWidth: 320 }}>{r.comment || <span className="muted">No comment</span>}{r.hidden ? <div style={{ marginTop: 4 }}><Badge>Hidden: {r.hiddenReason}</Badge></div> : null}</td>
                  <td className="small">{showDateTime(r.createdAt)}</td>
                  <td className="actions">{r.hidden ? <button className="btn ghost sm" onClick={() => unhide(r)}>Show again</button> : <button className="btn ghost sm danger" onClick={() => { setError(null); setReason(''); setHiding(r); }}>Hide</button>}</td>
                </tr>
              ))}
              {list.data?.length === 0 ? <tr><td colSpan={6} className="muted">No reviews here.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {hiding ? (
        <Modal title="Hide this review" onClose={() => setHiding(null)}>
          <div className="stack">
            <p className="small" style={{ margin: 0 }}><span className="stars">{stars(hiding.rating)}</span> {hiding.comment || 'No comment'}</p>
            <Field label="Why is it being hidden?" hint="Kept in the audit log, and shown to the merchant."><input autoFocus value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot">
              <button className="btn" onClick={() => setHiding(null)}>Cancel</button>
              <button className="btn primary" disabled={!reason.trim()} onClick={hide}>Hide review</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
