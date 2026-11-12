import { useEffect, useRef, useState } from 'react';

import {
  Badge, Field, Loading, Modal, Notice, PageHead, errorText, formatINR, rupeesToPaise, useAsync, useAuth,
  type BillBoard, type BillInput, type BillPreview, type BillRow, type CodeCheck, type MenuRow,
} from '@kit';

import { useSettings } from '../settings';

const REFRESH_MS = 4000;

const ago = (iso: string, ahead = false) => {
  if (ahead) {
    const m = Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 60_000));
    return m <= 1 ? 'in under a minute' : `in ${m} min`;
  }
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
  const [confirming, setConfirming] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [howTo, setHowTo] = useState(false);

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
      <PageHead title="Bills and codes" sub="Customers redeeming an offer show up here: with a code (they pay you at the counter; you confirm the code) or asking for the bill (you send it; they pay in VIBE)." actions={<button className="btn ghost" onClick={() => setHowTo(!howTo)}>{howTo ? 'Hide how it works' : 'How it works'}</button>} />
      <CodeBox onFound={(id) => { setError(null); setConfirming(id); }} />
      {howTo || (board.data && board.data.rows.length === 0 && view === 'open' && !term) ? <HowABillStarts /> : null}
      <div className="stats">
        <div className="card"><span className="muted small">Paid today</span><strong>{s?.paidToday ?? '–'}</strong></div>
        <div className="card"><span className="muted small">Collected today</span><strong>{s ? formatINR(s.paidTodayAmount) : '–'}</strong></div>
        <div className="card"><span className="muted small">Customers saved</span><strong>{s ? formatINR(s.savedTodayAmount) : '–'}</strong></div>
        <div className="card"><span className="muted small">Codes redeemed today</span><strong>{s?.redeemedToday ?? '–'}</strong></div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={view === 'open'} className={`tab${view === 'open' ? ' on' : ''}`} onClick={() => setView('open')}>Waiting</button>
        <button role="tab" aria-selected={view === 'today'} className={`tab${view === 'today' ? ' on' : ''}`} onClick={() => setView('today')}>Done today</button>
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
            <thead><tr><th>Customer</th><th>Offer</th><th>{view === 'today' ? 'Done' : 'Waiting'}</th><th>Bill or code</th><th /></tr></thead>
            <tbody>
              {board.data?.rows.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.customerName}</strong><div className="muted small">VIBE ID {r.vibeId}</div></td>
                  <td className="small">{r.offerTitle}</td>
                  <td className="small">{(r.status === 'paid' || r.status === 'redeemed') && r.paidAt ? ago(r.paidAt) : ago(r.requestedAt)}</td>
                  <td>
                    {r.mode === 'code' ? (
                      r.status === 'redeemed' ? (
                        <>
                          <Badge tone="success">Code redeemed</Badge>
                          <div className="muted small" style={{ marginTop: 4 }}>{r.billAmount ? `Bill ${formatINR(r.billAmount)}${r.discountGiven ? ` · gave ${formatINR(r.discountGiven)} off` : ''}` : 'Paid at the counter'}</div>
                        </>
                      ) : (
                        <>
                          <div className="code-chip" aria-label={`Code ${r.code}`}>{r.code ? `${r.code.slice(0, 3)} ${r.code.slice(3)}` : '—'}</div>
                          <div className="muted small" style={{ marginTop: 4 }}>Pays at the counter · code ends {ago(r.expiresAt, true)}</div>
                        </>
                      )
                    ) : r.bill ? (
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
                    {r.status === 'code_issued' ? <button className="btn primary sm" onClick={() => { setError(null); setConfirming(r.id); }}>Yes, redeemed</button> : null}
                    {r.status === 'bill_ready' ? <button className="btn ghost sm danger" onClick={() => withdraw(r)}>Withdraw bill</button> : null}
                  </td>
                </tr>
              ))}
              {board.data?.rows.length === 0 ? (
                <tr><td colSpan={5} className="muted">{view === 'today' ? 'No payments or codes yet today.' : term ? 'No waiting customer matches that.' : 'No one is waiting. When a customer taps Redeem in the app, they appear here.'}</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">This list refreshes by itself every few seconds. The customer is told in the app when you send a bill, and you see here when they have paid. Push notifications arrive when the notification service is connected.</p>

      {billing ? <RaiseBill row={billing} onClose={() => setBilling(null)} onSent={(msg) => { setBilling(null); setNotice(msg); board.reload(); }} /> : null}
      {confirming ? <ConfirmCode row={board.data?.rows.find((r) => r.id === confirming) ?? null} id={confirming} onClose={() => setConfirming(null)} onDone={(msg) => { setConfirming(null); setNotice(msg); board.reload(); }} /> : null}
    </>
  );
}

