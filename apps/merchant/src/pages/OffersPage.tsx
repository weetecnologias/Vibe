import { useState } from 'react';

import {
  Badge, Field, Loading, Modal, Notice, PageHead, RuleFields, buildRule, emptyRule, errorText, fromLocalInput, nowLocal, ruleSummary, ruleToDraft, showDateTime, toLocalInput, useAsync, useAuth,
  type OfferInput, type OfferRow, type RuleDraft,
} from '@kit';

type Draft = { id: string | null; title: string; rule: RuleDraft; memberOnly: boolean; scheduleLabel: string; startsAt: string; endsAt: string; active: boolean };
const blank = (): Draft => ({ id: null, title: '', rule: emptyRule(), memberOnly: false, scheduleLabel: 'Every day', startsAt: nowLocal(), endsAt: nowLocal(90), active: true });

/** What the customer sees depends on VIBE's review as well as the dates and the switch. */
function state(o: OfferRow): { label: string; tone: 'success' | 'warning' | 'muted'; hint?: string } {
  const now = Date.now();
  if (o.reviewStatus === 'pending') return { label: 'Waiting for VIBE', tone: 'warning', hint: 'Customers can’t see it until VIBE approves it.' };
  if (o.reviewStatus === 'rejected') return { label: 'Not approved', tone: 'muted', hint: o.reviewNote ? `VIBE’s note: ${o.reviewNote}` : undefined };
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

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim()) return setError('Give the offer a title, like “Members save 30%”.');
    const r = buildRule(draft.rule);
    if (!r.ok) return setError(r.error);
    if (!draft.startsAt || !draft.endsAt || Date.parse(fromLocalInput(draft.endsAt)) <= Date.parse(fromLocalInput(draft.startsAt))) return setError('The offer must end after it starts.');
    const body: OfferInput = { title: draft.title.trim(), ...r.rule, memberOnly: draft.memberOnly, scheduleLabel: draft.scheduleLabel.trim() || 'Every day', startsAt: fromLocalInput(draft.startsAt), endsAt: fromLocalInput(draft.endsAt), active: draft.active };
    setBusy(true);
    setError(null);
    try {
      const saved = draft.id ? await client.put<OfferRow>(`/v1/merchant/offers/${draft.id}`, body) : await client.post<OfferRow>('/v1/merchant/offers', body);
      setNotice(saved.reviewStatus === 'pending' ? 'Saved. It goes live once VIBE approves it.' : 'Saved.');
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
    setDraft({ id: o.id, title: o.title, rule: ruleToDraft(o), memberOnly: o.memberOnly, scheduleLabel: o.scheduleLabel, startsAt: toLocalInput(o.startsAt), endsAt: toLocalInput(o.endsAt), active: o.active });
  };

  return (
    <>
      <PageHead title="Offers" sub="Pay & Redeem offers on your page. VIBE reviews each offer before customers see it. Changing an offer sends it back for review."
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
                    <td className="small">{ruleSummary(o)}</td>
                    <td className="small">{showDateTime(o.startsAt)}<br />to {showDateTime(o.endsAt)}</td>
                    <td><Badge tone={s.tone}>{s.label}</Badge>{s.hint ? <div className="muted small" style={{ marginTop: 4, maxWidth: 220 }}>{s.hint}</div> : null}</td>
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
            <RuleFields draft={draft.rule} onChange={(rule) => setDraft({ ...draft, rule })} />
            <div className="grid3">
              <Field label="Starts (India time)"><input type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} /></Field>
              <Field label="Ends (India time)"><input type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} /></Field>
              <Field label="Shown as"><input value={draft.scheduleLabel} maxLength={80} onChange={(e) => setDraft({ ...draft, scheduleLabel: e.target.value })} placeholder="Every day" /></Field>
            </div>
            <div className="row" style={{ gap: 20 }}>
              <label className="check"><input type="checkbox" checked={draft.memberOnly} onChange={(e) => setDraft({ ...draft, memberOnly: e.target.checked })} /> For VIBE members only</label>
              <label className="check"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Switched on</label>
            </div>
            {draft.id ? <Notice tone="info">Changing the title, discount, dates or who it is for sends the offer back to VIBE for review. Just switching it on or off does not.</Notice> : null}
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
