import { useState } from 'react';

import { Link } from 'react-router-dom';

import { Badge, DownloadButton, Loading, Modal, Notice, PageHead, bpsToPercent, formatINR, showDateTime, useAsync, useAuth, type MerchantMoney, type SettlementDetail } from '@kit';

import { useSettings } from '../settings';

/** Money VIBE owes this business, settlements drawn up, and what has been paid to its bank. */
export function SettlementsPage() {
  const { client } = useAuth();
  const money = useAsync(() => client.get<MerchantMoney>('/v1/merchant/settlements'), [client]);
  const [open, setOpen] = useState<string | null>(null);
  const m = money.data;
  const settings = useSettings();

  return (
    <>
      <PageHead title="Settlements" sub="Customers pay you through VIBE. VIBE gathers those payments into settlements and transfers them to your bank. You’re told here each time." actions={<button className="btn" onClick={money.reload}>Refresh</button>} />
      {money.error ? <Notice tone="error">{money.error}</Notice> : null}
      {settings.kycStatus && settings.kycStatus !== 'verified' ? <Notice tone="info">VIBE can’t pay you out until your bank details are verified. {settings.owner ? <Link to="/kyc">Send them now</Link> : 'Ask the owner to send them.'} Payments are still collected and counted meanwhile.</Notice> : null}
      {money.loading && !m ? <Loading /> : m ? (
        <>
          <div className="stats">
            <div className="card"><span className="muted small">Not settled yet</span><strong>{formatINR(m.unsettled.payout)}</strong><span className="muted small">{m.unsettled.count} payments</span></div>
            <div className="card"><span className="muted small">Settled, transfer on its way</span><strong>{formatINR(m.awaitingPayout)}</strong></div>
            <div className="card"><span className="muted small">Paid to your bank so far</span><strong>{formatINR(m.paidOut)}</strong></div>
          </div>
          <p className="muted small">VIBE’s commission is {bpsToPercent(m.commissionBps)}% of what customers pay you through the app. It is shown on every settlement.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Settlement</th><th>Period</th><th>Payments</th><th>Collected</th><th>Commission</th><th>You receive</th><th>Status</th><th /></tr></thead>
              <tbody>
                {m.settlements.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.reference}</strong><div className="muted small">{showDateTime(s.createdAt)}</div></td>
                    <td className="small">{showDateTime(s.periodFrom)}<div className="muted">to {showDateTime(s.periodTo)}</div></td>
                    <td>{s.paymentCount}</td>
                    <td>{formatINR(s.gross)}</td>
                    <td>{formatINR(s.commission)}</td>
                    <td><strong>{formatINR(s.payout)}</strong></td>
                    <td>{s.status === 'paid' ? <><Badge tone="success">Paid</Badge><div className="muted small">Ref {s.payoutRef}</div></> : <Badge tone="warning">Transfer on its way</Badge>}</td>
                    <td className="actions"><button className="btn ghost sm" onClick={() => setOpen(s.id)}>Open</button></td>
                  </tr>
                ))}
                {m.settlements.length === 0 ? <tr><td colSpan={8} className="muted">No settlements yet. They appear here once VIBE draws one up for your payments.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
      {open ? <SettlementModal id={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function SettlementModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { client } = useAuth();
  const d = useAsync(() => client.get<SettlementDetail>(`/v1/merchant/settlements/${id}`), [client, id]);
  const s = d.data?.summary;
  return (
    <Modal title={s ? `Settlement ${s.reference}` : 'Settlement'} onClose={onClose} wide>
      {d.loading && !d.data ? <Loading /> : d.error && !d.data ? <Notice tone="error">{d.error}</Notice> : s && d.data ? (
        <div className="stack">
          <div className="stats">
            <div className="card"><span className="muted small">Collected</span><strong>{formatINR(s.gross)}</strong></div>
            <div className="card"><span className="muted small">VIBE commission ({bpsToPercent(s.commissionBps)}%)</span><strong>{formatINR(s.commission)}</strong>{s.gst > 0 ? <span className="muted small">+ GST {formatINR(s.gst)}</span> : null}</div>
            <div className="card"><span className="muted small">You receive</span><strong>{formatINR(s.payout)}</strong></div>
          </div>
          {s.status === 'paid' ? <Notice tone="success">Paid to your bank {s.paidAt ? showDateTime(s.paidAt) : ''}. Bank reference {s.payoutRef}.</Notice> : <Notice tone="info">VIBE will transfer this to your bank and tell you here with the bank reference.</Notice>}
          {s.refundDeductions > 0 || s.adjustments !== 0 ? (
            <div className="card stack" style={{ gap: 4 }}>
              {s.refundDeductions > 0 ? <div className="row small" style={{ justifyContent: 'space-between' }}><span>Refunds to customers that came off this settlement</span><strong>− {formatINR(s.refundDeductions)}</strong></div> : null}
              {d.data.adjustments.map((a) => <div key={a.id} className="row small" style={{ justifyContent: 'space-between' }}><span>{a.kind === 'credit' ? 'Credit' : 'Deduction'}: {a.reason}</span><strong>{a.amount > 0 ? '+' : '−'} {formatINR(Math.abs(a.amount))}</strong></div>)}
            </div>
          ) : null}
          <div className="row" style={{ justifyContent: 'flex-end' }}><DownloadButton small path={`/v1/merchant/settlements/${id}/export`} filename={`${s.reference}.csv`} /></div>
          <div className="table-wrap" style={{ maxHeight: 300, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Transaction ID</th><th>Customer</th><th>Offer</th><th>Collected</th><th>Commission</th><th>You receive</th></tr></thead>
              <tbody>
                {d.data.items.map((i) => (
                  <tr key={i.paymentReference}>
                    <td><strong>{i.paymentReference}</strong><div className="muted small">{showDateTime(i.paidAt)} · {i.billRef}</div></td>
                    <td className="small">{i.customerName}<div className="muted">ID {i.vibeId}</div></td>
                    <td className="small">{i.offerTitle ?? '—'}</td>
                    <td>{formatINR(i.amount)}</td>
                    <td>{formatINR(i.commission)}</td>
                    <td><strong>{formatINR(i.payout)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