/** What staff tell a customer who wants to pay through VIBE. The customer starts it, so VIBE knows who is paying and which offer applies. */
function HowABillStarts() {
  return (
    <div className="card stack" style={{ marginBottom: 14 }}>
      <strong>Two ways a customer redeems an offer</strong>
      <div className="grid2">
        <div>
          <strong className="small">With a code: they pay you</strong>
          <ol className="steps">
            <li>The customer taps <strong>Redeem</strong> in the VIBE app and chooses <strong>Show a code</strong>. They get a 6-digit code that works for 5 minutes.</li>
            <li>They appear here with the code, and you get an alert. Type the code above, or tap <strong>Yes, redeemed</strong> on their row.</li>
            <li>Optionally type their bill to see the discount to give. Take payment as usual.</li>
          </ol>
        </div>
        <div>
          <strong className="small">With a bill: they pay in VIBE</strong>
          <ol className="steps">
            <li>The customer chooses <strong>Get the bill in VIBE</strong>. They appear here under Waiting.</li>
            <li>Tap <strong>Raise bill</strong>, pick what they had and send it. VIBE works out the discount.</li>
            <li>They pay on their phone. The money comes to you in your next settlement.</li>
          </ol>
        </div>
      </div>
      <span className="muted small">Either way, the customer is asked to rate their visit afterwards. A wrong bill can be withdrawn until they start paying.</span>
    </div>
  );
}

/** Staff type the code the customer shows. */
function CodeBox({ onFound }: { onFound: (id: string) => void }) {
  const { client } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const c = await client.post<CodeCheck>('/v1/merchant/bills/codes/check', { code });
      setCode('');
      onFound(c.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card stack" style={{ marginBottom: 14 }}>
      <form className="row" onSubmit={find}>
        <strong style={{ marginRight: 6 }}>Customer has a code?</strong>
        <input style={{ maxWidth: 200, letterSpacing: 2 }} inputMode="numeric" placeholder="6-digit code" aria-label="Redeem code" value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9 ]/g, '').slice(0, 7))} />
        <button className="btn primary" disabled={busy || code.replace(/\D/g, '').length !== 6}>{busy ? 'Checking…' : 'Check code'}</button>
      </form>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}

