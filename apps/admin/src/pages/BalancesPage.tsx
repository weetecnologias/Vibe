import { useState } from 'react';
import { Link } from 'react-router-dom';

import { DownloadButton, Loading, Notice, PageHead, formatINR, showDateTime, useAsync, useAuth, type MerchantBalances } from '@kit';

import { useWorkspace } from '../workspace';
import { KycBadge } from './MerchantsPage';

/**
 * A plain statement per business: what they sold through VIBE, what VIBE keeps (fees, commission and its GST), refunds charged to them and
 * adjustments, what has been paid out, and what VIBE owes them now. The category's totals are the last row. This is the readable version of
 * the accounting ledger, which stays under Setup for finance and audit.
 */
export function BalancesPage() {
  const { client } = useAuth();
  const { current } = useWorkspace();
  const b = useAsync(() => client.get<MerchantBalances>('/v1/admin/balances'), [client]);
  const [q, setQ] = useState('');
  const [owedOnly, setOwedOnly] = useState(false);
  const rows = (b.data?.rows ?? []).filter((r) => (!q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase())) && (!owedOnly || r.owed !== 0));
  const t = b.data?.total;

  return (
    <>
      <PageHead
        title="Merchant balances"
        sub={`What each business${current.id ? ` in ${current.name}` : ''} has earned through VIBE, what has been paid, and what is still owed.`}
        actions={<><DownloadButton path="/v1/admin/balances.csv" filename="vibe-merchant-balances.csv" label="Download Excel" /><button className="btn" onClick={b.reload}>Refresh</button></>}
      />
      {b.error ? <Notice tone="error">{b.error}</Notice> : null}
      {b.loading && !b.data ? <Loading /> : t ? (
        <div className="stack">
          <div className="kpis">
            <div className="card"><span className="muted small">Sales through VIBE</span><strong>{formatINR(t.gross)}</strong><span className="muted small">{t.payments.toLocaleString('en-IN')} payments</span></div>
            <div className="card"><span className="muted small">VIBE keeps</span><strong>{formatINR(t.vibeFees + t.commission + t.gst)}</strong><span className="muted small">Fees {formatINR(t.vibeFees)} · commission {formatINR(t.commission)} · GST {formatINR(t.gst)}</span></div>
            <div className="card"><span className="muted small">Paid out</span><strong>{formatINR(t.paidOut)}</strong></div>
            <div className="card"><span className="muted small">Owed now</span><strong>{formatINR(t.owed)}</strong><span className="muted small">{formatINR(t.awaitingPayout)} drawn up, waiting for the bank transfer</span></div>
          </div>
          <div className="row">
            <input style={{ maxWidth: 280 }} placeholder="Find a business" aria-label="Find a business" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="check"><input type="checkbox" checked={owedOnly} onChange={(e) => setOwedOnly(e.target.checked)} /> Only businesses VIBE owes</label>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Business</th><th>Sales</th><th>VIBE fees</th><th>Commission + GST</th><th>Refunds</th><th>Adjustments</th><th>Earned</th><th>Paid out</th><th>Owed now</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><Link to={`/merchants/${r.id}`}><strong>{r.name}</strong></Link><div className="muted small">{r.category} · {r.payments} payments{r.lastSaleAt ? ` · last ${showDateTime(r.lastSaleAt)}` : ''}</div><KycBadge status={r.kycStatus} /></td>
                    <td>{formatINR(r.gross)}</td>
                    <td>− {formatINR(r.vibeFees)}</td>
                    <td>− {formatINR(r.commission + r.gst)}</td>
                    <td>{r.refunds ? `− ${formatINR(r.refunds)}` : '—'}</td>
                    <td>{r.adjustments ? `${r.adjustments > 0 ? '+' : '−'} ${formatINR(Math.abs(r.adjustments))}` : '—'}</td>
                    <td>{formatINR(r.earned)}</td>
                    <td>{formatINR(r.paidOut)}</td>
                    <td><strong>{formatINR(r.owed)}</strong>{r.awaitingPayout ? <div className="muted small">{formatINR(r.awaitingPayout)} to transfer</div> : null}</td>
                  </tr>
                ))}
                {rows.length === 0 ? <tr><td colSpan={9} className="muted">No businesses with sales yet.</td></tr> : null}
                {rows.length > 1 ? (
                  <tr style={{ fontWeight: 700 }}>
                    <td>Total{current.id ? `, ${current.name}` : ''}</td><td>{formatINR(t.gross)}</td><td>− {formatINR(t.vibeFees)}</td><td>− {formatINR(t.commission + t.gst)}</td><td>− {formatINR(t.refunds)}</td>
                    <td>{formatINR(t.adjustments)}</td><td>{formatINR(t.earned)}</td><td>{formatINR(t.paidOut)}</td><td>{formatINR(t.owed)}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <p className="muted small">Earned = sales − VIBE fees − commission − GST on commission − refunds charged to the business ± adjustments. Owed now = earned − paid out. Pay it under Settlements.</p>
        </div>
      ) : null}
    </>
  );
}
