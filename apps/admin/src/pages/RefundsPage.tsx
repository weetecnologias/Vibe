import { useState } from 'react';

import { Badge, Field, Loading, Modal, Notice, PageHead, errorText, formatINR, showDateTime, useAsync, useAuth, type RefundPage, type RefundRow } from '@kit';

const TABS = [{ key: 'due', label: 'To refund' }, { key: 'refunded', label: 'Refunded' }, { key: '', label: 'All' }] as const;
const KIND: Record<string, string> = { redemption: 'Bill', tickets: 'Tickets', slots: 'Booking', pass: 'Venue membership', membership: 'VIBE Membership' };

/**
 * Money going back to customers. A refund is raised on a confirmed payment (from Transactions, or automatically when VIBE cancels an event),
 * then marked refunded once the payment partner has sent it, with the partner's reference. Refunded payments aren't settled to the business.
 */
export function RefundsPage() {
  const { client } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('due');
  const list = useAsync(() => client.get<RefundPage>(`/v1/admin/refunds${tab ? `?status=${tab}` : ''}`), [client, tab]);
  const [doing, setDoing] = useState<RefundRow | null>(null);
  const [ref, setRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const t = list.data?.totals;

  const done = async () => {
    if (!doing) return;
    setError(null);
    try {
      await client.post(`/v1/admin/refunds/${doing.reference}/done`, { partnerReference: ref.trim() });
      setNotice(`Marked ${formatINR(doing.refundAmount)} to ${doing.customerName} as refunded. They’ve been told.`);
      setDoing(null);
      setRef('');
      list.reload();
    } catch (e) { setError(errorText(e)); }
  };

  return (
    <>
      <PageHead title="Refunds" sub="Money going back to customers, from raised to sent. Raise one from a transaction; cancelled events add theirs automatically." actions={<button className="btn" onClick={list.reload}>Refresh</button>} />
      <div className="stats">
        <div className="card"><span className="muted small">To refund</span><strong>{t ? t.due : '–'}</strong><span className="muted small">{t ? formatINR(t.dueAmount) : ''}</span></div>
        <div className="card"><span className="muted small">Refunded</span><strong>{t ? t.refunded : '–'}</strong><span className="muted small">{t ? formatINR(t.refundedAmount) : ''}</span></div>
        <div className="card"><span className="muted small">How</span><span className="small">Send it from the payment partner’s dashboard, then mark it here with their reference.</span></div>
      </div>
      <div className="tabs" role="tablist">
        {TABS.map((x) => <button key={x.key || 'all'} role="tab" aria-selected={tab === x.key} className={`tab${tab === x.key ? ' on' : ''}`} onClick={() => { setTab(x.key); setNotice(null); }}>{x.label}</button>)}
      </div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error && !doing ? <Notice tone="error">{error}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Payment</th><th>Customer</th><th>Refund</th><th>Why</th><th>Raised</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data?.items.map((x) => (
                <tr key={x.reference}>
                  <td><strong>{x.reference}</strong><div className="muted small">{KIND[x.kind] ?? x.kind} · {x.payee}</div></td>
                  <td className="small">{x.customerName}<div className="muted">ID {x.vibeId}</div></td>
                  <td>{formatINR(x.refundAmount)}<div className="muted small">of {formatINR(x.paid)} paid</div></td>
                  <td className="small">{x.reason}</td>
                  <td className="small">{showDateTime(x.requestedAt)}<div className="muted">by {x.requestedBy}</div></td>
                  <td>{x.status === 'due' ? <Badge tone="warning">To refund</Badge> : <><Badge tone="success">Refunded</Badge><div className="muted small">{x.refundedAt ? showDateTime(x.refundedAt) : ''} · {x.partnerReference}</div></>}</td>
                  <td className="actions">{x.status === 'due' ? <button className="btn primary sm" onClick={() => { setError(null); setRef(''); setDoing(x); }}>Mark refunded</button> : null}</td>
                </tr>
              ))}
              {list.data?.items.length === 0 ? <tr><td colSpan={7} className="muted">{tab === 'due' ? 'Nothing to refund.' : 'None.'}</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {doing ? (
        <Modal title={`Refund ${formatINR(doing.refundAmount)} to ${doing.customerName}`} onClose={() => setDoing(null)}>
          <div className="stack">
            <p className="muted small" style={{ margin: 0 }}>Send the refund from the payment partner’s dashboard first. Then paste their refund reference here. The customer is told it’s on its way.</p>
            <Field label="Payment partner’s refund reference"><input autoFocus value={ref} maxLength={100} onChange={(e) => setRef(e.target.value)} placeholder="rfnd_..." /></Field>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot"><button className="btn" onClick={() => setDoing(null)}>Cancel</button><button className="btn primary" disabled={!ref.trim()} onClick={done}>Mark refunded</button></div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

