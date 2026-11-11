import { useState } from 'react';

import { Badge, Field, Loading, Modal, Notice, PageHead, errorText, ruleSummary, showDateTime, useAsync, useAuth, type ReviewOffer, type ReviewStatus } from '@kit';

const TABS: { key: ReviewStatus; label: string }[] = [{ key: 'pending', label: 'Waiting for review' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Rejected' }];

export function OfferReviewPage() {
  const { client } = useAuth();
  const [tab, setTab] = useState<ReviewStatus>('pending');
  const list = useAsync(() => client.get<ReviewOffer[]>(`/v1/admin/offers?status=${tab}`), [client, tab]);
  const [rejecting, setRejecting] = useState<ReviewOffer | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const approve = async (o: ReviewOffer) => {
    setError(null);
    try {
      await client.post(`/v1/admin/offers/${o.id}/approve`);
      setNotice(`Approved “${o.title}”. It is live if it is switched on and inside its dates.`);
      list.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    setError(null);
    try {
      await client.post(`/v1/admin/offers/${rejecting.id}/reject`, { note });
      setNotice(`Rejected “${rejecting.title}”. The merchant sees your note.`);
      setRejecting(null);
      setNote('');
      list.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <>
      <PageHead title="Offer review" sub="Merchant offers go live only after you approve them. Rejecting an approved offer takes it off the app." />
      <div className="tabs" role="tablist">
        {TABS.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab${tab === t.key ? ' on' : ''}`} onClick={() => { setTab(t.key); setNotice(null); }}>{t.label}</button>)}
      </div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error && !rejecting ? <Notice tone="error">{error}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Business</th><th>Offer</th><th>Rule</th><th>Runs</th><th /></tr></thead>
            <tbody>
              {list.data?.map((o) => (
                <tr key={o.id}>
                  <td><strong>{o.businessName}</strong></td>
                  <td>{o.title} {o.memberOnly ? <Badge tone="pink">Members</Badge> : null}{!o.active ? <> <Badge>Switched off</Badge></> : null}{o.reviewNote ? <div className="muted small">Note: {o.reviewNote}</div> : null}</td>
                  <td className="small">{ruleSummary(o)}</td>
                  <td className="small">{showDateTime(o.startsAt)}<br />to {showDateTime(o.endsAt)}</td>
                  <td className="actions">
                    {o.reviewStatus !== 'approved' ? <button className="btn primary sm" onClick={() => approve(o)}>Approve</button> : null}
                    {o.reviewStatus !== 'rejected' ? <button className="btn ghost sm danger" onClick={() => { setError(null); setNote(''); setRejecting(o); }}>Reject</button> : null}
                  </td>
                </tr>
              ))}
              {list.data?.length === 0 ? <tr><td colSpan={5} className="muted">{tab === 'pending' ? 'Nothing waiting for review.' : 'None.'}</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {rejecting ? (
        <Modal title={`Reject “${rejecting.title}”`} onClose={() => setRejecting(null)}>
          <div className="stack">
            <p className="muted small" style={{ margin: 0 }}>{rejecting.businessName} will see this note, so say what to change.</p>
            <Field label="Note to the merchant"><textarea autoFocus rows={3} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot">
              <button className="btn" onClick={() => setRejecting(null)}>Cancel</button>
              <button className="btn primary" disabled={!note.trim()} onClick={reject}>Reject offer</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
