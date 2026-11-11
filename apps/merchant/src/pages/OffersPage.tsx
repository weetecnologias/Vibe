import { useState } from 'react';

import {
  Badge, Field, Loading, Modal, Notice, PageHead, bpsToPercent, errorText, formatINR, paiseToRupees, percentToBps, rupeesToPaise, useAsync, useAuth,
  type OfferInput, type OfferKind, type OfferRow,
} from '@kit';

/** Offers are shown and entered in India time. */
const IST = 'Asia/Kolkata';
const toLocalInput = (iso: string) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const fromLocalInput = (v: string) => new Date(`${v}:00+05:30`).toISOString();
const nowLocal = (addDays = 0) => toLocalInput(new Date(Date.now() + addDays * 86_400_000).toISOString());
const show = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: IST });

type Draft = {
  id: string | null; title: string; kind: OfferKind; percent: string; flat: string; cap: string; minBill: string; memberOnly: boolean;
  scheduleLabel: string; startsAt: string; endsAt: string; active: boolean;
};
const blank = (): Draft => ({ id: null, title: '', kind: 'percentage', percent: '', flat: '', cap: '', minBill: '', memberOnly: false, scheduleLabel: 'Every day', startsAt: nowLocal(), endsAt: nowLocal(90), active: true });

function summary(o: OfferRow): string {
  const rule = o.kind === 'percentage' ? `${bpsToPercent(o.rateBps)}% off${o.maxDiscount ? `, up to ${formatINR(o.maxDiscount)}` : ''}` : `${formatINR(o.flatAmount ?? 0)} off`;
  return `${rule}${o.minBill ? ` on bills of ${formatINR(o.minBill)} or more` : ''}`;
}

function state(o: OfferRow): { label: string; tone: 'success' | 'warning' | 'muted' } {
  const now = Date.now();
  if (!o.active) return { label: 'Switched off', tone: 'muted' };
  if (Date.parse(o.endsAt) <= now) return { label: 'Ended', tone: 'muted' };
  if (Date.parse(o.startsAt) > now) return { label: 'Scheduled', tone: 'warning' };
  return { label: 'Live', tone: 'success' };
}

