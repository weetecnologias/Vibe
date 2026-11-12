import { useState } from 'react';

import { Badge, DownloadButton, Loading, Modal, Notice, PageHead, formatINR, showDateTime, useAsync, useAuth, type TransactionDetail, type TransactionPage } from '@kit';

const PAGE = 25;
const TONE: Record<string, 'success' | 'warning' | 'muted'> = { verified: 'success', failed: 'warning', pending: 'muted' };

export function TransactionsPage() {
  const { client } = useAuth();
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const qs = `limit=${PAGE}&offset=${offset}${status ? `&status=${status}` : ''}${kind ? `&kind=${kind}` : ''}${term ? `&q=${encodeURIComponent(term)}` : ''}`;
  const list = useAsync(() => client.get<TransactionPage>(`/v1/admin/transactions?${qs}`), [client, qs]);
  const t = list.data?.totals;
  const total = list.data?.total ?? 0;

  return (
    <>
      <PageHead title="Transactions" sub="Every payment, with who paid, where, how much, and whether the payment partner confirmed it." actions={<div className="row"><DownloadButton path={`/v1/admin/exports/transactions?x=1${status ? `&status=${status}` : ''}${kind ? `&kind=${kind}` : ''}${term ? `&q=${encodeURIComponent(term)}` : ''}`} filename="vibe-transactions.csv" /><button className="btn" onClick={list.reload}>Refresh</button></div>} />
      <div className="stats">
        <div className="card"><span className="muted small">Payments in this view</span><strong>{t?.count ?? '–'}</strong></div>
        <div className="card"><span className="muted small">Confirmed amount</span><strong>{t ? formatINR(t.verifiedAmount) : '–'}</strong></div>
        <div className="card"><span className="muted small">Customers saved</span><strong>{t ? formatINR(t.savings) : '–'}</strong></div>
      </div>
      <form className="row" style={{ marginBottom: 14 }} onSubmit={(e) => { e.preventDefault(); setOffset(0); setTerm(q.trim()); }}>
        <select aria-label="Status" style={{ maxWidth: 160 }} value={status} onChange={(e) => { setOffset(0); setStatus(e.target.value); }}><option value="">Any status</option><option value="verified">Confirmed</option><option value="pending">Pending</option><option value="failed">Failed</option></select>
        <select aria-label="Type" style={{ maxWidth: 180 }} value={kind} onChange={(e) => { setOffset(0); setKind(e.target.value); }}><option value="">Any type</option><option value="redemption">Bills</option><option value="membership">Membership</option></select>
        <input style={{ maxWidth: 280 }} placeholder="Reference, place or VIBE ID" aria-label="Search transactions" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn">Search</button>
        {term ? <button type="button" className="btn ghost" onClick={() => { setQ(''); setTerm(''); setOffset(0); }}>Clear</button> : null}
      </form>
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Reference</th><th>Paid to</th><th>Customer</th><th>Amount</th><th>When</th><th>Status</th><th /></tr></thead>
              <tbody>
                {list.data?.items.map((x) => (
                  <tr key={x.reference}>
                    <td><strong>{x.reference}</strong><div className="muted small">{x.kind === 'membership' ? 'Membership' : 'Bill'} · {x.method.toUpperCase()}</div></td>
                    <td>{x.payee}</td>
                    <td className="small">{x.customerName}<div className="muted">ID {x.vibeId}</div></td>
                    <td>{formatINR(x.amount)}{x.savings > 0 ? <div className="muted small">saved {formatINR(x.savings)}</div> : null}</td>
                    <td className="small">{showDateTime(x.createdAt)}</td>
                    <td><Badge tone={TONE[x.status] ?? 'muted'}>{x.status === 'verified' ? 'Confirmed' : x.status}</Badge></td>
                    <td className="actions"><button className="btn ghost sm" onClick={() => setOpen(x.reference)}>Open</button></td>
                  </tr>
                ))}
                {list.data?.items.length === 0 ? <tr><td colSpan={7} className="muted">No transactions match.</td></tr> : null}
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
      {open ? <TransactionModal reference={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function TransactionModal({ reference, onClose }: { reference: string; onClose: () => void }) {
  const { client } = useAuth();
  const d = useAsync(() => client.get<TransactionDetail>(`/v1/admin/transactions/${reference}`), [client, reference]);
  const x = d.data;
  return (
    <Modal title={reference} onClose={onClose}>
      {d.loading && !x ? <Loading /> : d.error && !x ? <Notice tone="error">{d.error}</Notice> : x ? (
        <div className="stack">
          <div className="row"><Badge tone={TONE[x.row.status] ?? 'muted'}>{x.row.status === 'verified' ? 'Confirmed by the payment partner' : x.row.status}</Badge><span className="muted small">{x.row.provider}</span></div>
          <div className="small">{x.row.customerName} (VIBE ID {x.row.vibeId}) paid <strong>{x.row.payee}</strong> by {x.row.method.toUpperCase()} on {showDateTime(x.row.createdAt)}.</div>
          {x.failureReason ? <Notice tone="error">{x.failureReason}</Notice> : null}
          <table>
            <tbody>
              {x.lines.map((l, i) => <tr key={i}><td>{l.label}</td><td style={{ textAlign: 'right' }}>{formatINR(l.amount)}</td></tr>)}
              {x.discount > 0 ? <tr><td>{x.discountLabel}</td><td style={{ textAlign: 'right', color: 'var(--pink-deep)' }}>− {formatINR(x.discount)}</td></tr> : null}
              <tr><td><strong>Paid</strong></td><td style={{ textAlign: 'right' }}><strong>{formatINR(x.row.amount)}</strong></td></tr>
            </tbody>
          </table>
          <div className="muted small">Bill {x.billRef ?? '—'} · raised by {x.raisedBy ?? '—'} · partner payment {x.providerPaymentId ?? 'not confirmed yet'}</div>
          {x.providerEvents.length ? <div className="muted small">Partner messages: {x.providerEvents.join(' · ')}</div> : null}
        </div>
      ) : null}
    </Modal>
  );
}
