import { useState } from 'react';

import {
  Badge, Field, ImageField, Loading, Modal, Notice, PageHead, errorText, fromLocalInput, nowLocal, showDateTime, toLocalInput, useAsync, useAuth,
  type OfferRow, type PromotionInput, type PromotionRow,
} from '@kit';

type Draft = { id: string | null; title: string; message: string; imageUrl: string; offerId: string; startsAt: string; endsAt: string; active: boolean };
const blank = (): Draft => ({ id: null, title: '', message: '', imageUrl: '', offerId: '', startsAt: nowLocal(), endsAt: nowLocal(14), active: true });
const MAX = 3;

/** What customers see depends on VIBE's review as well as the dates and the switch. */
function state(p: PromotionRow): { label: string; tone: 'success' | 'warning' | 'muted'; hint?: string } {
  const now = Date.now();
  if (p.reviewStatus === 'pending') return { label: 'Waiting for VIBE', tone: 'warning', hint: 'Customers see it once VIBE approves it.' };
  if (p.reviewStatus === 'rejected') return { label: 'Not approved', tone: 'muted', hint: p.reviewNote ? `VIBE’s note: ${p.reviewNote}` : undefined };
  if (!p.active) return { label: 'Stopped', tone: 'muted' };
  if (Date.parse(p.endsAt) <= now) return { label: 'Ended', tone: 'muted' };
  if (Date.parse(p.startsAt) > now) return { label: 'Scheduled', tone: 'warning' };
  return { label: 'Live in Discover', tone: 'success' };
}

/**
 * Promotions: tell customers near you what's new. Each one shows in the customer app under Discover → Promotions, nearest places first, after
 * VIBE approves it. A tap opens your page, or the offer you link. Up to 3 at a time.
 */
