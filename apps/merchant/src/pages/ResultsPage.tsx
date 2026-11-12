import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge, Loading, Notice, PageHead, formatINR, useAsync, useAuth, type MerchantResults } from '@kit';

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** What VIBE has brought this business: customers, sales through the app, the discount given, which offers work, and money on its way. */
export function ResultsPage() {
  const { client } = useAuth();
  const [days, setDays] = useState(30);
  const r = useAsync(() => client.get<MerchantResults>(`/v1/merchant/results?days=${days}`), [client, days]);
  const d = r.data;
  const max = d ? Math.max(1, ...d.lastDays.map((x) => x.sales)) : 1;

  return (
    <>
      <PageHead title="Your results" sub="What VIBE customers have spent with you, and the money on its way to you."
        actions={<select aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last 12 months</option></select>} />
      {r.error ? <Notice tone="error">{r.error}</Notice> : null}
      {r.loading && !d ? <Loading /> : d ? (
        <div className="stack">
          <div className="stats">
            <div className="card"><span className="muted small">Sales through VIBE</span><strong>{formatINR(d.sales)}</strong><span className="muted small">{d.paidBills} paid bills</span></div>
            <div className="card"><span className="muted small">VIBE customers</span><strong>{d.customers}</strong><span className="muted small">{d.repeatCustomers} came back</span></div>
            <div className="card"><span className="muted small">Average bill</span><strong>{formatINR(d.averageBill)}</strong></div>
            <div className="card"><span className="muted small">Discount you gave</span><strong>{formatINR(d.discountGiven + (d.codeDiscountGiven ?? 0))}</strong></div>
            <div className="card"><span className="muted small">Codes redeemed at the counter</span><strong>{d.codesRedeemed ?? 0}</strong></div>
            <div className="card"><span className="muted small">Your rating</span><strong>{d.reviewCount ? `${(d.rating ?? 0).toFixed(1)} ★` : '–'}</strong><span className="muted small">{d.reviewCount ?? 0} ratings</span></div>
          </div>

          <div className="card stack">
            <h2>Sales, last 14 days</h2>
            <div className="bars" role="img" aria-label={`Daily sales through VIBE for the last 14 days, up to ${formatINR(max)}`}>
              {d.lastDays.map((x) => (
                <div key={x.day} className={`bar${x.sales === 0 ? ' zero' : ''}`} style={{ height: `${Math.max(3, (x.sales / max) * 100)}%` }} title={`${dayLabel(x.day)}: ${formatINR(x.sales)} (${x.bills} bills)`} />
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted small">{dayLabel(d.lastDays[0].day)}</span><span className="muted small">{dayLabel(d.lastDays[13].day)}</span></div>
          </div>

          <div className="grid2">
            <div className="card stack">
              <h2>Money</h2>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>Not settled yet</span><strong>{formatINR(d.unsettled.payout)}</strong></div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>Transfer on its way</span><strong>{formatINR(d.awaitingPayout)}</strong></div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>Paid to your bank so far</span><strong>{formatINR(d.paidOut)}</strong></div>
              <Link to="/settlements" className="small">See settlements</Link>
            </div>
            <div className="card stack">
              <h2>On VIBE now</h2>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>Offers live</span><strong>{d.offersLive}</strong></div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>Offers waiting for VIBE’s review</span><strong>{d.offersPending}</strong></div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>Upcoming events live</span><strong>{d.eventsLive}</strong></div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>Events waiting for review</span><strong>{d.eventsPending}</strong></div>
            </div>
          </div>

          {d.offers.length > 0 ? (
            <div className="card stack">
              <h2>How each offer is doing</h2>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Offer</th><th>Redeems started</th><th>Paid</th><th>Sales</th><th>Discount given</th></tr></thead>
                  <tbody>
                    {d.offers.map((o) => (
                      <tr key={o.offerId}>
                        <td>{o.title} {o.live ? <Badge tone="success">Live</Badge> : o.reviewStatus === 'pending' ? <Badge tone="warning">In review</Badge> : o.reviewStatus === 'rejected' ? <Badge>Not approved</Badge> : <Badge>Not live</Badge>}</td>
                        <td>{o.redemptions}</td>
                        <td>{o.paid}</td>
                        <td>{formatINR(o.sales)}</td>
                        <td>{formatINR(o.discount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