export function OffersPage() {
  const { client } = useAuth();
  const list = useAsync(() => client.get<OfferRow[]>('/v1/merchant/offers'), [client]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Money is typed in rupees and sent in paise. Returns the request body, or what is wrong. */
  const build = (d: Draft): { ok: true; body: OfferInput } | { ok: false; error: string } => {
    if (!d.title.trim()) return { ok: false, error: 'Give the offer a title, like “Members save 30%”.' };
    const bps = d.kind === 'percentage' ? percentToBps(d.percent) : null;
    if (d.kind === 'percentage' && (bps === null || bps < 1 || bps > 9000)) return { ok: false, error: 'Enter a percentage between 0.01 and 90.' };
    const flat = d.kind === 'flat' ? rupeesToPaise(d.flat) : null;
    if (d.kind === 'flat' && (flat === null || flat < 1)) return { ok: false, error: 'Enter the discount amount in rupees.' };
    const cap = d.kind === 'percentage' && d.cap.trim() ? rupeesToPaise(d.cap) : null;
    if (d.kind === 'percentage' && d.cap.trim() && (cap === null || cap < 1)) return { ok: false, error: 'The maximum discount must be an amount in rupees.' };
    const min = d.minBill.trim() ? rupeesToPaise(d.minBill) : null;
    if (d.minBill.trim() && min === null) return { ok: false, error: 'The minimum bill must be an amount in rupees.' };
    if (flat !== null && min !== null && flat > min) return { ok: false, error: 'The flat discount can’t be more than the minimum bill.' };
    if (!d.startsAt || !d.endsAt || Date.parse(fromLocalInput(d.endsAt)) <= Date.parse(fromLocalInput(d.startsAt))) return { ok: false, error: 'The offer must end after it starts.' };
    return {
      ok: true,
      body: { title: d.title.trim(), kind: d.kind, rateBps: bps, flatAmount: flat, maxDiscount: cap, minBill: min, memberOnly: d.memberOnly, scheduleLabel: d.scheduleLabel.trim() || 'Every day', startsAt: fromLocalInput(d.startsAt), endsAt: fromLocalInput(d.endsAt), active: d.active },
    };
  };

  const save = async () => {
    if (!draft) return;
    const r = build(draft);
    if (!r.ok) return setError(r.error);
    setBusy(true);
    setError(null);
    try {
      if (draft.id) await client.put(`/v1/merchant/offers/${draft.id}`, r.body); else await client.post('/v1/merchant/offers', r.body);
      setNotice(draft.id ? 'Offer saved.' : 'Offer created.');
      setDraft(null);
      list.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (o: OfferRow) => {
    if (!window.confirm(`Delete “${o.title}”? To stop it for now, edit it and switch it off instead.`)) return;
    try {
      await client.del(`/v1/merchant/offers/${o.id}`);
      setNotice('Offer deleted.');
      list.reload();
    } catch (e) {
      setNotice(null);
      setError(errorText(e));
    }
  };

  const edit = (o: OfferRow) => {
    setError(null);
    setDraft({
      id: o.id, title: o.title, kind: o.kind, percent: bpsToPercent(o.rateBps), flat: paiseToRupees(o.flatAmount), cap: paiseToRupees(o.maxDiscount), minBill: paiseToRupees(o.minBill),
      memberOnly: o.memberOnly, scheduleLabel: o.scheduleLabel, startsAt: toLocalInput(o.startsAt), endsAt: toLocalInput(o.endsAt), active: o.active,
    });
  };

  return (
    <>
      <PageHead title="Offers" sub="Pay & Redeem offers on your page. Customers claim one, you enter their bill, VIBE works out the discount."
        actions={<button className="btn primary" onClick={() => { setError(null); setDraft(blank()); }}>Create offer</button>} />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error && !draft ? <Notice tone="error">{error}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data && list.data.length === 0 ? <div className="card muted">No offers yet. Create one to bring customers in.</div> : null}
      {list.data && list.data.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Offer</th><th>Rule</th><th>Runs</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data.map((o) => {
                const s = state(o);
                return (
                  <tr key={o.id} className={s.tone === 'muted' ? 'dim' : ''}>
                    <td><strong>{o.title}</strong> {o.memberOnly ? <Badge tone="pink">Members</Badge> : null}<div className="muted small">{o.scheduleLabel}</div></td>
                    <td className="small">{summary(o)}</td>
                    <td className="small">{show(o.startsAt)}<br />to {show(o.endsAt)}</td>
                    <td><Badge tone={s.tone}>{s.label}</Badge></td>
                    <td className="actions"><button className="btn ghost sm" onClick={() => edit(o)}>Edit</button><button className="btn ghost sm danger" onClick={() => remove(o)}>Delete</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {draft ? (
        <Modal title={draft.id ? 'Edit offer' : 'Create offer'} onClose={() => setDraft(null)} wide>
          <div className="stack">
            <Field label="Title"><input autoFocus value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Members save 30%" /></Field>
            <fieldset className="hours">
              <legend>Discount</legend>
              <div className="row" style={{ gap: 20 }}>
                <label className="check"><input type="radio" name="kind" checked={draft.kind === 'percentage'} onChange={() => setDraft({ ...draft, kind: 'percentage' })} /> Percentage off</label>
                <label className="check"><input type="radio" name="kind" checked={draft.kind === 'flat'} onChange={() => setDraft({ ...draft, kind: 'flat' })} /> Flat amount off</label>
              </div>
              {draft.kind === 'percentage' ? (
                <div className="grid2">
                  <Field label="Percentage"><input inputMode="decimal" value={draft.percent} onChange={(e) => setDraft({ ...draft, percent: e.target.value })} placeholder="30" /></Field>
                  <Field label="Maximum discount (₹)" hint="Optional. Caps the saving on large bills."><input inputMode="decimal" value={draft.cap} onChange={(e) => setDraft({ ...draft, cap: e.target.value })} placeholder="500" /></Field>
                </div>
              ) : (
                <Field label="Discount (₹)"><input inputMode="decimal" value={draft.flat} onChange={(e) => setDraft({ ...draft, flat: e.target.value })} placeholder="100" /></Field>
              )}
              <Field label="Minimum bill (₹)" hint="Optional. The offer applies only when the bill is at least this much."><input inputMode="decimal" value={draft.minBill} onChange={(e) => setDraft({ ...draft, minBill: e.target.value })} placeholder="500" /></Field>
            </fieldset>
            <div className="grid3">
              <Field label="Starts (India time)"><input type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} /></Field>
              <Field label="Ends (India time)"><input type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} /></Field>
              <Field label="Shown as"><input value={draft.scheduleLabel} maxLength={80} onChange={(e) => setDraft({ ...draft, scheduleLabel: e.target.value })} placeholder="Every day" /></Field>
            </div>
            <div className="row" style={{ gap: 20 }}>
              <label className="check"><input type="checkbox" checked={draft.memberOnly} onChange={(e) => setDraft({ ...draft, memberOnly: e.target.checked })} /> For VIBE members only</label>
              <label className="check"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Switched on</label>
            </div>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot">
              <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save offer'}</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
