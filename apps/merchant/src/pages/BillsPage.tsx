import { useEffect, useRef, useState } from 'react';

import {
  Badge, Field, Loading, Modal, Notice, PageHead, errorText, formatINR, rupeesToPaise, useAsync, useAuth,
  type BillBoard, type BillInput, type BillPreview, type BillRow,
} from '@kit';

const REFRESH_MS = 4000;

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  return m < 1 ? 'just now' : m === 1 ? '1 min ago' : `${m} min ago`;
};

type Line = { label: string; amount: string };

/**
 * The screen staff use at the table. A customer taps Redeem in the app and appears here. Staff enter the bill, check what the customer will pay,
 * and send it. The customer's app shows it straight away. The discount is worked out by VIBE, never typed.
 */
export function BillsPage() {
  const { client } = useAuth();
  const [view, setView] = useState<'open' | 'today'>('open');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const board = useAsync(() => client.get<BillBoard>(`/v1/merchant/bills?view=${view}${term ? `&q=${encodeURIComponent(term)}` : ''}`), [client, view, term]);
  const [billing, setBilling] = useState<BillRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // New customers appear and payments land without anyone pressing refresh.
  const reload = board.reload;
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) reload(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);

  const withdraw = async (r: BillRow) => {
    if (!window.confirm(`Withdraw the bill for ${r.customerName}? They can’t pay it, and you can send a corrected one.`)) return;
    setError(null);
    try {
      await client.post(`/v1/merchant/bills/${r.id}/withdraw`);
      setNotice(`Bill withdrawn for ${r.customerName}.`);
      board.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const s = board.data?.summary;

  return (
    <>
      <PageHead title="Bills" sub="Customers who tapped Redeem in the VIBE app show up here. Enter their bill and send it: they see it in the app and pay there." />
      <div className="stats">
        <div className="card"><span className="muted small">Paid today</span><strong>{s?.paidToday ?? '–'}</strong></div>
        <div className="card"><span className="muted small">Collected today</span><strong>{s ? formatINR(s.paidTodayAmount) : '–'}</strong></div>
        <div className="card"><span className="muted small">Customers saved</span><strong>{s ? formatINR(s.savedTodayAmount) : '–'}</strong></div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={view === 'open'} className={`tab${view === 'open' ? ' on' : ''}`} onClick={() => setView('open')}>Waiting</button>
        <button role="tab" aria-selected={view === 'today'} className={`tab${view === 'today' ? ' on' : ''}`} onClick={() => setView('today')}>Paid today</button>
      </div>
      {view === 'open' ? (
        <form className="row" style={{ marginBottom: 12 }} onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
          <input style={{ maxWidth: 300 }} placeholder="Find by VIBE ID or first name" aria-label="Find a customer" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn">Find</button>
          {term ? <button type="button" className="btn ghost" onClick={() => { setQ(''); setTerm(''); }}>Clear</button> : null}
        </form>
      ) : null}

      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error && !billing ? <Notice tone="error">{error}</Notice> : null}
      {board.error ? <Notice tone="error">{board.error}</Notice> : null}
      {board.loading && !board.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Customer</th><th>Offer</th><th>{view === 'today' ? 'Paid' : 'Waiting'}</th><th>Bill</th><th /></tr></thead>
            <tbody>
              {board.data?.rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.customerName}</strong><div className="muted small">VIBE ID {r.vibeId}</div></td>
                  <td className="small">{r.offerTitle}</td>
                  <td className="small">{r.status === 'paid' && r.paidAt ? ago(r.paidAt) : ago(r.requestedAt)}</td>
                  <td>
                    {r.bill ? (
                      <>
                        <strong>{formatINR(r.bill.payable)}</strong>
                        <div className="muted small">{r.bill.discount > 0 ? `${formatINR(r.bill.eligibleAmount)} − ${formatINR(r.bill.discount)} discount` : formatINR(r.bill.eligibleAmount)}</div>
                      </>
                    ) : <Badge tone="warning">Waiting for your bill</Badge>}
                    {r.bill && r.status !== 'paid' ? (
                      <div style={{ marginTop: 4 }}>
                        {r.bill.paymentStatus === 'pending' ? <Badge tone="pink">Customer is paying</Badge> : r.bill.paymentStatus === 'failed' ? <Badge>Payment didn’t go through</Badge> : <Badge tone="warning">Waiting for customer to pay</Badge>}
                      </div>
                    ) : null}
                    {r.status === 'paid' ? <div style={{ marginTop: 4 }}><Badge tone="success">Paid</Badge></div> : null}
                  </td>
                  <td className="actions">
                    {r.status === 'awaiting_bill' ? <button className="btn primary sm" onClick={() => { setError(null); setBilling(r); }}>Raise bill</button> : null}
                    {r.status === 'bill_ready' ? <button className="btn ghost sm danger" onClick={() => withdraw(r)}>Withdraw bill</button> : null}
                  </td>
                </tr>
              ))}
              {board.data?.rows.length === 0 ? (
                <tr><td colSpan={5} className="muted">{view === 'today' ? 'No payments yet today.' : term ? 'No waiting customer matches that.' : 'No one is waiting. When a customer taps Redeem in the app, they appear here.'}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">This list refreshes by itself every few seconds. The customer is told in the app when you send a bill, and you see here when they have paid. Push notifications arrive when the notification service is connected.</p>

      {billing ? <RaiseBill row={billing} onClose={() => setBilling(null)} onSent={(msg) => { setBilling(null); setNotice(msg); board.reload(); }} /> : null}
    </>
  );
}

