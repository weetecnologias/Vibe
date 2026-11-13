import { useState } from 'react';

import { Badge, Field, Loading, Modal, Notice, PageHead, bpsToPercent, errorText, showDateTime, useAsync, useAuth, type CategoryRow, type RateCard } from '@kit';

type Scope = 'platform' | 'category' | 'business';
const SCOPE_LABEL: Record<Scope, string> = { platform: 'Whole platform', category: 'Category', business: 'One business' };
const percentToBps = (v: string): number | null => { const n = Number(v); return v.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 50 ? Math.round(n * 100) : null; };

/**
 * VIBE's commission rates, with history. A business pays its own rate if it has one, else the nearest category's, else the platform's, as of when the payment
 * is confirmed. A new card never changes payments already made: each payment keeps the rate it was charged. Also the GST charged on VIBE's commission.
 */
export function RatesPage() {
  const { client } = useAuth();
  const cards = useAsync(() => client.get<RateCard[]>('/v1/admin/rate-cards'), [client]);
  const tax = useAsync(() => client.get<{ commissionGstBps: number }>('/v1/admin/rate-cards/tax'), [client]);
  const [scope, setScope] = useState<'all' | Scope>('all');
  const [adding, setAdding] = useState(false);
  const [gst, setGst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const platform = (cards.data ?? []).find((c) => c.scope === 'platform');
  const shown = (cards.data ?? []).filter((c) => scope === 'all' || c.scope === scope);

  const saveGst = async () => {
    const bps = percentToBps(gst ?? '');
    if (bps === null) return setError('Enter the GST rate as a percentage, like 18.');
    setError(null);
    try {
      await client.put('/v1/admin/rate-cards/tax', { commissionGstBps: bps });
      setNotice(`GST on commission is now ${bpsToPercent(bps)}%. It applies to payments confirmed from now on.`);
      setGst(null);
      tax.reload();
    } catch (e) { setError(errorText(e)); }
  };

  return (
    <>
      <PageHead title="Rates and tax" sub="VIBE's commission, and the GST charged on it. Rates keep their history, and every payment keeps the rate it was charged." actions={<button className="btn primary" onClick={() => { setError(null); setAdding(true); }}>New rate</button>} />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error && !adding ? <Notice tone="error">{error}</Notice> : null}
      <div className="stats">
        <div className="card"><span className="muted small">Platform rate</span><strong>{platform ? `${bpsToPercent(platform.commissionBps)}%` : '0%'}</strong><span className="muted small">For businesses with no rate of their own or their category’s</span></div>
        <div className="card">
          <span className="muted small">GST on VIBE’s commission</span>
          {gst === null ? <><strong>{tax.data ? `${bpsToPercent(tax.data.commissionGstBps)}%` : '–'}</strong><button className="btn ghost sm" onClick={() => setGst(tax.data ? String(tax.data.commissionGstBps / 100) : '')}>Change</button></>
            : <div className="row"><input style={{ maxWidth: 90 }} inputMode="decimal" value={gst} onChange={(e) => setGst(e.target.value)} aria-label="GST percentage" /><button className="btn primary sm" onClick={saveGst}>Save</button><button className="btn sm" onClick={() => setGst(null)}>Cancel</button></div>}
        </div>
        <div className="card"><span className="muted small">How a payment splits</span><span className="small">Customer pays → VIBE’s fee and commission (+ GST) come off → the rest is owed to the business.</span></div>
      </div>
      <div className="tabs" role="tablist">
        {(['all', 'platform', 'category', 'business'] as const).map((k) => <button key={k} role="tab" aria-selected={scope === k} className={`tab${scope === k ? ' on' : ''}`} onClick={() => setScope(k)}>{k === 'all' ? 'All rates' : SCOPE_LABEL[k]}</button>)}
      </div>
      {cards.error ? <Notice tone="error">{cards.error}</Notice> : null}
      {cards.loading && !cards.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Applies to</th><th>Rate</th><th>From</th><th>Why</th><th>Set by</th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.targetName}</strong><div><Badge tone={c.scope === 'platform' ? 'pink' : 'muted'}>{SCOPE_LABEL[c.scope]}</Badge></div></td>
                  <td><strong>{bpsToPercent(c.commissionBps)}%</strong></td>
                  <td className="small">{showDateTime(c.effectiveFrom)}</td>
                  <td className="small">{c.reason}</td>
                  <td className="small">{c.createdBy ?? 'System'}<div className="muted">{showDateTime(c.createdAt)}</div></td>
                </tr>
              ))}
              {shown.length === 0 ? <tr><td colSpan={5} className="muted">No rates here yet. Until you add one, businesses pay no commission.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {adding ? <AddRate onClose={() => setAdding(false)} onSaved={(c) => { setAdding(false); setNotice(`${bpsToPercent(c.commissionBps)}% set for ${c.targetName}. New payments use it; earlier ones keep theirs.`); cards.reload(); }} /> : null}
    </>
  );
}

function AddRate({ onClose, onSaved }: { onClose: () => void; onSaved: (c: RateCard) => void }) {
  const { client } = useAuth();
  const [scope, setScope] = useState<Scope>('category');
  const [target, setTarget] = useState('');
  const [rate, setRate] = useState('');
  const [reason, setReason] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cats = useAsync(() => client.get<CategoryRow[]>('/v1/admin/categories'), [client]);
  const found = useAsync(() => (scope === 'business' && q.trim().length >= 2 ? client.get<{ items: { id: string; name: string; area: string }[] }>(`/v1/admin/businesses?q=${encodeURIComponent(q.trim())}&limit=8`) : Promise.resolve(null)), [client, scope, q]);

  const save = async () => {
    const bps = percentToBps(rate);
    if (bps === null) return setError('Enter the commission as a percentage between 0 and 50, like 12.5.');
    if (scope !== 'platform' && !target) return setError(scope === 'category' ? 'Choose a category.' : 'Choose a business.');
    setBusy(true);
    setError(null);
    try { onSaved(await client.post<RateCard>('/v1/admin/rate-cards', { scope, targetId: scope === 'platform' ? null : target, commissionBps: bps, reason: reason.trim() })); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title="New commission rate" onClose={onClose}>
      <div className="stack">
        <Field label="Applies to">
          <select value={scope} onChange={(e) => { setScope(e.target.value as Scope); setTarget(''); }}>
            <option value="platform">Whole platform (the default)</option><option value="category">A category and everything under it</option><option value="business">One business</option>
          </select>
        </Field>
        {scope === 'category' ? (
          <Field label="Category"><select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Choose…</option>{(cats.data ?? []).map((c) => <option key={c.id} value={c.id}>{`${'— '.repeat(c.level - 1)}${c.name}`}</option>)}</select></Field>
        ) : null}
        {scope === 'business' ? (
          <Field label="Business" hint="Type at least 2 letters.">
            <input value={q} onChange={(e) => { setQ(e.target.value); setTarget(''); }} placeholder="Search by name" />
            {found.data?.items.map((b) => <label key={b.id} className="check"><input type="radio" name="biz" checked={target === b.id} onChange={() => setTarget(b.id)} /> {b.name} <span className="muted small">{b.area}</span></label>)}
          </Field>
        ) : null}
        <div className="grid2">
          <Field label="Commission (%)" hint="Of what customers pay, less VIBE’s booking fee."><input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="12" /></Field>
          <Field label="Why" hint="Kept in the history and the audit log."><input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Agreed in the onboarding call" /></Field>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="modal-foot"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || reason.trim().length < 3} onClick={save}>{busy ? 'Saving…' : 'Save rate'}</button></div>
      </div>
    </Modal>
  );
}
