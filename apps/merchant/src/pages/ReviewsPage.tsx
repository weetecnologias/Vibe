import { useState } from 'react';

import { Badge, Loading, Notice, PageHead, errorText, showDateTime, useAsync, useAuth, type MerchantReviews } from '@kit';

const stars = (n: number) => '★'.repeat(n) + '☆'.repeat(5 - n);

/** Ratings from customers who redeemed here (code confirmed or bill paid). Shown on your page in the app; VIBE removes ones that break the rules. */
export function ReviewsPage() {
  const { client } = useAuth();
  const r = useAsync(() => client.get<MerchantReviews>('/v1/merchant/reviews'), [client]);
  const d = r.data;
  const max = d ? Math.max(1, ...d.stats.byStars) : 1;

  return (
    <>
      <PageHead title="Reviews" sub="Ratings from customers after a visit through VIBE. Only real visits can be rated, once each." />
      {r.error ? <Notice tone="error">{r.error}</Notice> : null}
      {r.loading && !d ? <Loading /> : d ? (
        <div className="stack">
          <div className="grid2">
            <div className="card stack" style={{ gap: 4 }}>
              <span className="muted small">Your rating</span>
              <strong style={{ fontSize: 34 }}>{d.stats.count ? d.stats.average.toFixed(1) : '–'}</strong>
              <span className="stars" aria-label={`${d.stats.average} out of 5`}>{stars(Math.round(d.stats.average))}</span>
              <span className="muted small">{d.stats.count} rating{d.stats.count === 1 ? '' : 's'} shown in the app</span>
            </div>
            <div className="card stack" style={{ gap: 6 }}>
              {[5, 4, 3, 2, 1].map((n) => (
                <div key={n} className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
                  <span className="small" style={{ width: 28 }}>{n}★</span>
                  <div className="meter" style={{ flex: 1, maxWidth: 'none', marginTop: 0 }}><span style={{ width: `${(d.stats.byStars[n - 1] / max) * 100}%` }} /></div>
                  <span className="small muted" style={{ width: 24, textAlign: 'right' }}>{d.stats.byStars[n - 1]}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="stack">
            {d.items.map((i) => (
              <div key={i.id} className={`card stack${i.hidden ? ' dim' : ''}`} style={{ gap: 6 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span><span className="stars">{stars(i.rating)}</span> <strong>{i.customerName}</strong> <span className="muted small">· {i.offerTitle} · {i.mode === 'code' ? 'code at the counter' : 'paid in VIBE'}</span></span>
                  <span className="muted small">{showDateTime(i.createdAt)}</span>
                </div>
                {i.comment ? <p style={{ margin: 0 }}>{i.comment}</p> : <span className="muted small">No comment.</span>}
                {i.hidden ? <Badge>Removed by VIBE{i.hiddenReason ? `: ${i.hiddenReason}` : ''}</Badge> : null}
              </div>
            ))}
            {d.items.length === 0 ? <div className="card muted">No ratings yet. Customers are asked to rate their visit after a code is confirmed or a bill is paid.</div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Whether customers can get their bill in the app and pay through VIBE. Off: they redeem with a code and pay at the counter. */
export function PaymentSettingCard() {
  const { client } = useAuth();
  const s = useAsync(() => client.get<{ acceptsVibePayments: boolean }>('/v1/merchant/business/payment-setting'), [client]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = s.data?.acceptsVibePayments ?? true;
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try { await client.put('/v1/merchant/business/payment-setting', { acceptsVibePayments: !on }); s.reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="card stack">
      <h2>How customers redeem your offers</h2>
      <p className="muted small" style={{ margin: 0 }}>Customers can always show a code and pay you at the counter. You can also let them get the bill in the VIBE app and pay there; that money is settled to your bank.</p>
      {s.loading && !s.data ? <Loading /> : (
        <label className="check">
          <input type="checkbox" checked={on} disabled={busy} onChange={toggle} /> Let customers pay their bill through VIBE
        </label>
      )}
      {!on ? <Notice tone="info">Customers see only the code option for your offers.</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