export function PromotionsPage() {
  const { client } = useAuth();
  const list = useAsync(() => client.get<PromotionRow[]>('/v1/merchant/promotions'), [client]);
  const offers = useAsync(() => client.get<OfferRow[]>('/v1/merchant/offers').catch(() => [] as OfferRow[]), [client]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const current = list.data?.filter((p) => p.active && p.reviewStatus !== 'rejected' && Date.parse(p.endsAt) > Date.now()).length ?? 0;
  const usable = (offers.data ?? []).filter((o) => o.reviewStatus !== 'rejected' && Date.parse(o.endsAt) > Date.now());

  const save = async () => {
    if (!draft) return;
    if (draft.title.trim().length < 3) return setError('Write a headline, like “Our winter menu is here”.');
    if (!draft.startsAt || !draft.endsAt || Date.parse(fromLocalInput(draft.endsAt)) <= Date.parse(fromLocalInput(draft.startsAt))) return setError('The promotion must end after it starts.');
    const body: PromotionInput = {
      title: draft.title.trim(), message: draft.message.trim(), imageUrl: draft.imageUrl.trim() || null, offerId: draft.offerId || null,
      startsAt: fromLocalInput(draft.startsAt), endsAt: fromLocalInput(draft.endsAt), active: draft.active,
    };
    setBusy(true);
    setError(null);
    try {
      const saved = draft.id ? await client.put<PromotionRow>(`/v1/merchant/promotions/${draft.id}`, body) : await client.post<PromotionRow>('/v1/merchant/promotions', body);
      setNotice(saved.reviewStatus === 'approved' ? `Saved “${saved.title}”. It shows in Discover in its dates.` : `Saved “${saved.title}”. VIBE reviews it before customers see it; you’ll get an alert.`);
      setDraft(null);
      list.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (p: PromotionRow) => {
    setError(null);
    try {
      await client.put(`/v1/merchant/promotions/${p.id}`, { title: p.title, message: p.message, imageUrl: p.imageUrl, offerId: p.offerId, startsAt: p.startsAt, endsAt: p.endsAt, active: !p.active });
      list.reload();
    } catch (e) { setError(errorText(e)); }
  };

  const remove = async (p: PromotionRow) => {
    if (!window.confirm(`Delete “${p.title}”? This can’t be undone.`)) return;
    setError(null);
    try { await client.del(`/v1/merchant/promotions/${p.id}`); setNotice(`Deleted “${p.title}”.`); list.reload(); } catch (e) { setError(errorText(e)); }
  };

  return (
    <>
      <PageHead title="Promotions" sub="Tell customers near you what’s new. Promotions show in the VIBE app under Discover → Promotions, nearest places first, once VIBE approves them."
        actions={<button className="btn primary" disabled={current >= MAX} title={current >= MAX ? `Up to ${MAX} at a time` : undefined} onClick={() => { setError(null); setDraft(blank()); }}>New promotion</button>} />
      <p className="muted small" style={{ marginTop: 0 }}>{current} of {MAX} running or waiting. Changing the words, photo, offer or dates sends it back to VIBE; stopping or resuming doesn’t.</p>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error && !draft ? <Notice tone="error">{error}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Promotion</th><th>Tap opens</th><th>Runs</th><th>Taps</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data?.map((p) => {
                const s = state(p);
                return (
                  <tr key={p.id} className={s.tone === 'muted' ? 'dim' : ''}>
                    <td><strong>{p.title}</strong>{p.message ? <div className="muted small">{p.message}</div> : null}</td>
                    <td className="small">{p.offerTitle ? `Offer: ${p.offerTitle}` : 'Your page'}</td>
                    <td className="small">{showDateTime(p.startsAt)}<br />to {showDateTime(p.endsAt)}</td>
                    <td>{p.taps}</td>
                    <td><Badge tone={s.tone}>{s.label}</Badge>{p.autoApproved ? <> <Badge tone="success">Auto-approved</Badge></> : null}{s.hint ? <div className="muted small">{s.hint}</div> : null}</td>
                    <td className="actions">
                      <button className="btn ghost sm" onClick={() => { setError(null); setDraft({ id: p.id, title: p.title, message: p.message, imageUrl: p.imageUrl ?? '', offerId: p.offerId ?? '', startsAt: toLocalInput(p.startsAt), endsAt: toLocalInput(p.endsAt), active: p.active }); }}>Edit</button>
                      {p.reviewStatus !== 'rejected' && Date.parse(p.endsAt) > Date.now() ? <button className="btn ghost sm" onClick={() => toggle(p)}>{p.active ? 'Stop' : 'Resume'}</button> : null}
                      <button className="btn ghost sm danger" onClick={() => remove(p)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
              {list.data?.length === 0 ? <tr><td colSpan={6} className="muted">No promotions yet. Create one to show up in Discover.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}

      {draft ? (
        <Modal title={draft.id ? `Edit “${draft.title}”` : 'New promotion'} onClose={() => setDraft(null)} wide>
          <div className="stack">
            <Field label="Headline" hint="Up to 80 characters."><input value={draft.title} maxLength={80} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Our winter menu is here" /></Field>
            <Field label="Message" hint="Up to 240 characters."><textarea rows={3} value={draft.message} maxLength={240} onChange={(e) => setDraft({ ...draft, message: e.target.value })} placeholder="Spiced lattes, hot chocolate and fresh bakes." /></Field>
            <ImageField label="Photo (optional)" value={draft.imageUrl} onChange={(url) => setDraft({ ...draft, imageUrl: url })} hint="Without one, your cover photo is used." />
            <Field label="When a customer taps it">
              <select value={draft.offerId} onChange={(e) => setDraft({ ...draft, offerId: e.target.value })}>
                <option value="">Open my page on VIBE</option>
                {usable.map((o) => <option key={o.id} value={o.id}>Open my offer: {o.title}</option>)}
              </select>
            </Field>
            <div className="grid2">
              <Field label="Starts"><input type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} /></Field>
              <Field label="Ends" hint="Up to 90 days."><input type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} /></Field>
            </div>
            <label className="check"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Show it in its dates</label>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot"><button className="btn" onClick={() => setDraft(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : draft.id ? 'Save' : 'Send to VIBE'}</button></div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