/** "Yes, redeemed": who it is, which offer, and (if staff type the bill) the discount to give at the counter. */
function ConfirmCode({ id, row, onClose, onDone }: { id: string; row: BillRow | null; onClose: () => void; onDone: (message: string) => void }) {
  const { client } = useAuth();
  const [bill, setBill] = useState('');
  const [check, setCheck] = useState<CodeCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = bill.trim() ? rupeesToPaise(bill) : null;

  useEffect(() => {
    if (!row?.code) return;
    const t = setTimeout(() => {
      client.post<CodeCheck>('/v1/merchant/bills/codes/check', { code: row.code, billAmount: amount ?? undefined }).then(setCheck, (e) => setError(errorText(e)));
    }, 300);
    return () => clearTimeout(t);
  }, [client, row?.code, amount]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await client.post<CodeCheck>(`/v1/merchant/bills/${id}/redeem`, { billAmount: amount ?? undefined });
      onDone(`Code ${r.code.slice(0, 3)} ${r.code.slice(3)} redeemed for ${r.customerName.replace(/\.$/, '')}.${r.discount ? ` Give ${formatINR(r.discount)} off.` : ''} They’ll be asked to rate their visit.`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const who = check ?? (row ? { customerName: row.customerName, vibeId: row.vibeId, offerTitle: row.offerTitle, code: row.code ?? '' } : null);
  return (
    <Modal title="Confirm the code" onClose={onClose}>
      <div className="stack">
        {who ? (
          <div className="card stack" style={{ gap: 4 }}>
            <div className="code-chip big">{who.code ? `${who.code.slice(0, 3)} ${who.code.slice(3)}` : ''}</div>
            <strong>{who.customerName}{who.vibeId ? <span className="muted small"> · VIBE ID {who.vibeId}</span> : null}</strong>
            <span className="small">{who.offerTitle}</span>
          </div>
        ) : null}
        <Field label="Their bill (optional)" hint="Type it to see the discount to give. It’s kept for your reports; no money goes through VIBE for a code.">
          <input style={{ maxWidth: 200 }} inputMode="decimal" placeholder="₹" value={bill} onChange={(e) => setBill(e.target.value)} />
        </Field>
        {check && check.discount !== null ? (
          <div className="card" style={{ background: 'var(--soft-white)' }}>
            {check.discount > 0 ? <div className="row" style={{ justifyContent: 'space-between' }}><span>Give the customer</span><strong style={{ color: 'var(--pink-deep)' }}>{formatINR(check.discount)} off</strong></div> : <span className="muted">{check.reason ?? 'No discount on this bill.'}</span>}
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 6 }}><span>They pay you</span><strong>{formatINR(check.customerPays ?? 0)}</strong></div>
          </div>
        ) : null}
        {bill.trim() && amount === null ? <Notice tone="error">Type the bill in rupees, like 1250.</Notice> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Not yet</button>
          <button className="btn primary" disabled={busy || (bill.trim() !== '' && amount === null)} onClick={confirm}>{busy ? 'Confirming…' : 'Yes, redeemed'}</button>
        </div>
      </div>
    </Modal>
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
  const { menuLabel } = useSettings();
  const menu = useAsync(() => client.get<MenuRow[]>('/v1/merchant/menu'), [client]);
  const items = (menu.data ?? []).filter((m) => m.active);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<'pick' | 'type'>('pick');
  const picked = items.filter((m) => (qty[m.id] ?? 0) > 0);
  const useMenu = mode === 'pick' && items.length > 0;
  const sections = [...new Set(items.map((m) => m.section ?? ''))];
  const bump = (id: string, d: number) => { setConfirmed(false); setQty({ ...qty, [id]: Math.max(0, Math.min(50, (qty[id] ?? 0) + d)) }); };

  const parsed: { label: string; amount: number | null }[] = useMenu
    ? picked.map((m) => ({ label: (qty[m.id] ?? 0) > 1 ? `${m.name} × ${qty[m.id]}` : m.name, amount: m.price * (qty[m.id] ?? 0) }))
    : lines.map((l) => ({ label: l.label.trim(), amount: rupeesToPaise(l.amount) }));
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
        {items.length > 0 ? (
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'pick'} className={`tab${mode === 'pick' ? ' on' : ''}`} onClick={() => { setConfirmed(false); setMode('pick'); }}>From the {menuLabel.toLowerCase()}</button>
            <button type="button" role="tab" aria-selected={mode === 'type'} className={`tab${mode === 'type' ? ' on' : ''}`} onClick={() => { setConfirmed(false); setMode('type'); }}>Type amounts</button>
          </div>
        ) : null}
        {useMenu ? (
          <div className="stack" style={{ maxHeight: 280, overflow: 'auto' }}>
            {sections.map((sec) => (
              <div key={sec || 'other'} className="stack" style={{ gap: 4 }}>
                {sec ? <strong className="small">{sec}</strong> : null}
                {items.filter((m) => (m.section ?? '') === sec).map((m) => (
                  <div key={m.id} className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                    <span>{m.name} <span className="muted small">{formatINR(m.price)}</span></span>
                    <span className="row" style={{ flexWrap: 'nowrap', gap: 6 }}>
                      <button type="button" className="btn sm" aria-label={`Fewer ${m.name}`} disabled={!(qty[m.id] ?? 0)} onClick={() => bump(m.id, -1)}>−</button>
                      <span style={{ minWidth: 20, textAlign: 'center' }} aria-live="polite">{qty[m.id] ?? 0}</span>
                      <button type="button" className="btn sm" aria-label={`More ${m.name}`} onClick={() => bump(m.id, 1)}>+</button>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : null}
        {!useMenu ? lines.map((l, i) => (
          <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
            <input aria-label={`Item ${i + 1} name`} value={l.label} maxLength={80} placeholder="Item" onChange={(e) => setLine(i, { label: e.target.value })} />
            <input aria-label={`Item ${i + 1} amount in rupees`} style={{ maxWidth: 140 }} inputMode="decimal" value={l.amount} placeholder="₹" onChange={(e) => setLine(i, { amount: e.target.value })} autoFocus={i === 0} />
            {lines.length > 1 ? <button type="button" className="btn ghost sm" aria-label={`Remove item ${i + 1}`} onClick={() => { setConfirmed(false); setLines(lines.filter((_, j) => j !== i)); }}>✕</button> : null}
          </div>
        )) : null}
        {!useMenu ? <div className="row"><button type="button" className="btn sm" disabled={lines.length >= 30} onClick={() => setLines([...lines, { label: '', amount: '' }])}>Add another item</button></div> : null}
        <Field label="Your bill number (optional)" hint="For example the table or the number on your own bill."><input style={{ maxWidth: 260 }} value={billRef} maxLength={40} onChange={(e) => setBillRef(e.target.value)} /></Field>

        <div className="card" style={{ background: 'var(--soft-white)' }} aria-live="polite">
          {!body ? <span className="muted">{useMenu ? 'Pick what they ordered.' : 'Enter an amount for every item.'}</span> : previewError ? <span style={{ color: 'var(--error)' }}>{previewError}</span> : !fresh ? <span className="muted">Checking…</span> : (
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
