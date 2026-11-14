import { useState } from 'react';

import {
  Badge, DownloadButton, Field, Loading, Modal, Notice, PageHead, bpsToPercent, errorText, formatINR, rupeesToPaise, showDateTime, useAsync, useAuth,
  type AdjustmentRow, type PayRunHeld, type PayRunResult, type SettlementDetail, type SettlementDue, type SettlementSummary,
} from '@kit';

import { useWorkspace } from '../workspace';

type Tab = 'due' | 'pending' | 'paid';

/** The weekly pay cycle: payments up to the end of last Sunday, India time, are paid the following week. */
function endOfLastWeek(): string {
  const now = new Date(Date.now() + 330 * 60_000); // India time, read through UTC fields
  const daysSinceMonday = (now.getUTCDay() + 6) % 7;
  const monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday);
  return new Date(monday - 330 * 60_000).toISOString(); // Monday 00:00 India time = the end of Sunday
}

/**
 * Paying merchants. Every confirmed payment at a business is owed to it, less VIBE's fee and commission. "To settle" shows what each business is owed;
 * drawing up a settlement fixes that list (a payment is never settled twice) and tells the merchant; recording the bank transfer marks it paid and tells them again.
 */
export function SettlementsPage() {
  const { client } = useAuth();
  const [tab, setTab] = useState<Tab>('due');
  const due = useAsync(() => (tab === 'due' ? client.get<SettlementDue[]>('/v1/admin/settlements/due') : Promise.resolve([] as SettlementDue[])), [client, tab]);
  const list = useAsync(() => (tab === 'due' ? Promise.resolve([] as SettlementSummary[]) : client.get<SettlementSummary[]>(`/v1/admin/settlements?status=${tab}`)), [client, tab]);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState<SettlementDue | null>(null);
  const [adjusting, setAdjusting] = useState<SettlementDue | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { current } = useWorkspace();
  const [held, setHeld] = useState<PayRunHeld[]>([]);
  const [running, setRunning] = useState(false);
  const [cutoff, setCutoff] = useState<'week' | 'now'>('week');
  const [runError, setRunError] = useState<string | null>(null);
  const totalDue = (due.data ?? []).reduce((n, d) => n + d.payout, 0);
  const totalShown = (list.data ?? []).reduce((n, s) => n + s.payout, 0);
  const ready = (due.data ?? []).filter((d) => d.kycStatus === 'verified' && d.payout > 0);
  const readyTotal = ready.reduce((n, d) => n + d.payout, 0);
  const go = (t: Tab) => { setTab(t); setNotice(null); setRunError(null); };

  const runPay = async () => {
    setRunning(true);
    setRunError(null);
    try {
      const r = await client.post<PayRunResult>('/v1/admin/settlements/run', { businessIds: ready.map((d) => d.businessId), upTo: cutoff === 'week' ? endOfLastWeek() : null });
      setHeld(r.held);
      setNotice(`Pay run created: ${r.created.length} settlement${r.created.length === 1 ? '' : 's'}, ${formatINR(r.total)}. Each business has been told. Next, download the bank file and pay them.`);
      setTab('pending');
    } catch (e) {
      setRunError(errorText(e));
    } finally {
      setRunning(false);
    }
  };

  const STEPS: { key: Tab; n: string; title: string; sub: string }[] = [
    { key: 'due', n: 'Step 1', title: 'Review what’s owed', sub: due.data ? `${due.data.length} businesses · ${formatINR(totalDue)}` : 'What each business has earned' },
    { key: 'pending', n: 'Step 2', title: 'Pay from the bank', sub: 'Download the bank file, transfer, then enter the bank reference' },
    { key: 'paid', n: 'Step 3', title: 'Paid', sub: 'Settlements with a bank reference' },
  ];

  return (
    <>
      <PageHead title="Settlements" sub={`Paying businesses${current.id ? ` in ${current.name}` : ''} for what customers paid through VIBE. Each business is told when a settlement is drawn up and when it’s paid.`} />
      <div className="steps" role="tablist">
        {STEPS.map((s) => <button key={s.key} role="tab" aria-selected={tab === s.key} className={tab === s.key ? 'on' : ''} onClick={() => go(s.key)}><span className="n">{s.n}</span><strong>{s.title}</strong><span className="muted small">{s.sub}</span></button>)}
      </div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {held.length > 0 ? (
        <Notice tone="info">
          Held back from the pay run: {held.map((h) => `${h.businessName} (${h.reason})`).join('; ')}
        </Notice>
      ) : null}

      {tab === 'due' ? (
        <>
          <div className="card row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <div className="stack" style={{ gap: 2 }}>
              <strong>{ready.length ? `${ready.length} ready to pay: ${formatINR(readyTotal)}` : 'Nobody is ready to pay yet'}</strong>
              <span className="muted small">{(due.data?.length ?? 0) - ready.length > 0 ? `${(due.data?.length ?? 0) - ready.length} held: KYC and bank details not verified, or refunds more than sales. ` : ''}Creating the pay run draws up one settlement per business and tells each of them.</span>
            </div>
            <div className="row">
              <DownloadButton path="/v1/admin/exports/settlements-due" filename="vibe-to-settle.csv" label="Download Excel" />
              <select aria-label="Pay payments up to" style={{ maxWidth: 230 }} value={cutoff} onChange={(e) => setCutoff(e.target.value as 'week' | 'now')}><option value="week">Payments up to last Sunday</option><option value="now">Every payment so far</option></select>
              <button className="btn primary" disabled={running || ready.length === 0} onClick={runPay}>{running ? 'Creating…' : `Create pay run (${ready.length})`}</button>
            </div>
          </div>
          {runError ? <Notice tone="error">{runError}</Notice> : null}
          {due.error ? <Notice tone="error">{due.error}</Notice> : null}
          {due.loading && !due.data ? <Loading /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Merchant</th><th>Payments</th><th>Collected</th><th>VIBE commission</th><th>To pay</th><th>Since</th><th /></tr></thead>
                <tbody>
                  {due.data?.map((d) => (
                    <tr key={d.businessId}>
                      <td><strong>{d.businessName}</strong><div className="muted small">{d.area}</div>{d.kycStatus !== 'verified' ? <div><Badge tone="warning">{d.kycStatus === 'submitted' ? 'KYC waiting' : d.kycStatus === 'rejected' ? 'KYC sent back' : 'No KYC yet'}</Badge></div> : null}</td>
                      <td>{d.count}</td>
                      <td>{formatINR(d.gross)}{d.vibeFees > 0 ? <div className="muted small">incl. VIBE fees {formatINR(d.vibeFees)}</div> : null}</td>
                      <td>{formatINR(d.commission)}<div className="muted small">{bpsToPercent(d.commissionBps)}% now{d.gst > 0 ? ` · + GST ${formatINR(d.gst)}` : ''}</div></td>
                      <td><strong>{formatINR(d.payout)}</strong>{d.refundDeductions > 0 ? <div className="muted small">refunds − {formatINR(d.refundDeductions)}</div> : null}{d.adjustments !== 0 ? <div className="muted small">adjustments {d.adjustments > 0 ? '+' : '−'} {formatINR(Math.abs(d.adjustments))}</div> : null}</td>
                      <td className="small">{showDateTime(d.oldest)}</td>
                      <td className="actions"><button className="btn ghost sm" onClick={() => setAdjusting(d)}>Adjust</button><button className="btn primary sm" onClick={() => setCreating(d)}>Draw up settlement</button></td>
                    </tr>
                  ))}
                  {due.data?.length === 0 ? <tr><td colSpan={7} className="muted">Nothing to settle. Every confirmed payment is already in a settlement.</td></tr> : null}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small">Each payment keeps the commission and GST it was charged, from Rates and tax. Adjust adds a credit or a deduction (with a reason) to a business’s next settlement.</p>
        </>
      ) : (
        <>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <div className="stats" style={{ margin: 0 }}>
              <div className="card"><span className="muted small">Settlements</span><strong>{list.data?.length ?? '–'}</strong></div>
              <div className="card"><span className="muted small">{tab === 'pending' ? 'Still to transfer' : 'Transferred'}</span><strong>{list.data ? formatINR(totalShown) : '–'}</strong></div>
            </div>
            <div className="row">
              {tab === 'pending' ? <DownloadButton path="/v1/admin/settlements/bank-file.csv" filename="vibe-bank-file.csv" label="Download bank file" /> : null}
              <DownloadButton path={`/v1/admin/exports/settlements?status=${tab}`} filename={`vibe-settlements-${tab}.csv`} label="Download Excel" />
            </div>
          </div>
          {tab === 'pending' && (list.data?.length ?? 0) > 0 ? (
            <p className="muted small" style={{ marginTop: 0 }}>The bank file lists each business’s account holder, account number, IFSC and amount, ready for your bank’s bulk transfer. Each download is recorded in the audit log. After the transfer, open each settlement and enter the bank reference (UTR).</p>
          ) : null}
          {list.error ? <Notice tone="error">{list.error}</Notice> : null}
          {list.loading && !list.data ? <Loading /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Settlement</th><th>Merchant</th><th>Period</th><th>Payments</th><th>Payout</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {list.data?.map((s) => (
                    <tr key={s.id}>
                      <td><strong>{s.reference}</strong><div className="muted small">{showDateTime(s.createdAt)}</div></td>
                      <td>{s.businessName}</td>
                      <td className="small">{showDateTime(s.periodFrom)}<div className="muted">to {showDateTime(s.periodTo)}</div></td>
                      <td>{s.paymentCount}</td>
                      <td><strong>{formatINR(s.payout)}</strong><div className="muted small">commission {formatINR(s.commission)}</div></td>
                      <td>{s.status === 'paid' ? <><Badge tone="success">Paid</Badge><div className="muted small">{s.payoutRef}</div></> : <Badge tone="warning">To transfer</Badge>}</td>
                      <td className="actions"><button className="btn ghost sm" onClick={() => setOpen(s.id)}>{s.status === 'pending' ? 'Open and pay' : 'Open'}</button></td>
                    </tr>
                  ))}
                  {list.data?.length === 0 ? <tr><td colSpan={7} className="muted">{tab === 'pending' ? 'No settlements waiting to be paid.' : 'No settlements paid yet.'}</td></tr> : null}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {creating ? (
        <CreateSettlement due={creating} onClose={() => setCreating(null)} onCreated={(d) => { setCreating(null); setNotice(`Settlement ${d.summary.reference} drawn up for ${d.summary.businessName}. They have been told.`); due.reload(); setOpen(d.summary.id); }} />
      ) : null}
      {adjusting ? <AddAdjustment due={adjusting} onClose={() => setAdjusting(null)} onSaved={(a) => { setAdjusting(null); setNotice(`${a.kind === 'credit' ? 'Credit' : 'Deduction'} of ${formatINR(Math.abs(a.amount))} added for ${a.businessName}. It goes in their next settlement.`); due.reload(); }} /> : null}
      {open ? <SettlementModal id={open} onClose={() => setOpen(null)} onPaid={(d) => { setNotice(`${d.summary.reference} marked as paid. ${d.summary.businessName} has been told.`); list.reload(); }} /> : null}
    </>
  );
}

function CreateSettlement({ due, onClose, onCreated }: { due: SettlementDue; onClose: () => void; onCreated: (d: SettlementDetail) => void }) {
  const { client } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    setError(null);
    try { onCreated(await client.post<SettlementDetail>('/v1/admin/settlements', { businessId: due.businessId })); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Settle ${due.businessName}`} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>This gathers every confirmed payment at {due.businessName} so far into one settlement. Each payment can only ever be in one settlement.</p>
        <div className="card stack" style={{ gap: 6 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><span>{due.count} payments collected</span><strong>{formatINR(due.gross)}</strong></div>
          {due.vibeFees > 0 ? <div className="row" style={{ justifyContent: 'space-between' }}><span>VIBE fees paid by customers</span><strong>− {formatINR(due.vibeFees)}</strong></div> : null}
          <div className="row" style={{ justifyContent: 'space-between' }}><span>VIBE commission</span><strong>− {formatINR(due.commission)}</strong></div>
          {due.gst > 0 ? <div className="row" style={{ justifyContent: 'space-between' }}><span>GST on commission</span><strong>− {formatINR(due.gst)}</strong></div> : null}
          {due.refundDeductions > 0 ? <div className="row" style={{ justifyContent: 'space-between' }}><span>Refunds the business bears</span><strong>− {formatINR(due.refundDeductions)}</strong></div> : null}
          {due.adjustments !== 0 ? <div className="row" style={{ justifyContent: 'space-between' }}><span>Adjustments</span><strong>{due.adjustments > 0 ? '+' : '−'} {formatINR(Math.abs(due.adjustments))}</strong></div> : null}
          <div className="row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--hairline)', paddingTop: 8 }}><span>To pay {due.businessName}</span><strong style={{ fontSize: 20 }}>{formatINR(due.payout)}</strong></div>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy} onClick={create}>{busy ? 'Drawing up…' : 'Draw up settlement'}</button>
        </div>
      </div>
    </Modal>
  );
}

export function SettlementModal({ id, onClose, onPaid }: { id: string; onClose: () => void; onPaid: (d: SettlementDetail) => void }) {
  const { client } = useAuth();
  const d = useAsync(() => client.get<SettlementDetail>(`/v1/admin/settlements/${id}`), [client, id]);
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = d.data?.summary;

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await client.post<SettlementDetail>(`/v1/admin/settlements/${id}/paid`, { payoutRef: ref.trim(), note: note.trim() || null });
      onPaid(r);
      d.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={s ? `${s.reference} · ${s.businessName}` : 'Settlement'} onClose={onClose} wide>
      {d.loading && !d.data ? <Loading /> : d.error && !d.data ? <Notice tone="error">{d.error}</Notice> : s && d.data ? (
        <div className="stack">
          <div className="stats">
            <div className="card"><span className="muted small">Collected</span><strong>{formatINR(s.gross)}</strong></div>
            <div className="card"><span className="muted small">Commission ({bpsToPercent(s.commissionBps)}%)</span><strong>{formatINR(s.commission)}</strong></div>
            <div className="card"><span className="muted small">Payout</span><strong>{formatINR(s.payout)}</strong></div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">{s.paymentCount} payments, {showDateTime(s.periodFrom)} to {showDateTime(s.periodTo)}. Customers saved {formatINR(s.customerSavings)}.</span>
            <DownloadButton small path={`/v1/admin/exports/settlements/${id}`} filename={`${s.reference}.csv`} />
          </div>
          <div className="table-wrap" style={{ maxHeight: 280, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Transaction ID</th><th>Customer</th><th>Offer</th><th>Collected</th><th>Commission</th><th>Payout</th></tr></thead>
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
          {s.status === 'paid' ? (
            <Notice tone="success">Paid {s.paidAt ? showDateTime(s.paidAt) : ''}. Bank reference {s.payoutRef}.{s.note ? ` ${s.note}` : ''}</Notice>
          ) : (
            <div className="card stack">
              <strong>Record the bank transfer</strong>
              <p className="muted small" style={{ margin: 0 }}>Transfer {formatINR(s.payout)} to {s.businessName}’s bank account, then enter the bank’s reference (UTR). The merchant is told straight away.</p>
              <div className="grid2">
                <Field label="Bank reference (UTR)"><input value={ref} maxLength={60} onChange={(e) => setRef(e.target.value)} /></Field>
                <Field label="Note (optional)"><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
              </div>
              {error ? <Notice tone="error">{error}</Notice> : null}
              <div className="row"><button className="btn primary" disabled={busy || !ref.trim()} onClick={pay}>{busy ? 'Saving…' : 'Mark as paid'}</button></div>
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}

function AddAdjustment({ due, onClose, onSaved }: { due: SettlementDue; onClose: () => void; onSaved: (a: AdjustmentRow) => void }) {
  const { client } = useAuth();
  const [kind, setKind] = useState<'credit' | 'recovery' | 'penalty'>('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const paise = rupeesToPaise(amount);
    if (paise === null || paise <= 0) return setError('Enter the amount in rupees.');
    setBusy(true);
    setError(null);
    try { onSaved(await client.post<AdjustmentRow>(`/v1/admin/businesses/${due.businessId}/adjustments`, { kind, amount: paise, reason: reason.trim() })); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Adjust what ${due.businessName} is owed`} onClose={onClose}>
      <div className="stack">
        <p className="muted small" style={{ margin: 0 }}>A credit adds to their next settlement; a recovery or penalty takes from it (for example a refund paid after they were settled). It is recorded in the books straight away and the business is told.</p>
        <Field label="Type"><select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}><option value="credit">Credit: VIBE owes more</option><option value="recovery">Recovery: take back an amount</option><option value="penalty">Penalty</option></select></Field>
        <div className="grid2">
          <Field label="Amount (₹)"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Reason" hint="The business sees this."><input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Refund paid after settlement VB-…" /></Field>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="modal-foot"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || reason.trim().length < 3} onClick={save}>{busy ? 'Saving…' : 'Add adjustment'}</button></div>
      </div>
    </Modal>
  );
}
