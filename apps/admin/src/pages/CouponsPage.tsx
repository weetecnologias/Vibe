import { useState } from 'react';

import {
  Badge, Field, Loading, Modal, Notice, PageHead, RuleFields, buildRule, emptyRule, errorText, fromLocalInput, nowLocal, ruleSummary, ruleToDraft, showDateTime, toLocalInput, useAsync, useAuth,
  type Coupon, type CouponInput, type CouponKind, type RuleDraft,
} from '@kit';

type Draft = {
  id: string | null; code: string; title: string; description: string; memberOnly: boolean; kinds: CouponKind[]; rule: RuleDraft; firstBookingOnly: boolean; maxUses: string; terms: string;
  startsAt: string; endsAt: string; active: boolean;
};
const KIND_LABEL: Record<CouponKind, string> = { movie: 'Movies', tickets: 'Events', slots: 'Court bookings', pass: 'Memberships' };
const blank = (): Draft => ({ id: null, code: '', title: '', description: '', memberOnly: false, kinds: ['movie', 'tickets'], rule: emptyRule(), firstBookingOnly: false, maxUses: '', terms: '', startsAt: nowLocal(), endsAt: nowLocal(90), active: true });

function status(c: Coupon): { label: string; tone: 'success' | 'warning' | 'muted' } {
  const now = Date.now();
  if (!c.active) return { label: 'Switched off', tone: 'muted' };
  if (Date.parse(c.endsAt) <= now) return { label: 'Ended', tone: 'muted' };
  if (Date.parse(c.startsAt) > now) return { label: 'Scheduled', tone: 'warning' };
  return { label: 'Live', tone: 'success' };
}

