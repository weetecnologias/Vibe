import { useState } from 'react';

import { Badge, Field, Loading, Modal, Notice, PageHead, errorText, formatINR, rupeesToPaise, showDateTime, useAsync, useAuth, type DisputeRow } from '@kit';

const TABS = [{ key: 'open', label: 'Open' }, { key: 'refund', label: 'Refunded' }, { key: 'rejected', label: 'Declined' }, { key: '', label: 'All' }] as const;
const REASON: Record<string, string> = { not_received: 'Didn’t get what they paid for', wrong_amount: 'Wrong amount', charged_twice: 'Charged twice', poor_service: 'Poor service', other: 'Something else' };

/** Customers reporting a problem with a payment. VIBE has 5 days to respond: refund (full or part, borne by the business or VIBE) or decline with a reason. */
export function DisputesPage() {
  const { client } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('open');
  const list = useAsync(() => client.get<DisputeRow[]>(`/v1/admin/disputes${tab ? `?status=${tab}` : ''}`), [client, tab]);
  const [open, setOpen] = useState<DisputeRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const overdue = (list.data ?? []).filter((d) => d.overdue).length;

  return (
    <>
      <PageHead title="Disputes" sub="Problems customers report with a payment. Look into each one, then refund it or tell the customer why not." actions={<button className="btn" onClick={list.reload}>Refresh</button>} />
      {overdue ? <Notice tone="error">{overdue} past the 5-day deadline.</Notice> : null}
      <div className="tabs" role="tablist">
        {TABS.map((t) => <button key={t.label} role="tab" aria-selected={tab === t.key} className={`tab${tab === t.key ? ' on' : ''}`} onClick={() => { setTab(t.key); setNotice(null); }}>{t.label}</button>)}
      </div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Report</th><th>Customer</th><th>Payment</th><th>Problem</th><th>Respond by</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data?.map((d) => (
                <tr key={d.reference}>
                  <td><strong>{d.reference}</strong><div className="muted small">{showDateTime(d.createdAt)}</div></td>
                  <td className="small">{d.customerName}<div className="muted">ID {d.vibeId}</div></td>
                  <td className="small"><strong>{d.paymentReference}</strong><div className="muted">{d.businessName ?? 'VIBE'} · {formatINR(d.paid)}</div></td>
                  <td className="small">{REASON[d.reason]}{d.details ? <div className="muted">{d.details}</div> : null}</td>
                  <td className="small">{d.status === 'open' ? <>{showDateTime(d.dueBy)}{d.overdue ? <div><Badge tone="warning">Overdue</Badge></div> : null}</> : '—'}</td>
                  <td>{d.status === 'open' ? <Badge tone="warning">Open</Badge> : d.status === 'refund' ? <><Badge tone="success">Refund {d.refundAmount ? formatINR(d.refundAmount) : ''}</Badge></> : <Badge>Declined</Badge>}{d.resolutionNote ? <div className="muted small">{d.resolutionNote}</div> : null}</td>
                  <td className="actions">{d.status === 'open' ? <button className="btn primary sm" onClick={() => setOpen(d)}>Resolve</button> : null}</td>
                </tr>
              ))}
              {list.data?.length === 0 ? <tr><td colSpan={7} className="muted">{tab === 'open' ? 'No open disputes.' : 'None.'}</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {open ? <Resolve d={open} onClose={() => setOpen(null)} onDone={(m) => { setOpen(null); setNotice(m); list.reload(); }} /> : null}
    </>
  );
}

function Resolve({ d, onClose, onDone }: { d: DisputeRow; onClose: () => void; onDone: (message: string) => void }) {
  const { client } = useAuth();
  const [outcome, setOutcome] = useState<'refund' | 'reject'>('refund');
  const [amount, setAmount] = useState('');
  const [bearer, setBearer] = useState<'merchant' | 'vibe'>('merchant');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const paise = amount.trim() ? rupeesToPaise(amount) : null;
    if (amount.trim() && paise === null) return setError('Enter the amount in rupees, or leave it empty to refund everything.');
    setBusy(true);
    setError(null);
    try {
      await client.post(`/v1/admin/disputes/${d.reference}/resolve`, outcome === 'refund' ? { outcome, amount: paise, bearer, note: note.trim() } : { outcome, note: note.trim() });
      onDone(outcome === 'refund' ? `Refund raised for ${d.paymentReference}. Send it from the payment partner, then mark it done under Refunds.` : `Declined. ${d.customerName} has been told why.`);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title={`${d.reference} · ${REASON[d.reason]}`} onClose={onClose}>
      <div className="stack">
        <div className="small">{d.customerName} paid {formatINR(d.paid)} ({d.paymentReference}) to <strong>{d.businessName ?? 'VIBE'}</strong>.{d.details ? <> They said: “{d.details}”</> : null}</div>
        <div className="row">
          <label className="check"><input type="radio" name="o" checked={outcome === 'refund'} onChange={() => setOutcome('refund')} /> Refund</label>
          <label className="check"><input type="radio" name="o" checked={outcome === 'reject'} onChange={() => setOutcome('reject')} /> Decline</label>
        </div>
        {outcome === 'refund' ? (
          <div className="grid2">
            <Field label="Amount (₹)" hint={`Empty refunds all ${formatINR(d.paid)}.`}><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
            <Field label="Who bears it" hint="The business’s settlement is reduced, or VIBE absorbs it.">
              <select value={bearer} onChange={(e) => setBearer(e.target.value as 'merchant' | 'vibe')}><option value="merchant">The business</option><option value="vibe">VIBE</option></select>
            </Field>
          </div>
        ) : null}
        <Field label={outcome === 'reject' ? 'Why (the customer sees this)' : 'Note (optional, the customer sees this)'}><textarea rows={3} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="modal-foot"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || (outcome === 'reject' && !note.trim())} onClick={submit}>{busy ? 'Saving…' : outcome === 'refund' ? 'Raise refund' : 'Decline'}</button></div>
      </div>
    </Modal>
  );
}