function RaiseBill({ row, onClose, onSent }: { row: BillRow; onClose: () => void; onSent: (message: string) => void }) {
  const { client } = useAuth();
  const [lines, setLines] = useState<Line[]>([{ label: 'Bill total', amount: '' }]);
  const [billRef, setBillRef] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [preview, setPreview] = useState<BillPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const parsed = lines.map((l) => ({ label: l.label.trim(), amount: rupeesToPaise(l.amount) }));
  const valid = parsed.length > 0 && parsed.every((l) => l.label && l.amount !== null && l.amount > 0);
  const total = valid ? parsed.reduce((n, l) => n + (l.amount ?? 0), 0) : 0;
  const body: BillInput | null = valid ? { lines: parsed.map((l) => ({ label: l.label, amount: l.amount as number })), billRef: billRef.trim() || undefined } : null;
  const key = JSON.stringify(body);

  // Ask VIBE what the customer would pay, a moment after the amounts stop changing.
  useEffect(() => {
    if (!body) return;
    const mine = ++seq.current;
    const t = setTimeout(() => {
      client.post<BillPreview>(`/v1/merchant/bills/${row.id}/preview`, body).then(
        (p) => { if (seq.current === mine) { setPreview(p); setPreviewError(null); } },
        (e) => { if (seq.current === mine) { setPreview(null); setPreviewError(errorText(e)); } },
      );
    }, 350);
    return () => clearTimeout(t);
    // `key` encodes the bill; `client` and `row.id` are stable for this dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setLine = (i: number, patch: Partial<Line>) => { setConfirmed(false); setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l))); };

  const send = async () => {
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await client.post(`/v1/merchant/bills/${row.id}`, { ...body, confirmLarge: confirmed });
      onSent(`Bill sent to ${row.customerName}. It’s on their phone now.`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const fresh = !!preview && !!body && preview.eligibleAmount === total;

  return (
    <Modal title={`Bill for ${row.customerName}`} onClose={onClose} wide>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>VIBE ID {row.vibeId} · {row.offerTitle}. Enter what they ordered. VIBE works out the discount.</p>
        {lines.map((l, i) => (
          <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
            <input aria-label={`Item ${i + 1} name`} value={l.label} maxLength={80} placeholder="Item" onChange={(e) => setLine(i, { label: e.target.value })} />
            <input aria-label={`Item ${i + 1} amount in rupees`} style={{ maxWidth: 140 }} inputMode="decimal" value={l.amount} placeholder="₹" onChange={(e) => setLine(i, { amount: e.target.value })} autoFocus={i === 0} />
            {lines.length > 1 ? <button type="button" className="btn ghost sm" aria-label={`Remove item ${i + 1}`} onClick={() => { setConfirmed(false); setLines(lines.filter((_, j) => j !== i)); }}>✕</button> : null}
          </div>
        ))}
        <div className="row"><button type="button" className="btn sm" disabled={lines.length >= 30} onClick={() => setLines([...lines, { label: '', amount: '' }])}>Add another item</button></div>
        <Field label="Your bill number (optional)" hint="For example the table or the number on your own bill."><input style={{ maxWidth: 260 }} value={billRef} maxLength={40} onChange={(e) => setBillRef(e.target.value)} /></Field>

        <div className="card" style={{ background: 'var(--soft-white)' }} aria-live="polite">
          {!body ? <span className="muted">Enter an amount for every item.</span> : previewError ? <span style={{ color: 'var(--error)' }}>{previewError}</span> : !fresh ? <span className="muted">Checking…</span> : (
            <div className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>Bill</span><strong>{formatINR(preview.eligibleAmount)}</strong></div>
              <div className="row" style={{ justifyContent: 'space-between' }}><span>{preview.discountLabel}</span><strong style={{ color: 'var(--pink-deep)' }}>{preview.discount > 0 ? `− ${formatINR(preview.discount)}` : '₹0'}</strong></div>
              {preview.vibeFee > 0 ? <div className="row" style={{ justifyContent: 'space-between' }}><span>VIBE fee</span><strong>{formatINR(preview.vibeFee)}</strong></div> : null}
              <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--hairline)', paddingTop: 8 }}><span>Customer pays</span><strong style={{ fontSize: 22 }}>{formatINR(preview.customerPays)}</strong></div>
              {preview.reason ? <span className="muted small">{preview.reason}. The customer pays the full amount.</span> : null}
            </div>
          )}
        </div>

        {fresh && preview.needsConfirmation ? (
          <label className="check"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> This is a large bill. I’ve checked the amount is {formatINR(preview.eligibleAmount)}.</label>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !fresh || (preview.needsConfirmation && !confirmed)} onClick={send}>{busy ? 'Sending…' : 'Send bill to customer'}</button>
        </div>
      </div>
    </Modal>
  );
}