export function CouponsPage() {
  const { client } = useAuth();
  const list = useAsync(() => client.get<Coupon[]>('/v1/admin/coupons'), [client]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!draft) return;
    const r = buildRule(draft.rule);
    if (!r.ok) return setError(r.error);
    if (!draft.kinds.length) return setError('Choose where the coupon can be used.');
    const uses = draft.maxUses.trim() ? parseInt(draft.maxUses, 10) : null;
    if (draft.maxUses.trim() && (!uses || uses < 1)) return setError('Uses per customer must be a whole number, or empty for no limit.');
    if (!draft.startsAt || !draft.endsAt || Date.parse(fromLocalInput(draft.endsAt)) <= Date.parse(fromLocalInput(draft.startsAt))) return setError('The coupon must end after it starts.');
    const body: CouponInput = {
      code: draft.code.trim().toUpperCase(), title: draft.title.trim(), description: draft.description.trim(), memberOnly: draft.memberOnly, kinds: draft.kinds, ...r.rule, firstBookingOnly: draft.firstBookingOnly,
      maxUsesPerUser: uses, terms: draft.terms.split('\n').map((l) => l.trim()).filter(Boolean), startsAt: fromLocalInput(draft.startsAt), endsAt: fromLocalInput(draft.endsAt), active: draft.active,
    };
    setBusy(true);
    setError(null);
    try {
      if (draft.id) await client.put(`/v1/admin/coupons/${draft.id}`, body); else await client.post('/v1/admin/coupons', body);
      setNotice('Coupon saved.');
      setDraft(null);
      list.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Coupon) => {
    if (!window.confirm(`Delete the coupon ${c.code}? To stop it for now, edit it and switch it off instead.`)) return;
    try {
      await client.del(`/v1/admin/coupons/${c.id}`);
      setNotice('Coupon deleted.');
      list.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const edit = (c: Coupon) => {
    setError(null);
    setDraft({
      id: c.id, code: c.code, title: c.title, description: c.description, memberOnly: c.memberOnly, kinds: c.kinds, rule: ruleToDraft(c), firstBookingOnly: c.firstBookingOnly,
      maxUses: c.maxUsesPerUser === null ? '' : String(c.maxUsesPerUser), terms: c.terms.join('\n'), startsAt: toLocalInput(c.startsAt), endsAt: toLocalInput(c.endsAt), active: c.active,
    });
  };

  const toggleKind = (k: CouponKind, on: boolean) => draft && setDraft({ ...draft, kinds: on ? [...draft.kinds, k] : draft.kinds.filter((x) => x !== k) });

  return (
    <>
      <PageHead title="Checkout coupons" sub="Codes and offers customers can apply when paying for movie or event tickets, court and class bookings, and gym and studio memberships. Members-only and first-booking rules are checked at checkout. VIBE funds the discount; the business is settled the full price." actions={<button className="btn primary" onClick={() => { setError(null); setDraft(blank()); }}>Create coupon</button>} />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error && !draft ? <Notice tone="error">{error}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Coupon</th><th>Rule</th><th>For</th><th>Runs</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data?.map((c) => {
                const s = status(c);
                return (
                  <tr key={c.id} className={s.tone === 'muted' ? 'dim' : ''}>
                    <td><strong>{c.code}</strong></td>
                    <td>{c.title} {c.memberOnly ? <Badge tone="pink">Members</Badge> : null}{c.firstBookingOnly ? <> <Badge>First booking</Badge></> : null}</td>
                    <td className="small">{ruleSummary(c)}</td>
                    <td className="small">{c.kinds.map((k) => KIND_LABEL[k]).join(', ')}</td>
                    <td className="small">{showDateTime(c.startsAt)}<br />to {showDateTime(c.endsAt)}</td>
                    <td><Badge tone={s.tone}>{s.label}</Badge></td>
                    <td className="actions"><button className="btn ghost sm" onClick={() => edit(c)}>Edit</button><button className="btn ghost sm danger" onClick={() => remove(c)}>Delete</button></td>
                  </tr>
                );
              })}
              {list.data?.length === 0 ? <tr><td colSpan={7} className="muted">No coupons yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {draft ? (
        <Modal title={draft.id ? 'Edit coupon' : 'Create coupon'} onClose={() => setDraft(null)} wide>
          <div className="stack">
            <div className="grid2">
              <Field label="Code" hint="3 to 20 letters or numbers. Customers type this."><input autoFocus value={draft.code} maxLength={20} onChange={(e) => setDraft({ ...draft, code: e.target.value.replace(/\s/g, '').toUpperCase() })} /></Field>
              <Field label="Title"><input value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="₹50 off your first booking" /></Field>
            </div>
            <Field label="Description"><input value={draft.description} maxLength={200} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></Field>
            <RuleFields draft={draft.rule} onChange={(rule) => setDraft({ ...draft, rule })} name="coupon-kind" />
            <fieldset className="hours">
              <legend>Who can use it</legend>
              <div className="row" style={{ gap: 20 }}>
                <label className="check"><input type="checkbox" checked={draft.kinds.includes('movie')} onChange={(e) => toggleKind('movie', e.target.checked)} /> Movie tickets</label>
                <label className="check"><input type="checkbox" checked={draft.kinds.includes('tickets')} onChange={(e) => toggleKind('tickets', e.target.checked)} /> Event tickets</label>
                <label className="check"><input type="checkbox" checked={draft.kinds.includes('slots')} onChange={(e) => toggleKind('slots', e.target.checked)} /> Court and class bookings</label>
                <label className="check"><input type="checkbox" checked={draft.kinds.includes('pass')} onChange={(e) => toggleKind('pass', e.target.checked)} /> Gym and studio memberships</label>
                <label className="check"><input type="checkbox" checked={draft.memberOnly} onChange={(e) => setDraft({ ...draft, memberOnly: e.target.checked })} /> VIBE members only</label>
                <label className="check"><input type="checkbox" checked={draft.firstBookingOnly} onChange={(e) => setDraft({ ...draft, firstBookingOnly: e.target.checked })} /> First booking only</label>
              </div>
              <Field label="Uses per customer" hint="Empty for no limit."><input inputMode="numeric" style={{ maxWidth: 120 }} value={draft.maxUses} onChange={(e) => setDraft({ ...draft, maxUses: e.target.value })} /></Field>
            </fieldset>
            <div className="grid2">
              <Field label="Starts (India time)"><input type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} /></Field>
              <Field label="Ends (India time)"><input type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} /></Field>
            </div>
            <Field label="Terms" hint="One per line."><textarea rows={3} value={draft.terms} onChange={(e) => setDraft({ ...draft, terms: e.target.value })} /></Field>
            <label className="check"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Switched on</label>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot">
              <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn primary" disabled={busy || draft.code.length < 3 || !draft.title.trim()} onClick={save}>{busy ? 'Saving…' : 'Save coupon'}</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
