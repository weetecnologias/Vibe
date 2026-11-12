import { useState } from 'react';

import { Badge, Field, Loading, Modal, Notice, PageHead, errorText, showDateTime, useAsync, useAuth, type PromotionRow, type ReviewStatus } from '@kit';

const TABS: { key: ReviewStatus; label: string }[] = [{ key: 'pending', label: 'Waiting for review' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Rejected' }];

/** Businesses promoting themselves in the customer app's Discover tab. Nothing shows until VIBE approves it; rejecting takes it off the app. */
export function PromotionReviewPage() {
  const { client } = useAuth();
  const [tab, setTab] = useState<ReviewStatus>('pending');
  const list = useAsync(() => client.get<PromotionRow[]>(`/v1/admin/promotions?status=${tab}`), [client, tab]);
  const [rejecting, setRejecting] = useState<PromotionRow | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const approve = async (p: PromotionRow) => {
    setError(null);
    try {
      await client.post(`/v1/admin/promotions/${p.id}/approve`);
      setNotice(`Approved “${p.title}”. It shows in Discover if it is switched on and inside its dates.`);
      list.reload();
    } catch (e) { setError(errorText(e)); }
  };

  const reject = async () => {
    if (!rejecting) return;
    setError(null);
    try {
      await client.post(`/v1/admin/promotions/${rejecting.id}/reject`, { note });
      setNotice(`Rejected “${rejecting.title}”. The business sees your note.`);
      setRejecting(null);
      setNote('');
      list.reload();
    } catch (e) { setError(errorText(e)); }
  };

  return (
    <>
      <PageHead title="Promotion review" sub="Businesses promote themselves in Discover → Promotions. They go live only after you approve them (trusted businesses go live at once and show as auto-approved)." />
      <div className="tabs" role="tablist">
        {TABS.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab${tab === t.key ? ' on' : ''}`} onClick={() => { setTab(t.key); setNotice(null); }}>{t.label}</button>)}
      </div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error && !rejecting ? <Notice tone="error">{error}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Business</th><th>Promotion</th><th>Photo</th><th>Tap opens</th><th>Runs</th><th>Taps</th><th /></tr></thead>
            <tbody>
              {list.data?.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.businessName}</strong></td>
                  <td>
                    <strong>{p.title}</strong>{p.autoApproved ? <> <Badge tone="success">Auto-approved</Badge></> : null}{!p.active ? <> <Badge>Switched off</Badge></> : null}
                    {p.message ? <div className="small">{p.message}</div> : null}
                    {p.reviewNote ? <div className="muted small">Note: {p.reviewNote}</div> : null}
                  </td>
                  <td>{p.imageUrl ? <a href={p.imageUrl} target="_blank" rel="noreferrer"><img src={p.imageUrl} alt="" style={{ width: 72, height: 48, objectFit: 'cover', borderRadius: 6 }} /></a> : <span className="muted small">Cover photo</span>}</td>
                  <td className="small">{p.offerTitle ? `Offer: ${p.offerTitle}` : 'Business page'}</td>
                  <td className="small">{showDateTime(p.startsAt)}<br />to {showDateTime(p.endsAt)}</td>
                  <td>{p.taps}</td>
                  <td className="actions">
                    {p.reviewStatus !== 'approved' ? <button className="btn primary sm" onClick={() => approve(p)}>Approve</button> : null}
                    {p.reviewStatus !== 'rejected' ? <button className="btn ghost sm danger" onClick={() => { setError(null); setNote(''); setRejecting(p); }}>Reject</button> : null}
                  </td>
                </tr>
              ))}
              {list.data?.length === 0 ? <tr><td colSpan={7} className="muted">{tab === 'pending' ? 'Nothing waiting for review.' : 'None.'}</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {rejecting ? (
        <Modal title={`Reject “${rejecting.title}”`} onClose={() => setRejecting(null)}>
          <div className="stack">
            <p className="muted small" style={{ margin: 0 }}>{rejecting.businessName} will see this note, so say what to change.</p>
            <Field label="Note to the business"><textarea autoFocus rows={3} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot">
              <button className="btn" onClick={() => setRejecting(null)}>Cancel</button>
              <button className="btn primary" disabled={!note.trim()} onClick={reject}>Reject promotion</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
