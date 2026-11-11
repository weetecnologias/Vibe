import { useEffect, useState } from 'react';

import {
  Badge, Field, ImageField, Loading, Modal, Notice, PageHead, errorText, fromLocalInput, showDateTime, toLocalInput, useAsync, useAuth,
  type BannerInput, type BannerRow, type BannerTarget, type BusinessList, type CategoryRow, type EventListRow, type Pick, type PickSection, type ReviewOffer,
} from '@kit';

export function HomePage() {
  const [tab, setTab] = useState<'banners' | 'pins'>('banners');
  return (
    <>
      <PageHead title="Home content" sub="What customers see first in the app: the sliding banners and the pinned places, offers and events." />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'banners'} className={`tab${tab === 'banners' ? ' on' : ''}`} onClick={() => setTab('banners')}>Banners</button>
        <button role="tab" aria-selected={tab === 'pins'} className={`tab${tab === 'pins' ? ' on' : ''}`} onClick={() => setTab('pins')}>Pinned sections</button>
      </div>
      {tab === 'banners' ? <Banners /> : <Pins />}
    </>
  );
}

// ---------- banners ----------
type Draft = { id: string | null; eyebrow: string; title: string; subtitle: string; cta: string; imageUrl: string; targetType: BannerTarget; targetId: string; sortOrder: string; active: boolean; startsAt: string; endsAt: string };
const blank: Draft = { id: null, eyebrow: '', title: '', subtitle: '', cta: 'Explore', imageUrl: '', targetType: 'events', targetId: '', sortOrder: '0', active: true, startsAt: '', endsAt: '' };

function Banners() {
  const { client } = useAuth();
  const list = useAsync(() => client.get<BannerRow[]>('/v1/admin/home/banners'), [client]);
  const offers = useAsync(() => client.get<ReviewOffer[]>('/v1/admin/offers?status=approved'), [client]);
  const cats = useAsync(() => client.get<CategoryRow[]>('/v1/admin/categories'), [client]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const body: BannerInput = {
      eyebrow: draft.eyebrow.trim(), title: draft.title.trim(), subtitle: draft.subtitle.trim(), cta: draft.cta.trim() || 'Explore', imageUrl: draft.imageUrl.trim() || null, targetType: draft.targetType,
      targetId: draft.targetType === 'events' ? null : draft.targetId || null, sortOrder: Math.max(0, parseInt(draft.sortOrder, 10) || 0), active: draft.active,
      startsAt: draft.startsAt ? fromLocalInput(draft.startsAt) : null, endsAt: draft.endsAt ? fromLocalInput(draft.endsAt) : null,
    };
    try {
      if (draft.id) await client.put(`/v1/admin/home/banners/${draft.id}`, body); else await client.post('/v1/admin/home/banners', body);
      setNotice('Banner saved. The app shows it the next time it loads.');
      setDraft(null);
      list.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (b: BannerRow) => {
    if (!window.confirm(`Delete the banner “${b.title}”?`)) return;
    try {
      await client.del(`/v1/admin/home/banners/${b.id}`);
      setNotice('Banner deleted.');
      list.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const edit = (b: BannerRow) => {
    setError(null);
    setDraft({ id: b.id, eyebrow: b.eyebrow, title: b.title, subtitle: b.subtitle, cta: b.cta, imageUrl: b.imageUrl ?? '', targetType: b.targetType, targetId: b.targetId ?? '', sortOrder: String(b.sortOrder),
      active: b.active, startsAt: b.startsAt ? toLocalInput(b.startsAt) : '', endsAt: b.endsAt ? toLocalInput(b.endsAt) : '' });
  };

  const targetLabel = (b: BannerRow) => b.targetType === 'events' ? 'Events list'
    : b.targetType === 'offer' ? `Offer: ${offers.data?.find((o) => o.id === b.targetId)?.title ?? '…'}` : `Category: ${cats.data?.find((c) => c.id === b.targetId)?.name ?? '…'}`;

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}><button className="btn primary" onClick={() => { setError(null); setDraft(blank); }}>Add banner</button></div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th /><th>Banner</th><th>Opens</th><th>Runs</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data?.map((b) => (
                <tr key={b.id} className={b.liveNow ? '' : 'dim'}>
                  <td>{b.imageUrl ? <img className="thumb" src={b.imageUrl} alt="" /> : <div className="thumb empty" aria-hidden />}</td>
                  <td><strong>{b.title}</strong><div className="muted small">{b.eyebrow ? `${b.eyebrow} · ` : ''}{b.subtitle}</div></td>
                  <td className="small">{targetLabel(b)}</td>
                  <td className="small">{b.startsAt ? showDateTime(b.startsAt) : 'Now'}<br />to {b.endsAt ? showDateTime(b.endsAt) : 'no end'}</td>
                  <td>{!b.active ? <Badge>Switched off</Badge> : b.liveNow ? <Badge tone="success">Showing</Badge> : <Badge tone="warning">Not in its dates</Badge>}</td>
                  <td className="actions"><button className="btn ghost sm" onClick={() => edit(b)}>Edit</button><button className="btn ghost sm danger" onClick={() => remove(b)}>Delete</button></td>
                </tr>
              ))}
              {list.data?.length === 0 ? <tr><td colSpan={6} className="muted">No banners yet. Add one to fill the sliding bar at the top of the app.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}

      {draft ? (
        <Modal title={draft.id ? 'Edit banner' : 'Add banner'} onClose={() => setDraft(null)} wide>
          <div className="stack">
            <div className="grid2">
              <Field label="Small label (optional)"><input value={draft.eyebrow} maxLength={40} placeholder="MEMBERS" onChange={(e) => setDraft({ ...draft, eyebrow: e.target.value })} /></Field>
              <Field label="Button text"><input value={draft.cta} maxLength={30} onChange={(e) => setDraft({ ...draft, cta: e.target.value })} /></Field>
            </div>
            <Field label="Headline"><input autoFocus value={draft.title} maxLength={80} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
            <Field label="Supporting line"><input value={draft.subtitle} maxLength={160} onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} /></Field>
            <ImageField label="Image" value={draft.imageUrl} onChange={(v) => setDraft({ ...draft, imageUrl: v })} />
            <div className="grid2">
              <Field label="Opens">
                <select value={draft.targetType} onChange={(e) => setDraft({ ...draft, targetType: e.target.value as BannerTarget, targetId: '' })}>
                  <option value="events">The events list</option><option value="offer">An offer</option><option value="category">A category</option>
                </select>
              </Field>
              {draft.targetType === 'offer' ? (
                <Field label="Which offer" hint="Only approved offers.">
                  <select value={draft.targetId} onChange={(e) => setDraft({ ...draft, targetId: e.target.value })}>
                    <option value="">Choose…</option>{offers.data?.map((o) => <option key={o.id} value={o.id}>{o.businessName}: {o.title}</option>)}
                  </select>
                </Field>
              ) : draft.targetType === 'category' ? (
                <Field label="Which category">
                  <select value={draft.targetId} onChange={(e) => setDraft({ ...draft, targetId: e.target.value })}>
                    <option value="">Choose…</option>{cats.data?.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              ) : <div />}
            </div>
            <div className="grid3">
              <Field label="Starts (optional)"><input type="datetime-local" value={draft.startsAt} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value })} /></Field>
              <Field label="Ends (optional)"><input type="datetime-local" value={draft.endsAt} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value })} /></Field>
              <Field label="Order" hint="Smaller numbers come first."><input inputMode="numeric" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })} /></Field>
            </div>
            <label className="check"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Switched on</label>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot">
              <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn primary" disabled={busy || !draft.title.trim()} onClick={save}>{busy ? 'Saving…' : 'Save banner'}</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------- pinned sections ----------
const SECTIONS: { key: PickSection; title: string; help: string }[] = [
  { key: 'offers', title: 'Popular offers', help: 'The offers shown first on the home screen. Only approved, switched-on offers can be pinned.' },
  { key: 'trending', title: 'Trending places', help: 'The places shown in the trending row.' },
  { key: 'events', title: 'Featured events', help: 'The events shown in the events row. Only published events can be pinned.' },
];

function Pins() {
  return <div className="stack">{SECTIONS.map((s) => <PinEditor key={s.key} section={s.key} title={s.title} help={s.help} />)}</div>;
}

function PinEditor({ section, title, help }: { section: PickSection; title: string; help: string }) {
  const { client } = useAuth();
  const saved = useAsync(() => client.get<Pick[]>(`/v1/admin/home/picks/${section}`), [client, section]);
  const options = useAsync(async (): Promise<Pick[]> => {
    if (section === 'offers') return (await client.get<ReviewOffer[]>('/v1/admin/offers?status=approved')).filter((o) => o.active).map((o) => ({ id: o.id, label: o.title, sub: o.businessName }));
    if (section === 'events') return (await client.get<EventListRow[]>('/v1/admin/events?status=published')).map((e) => ({ id: e.id, label: e.title, sub: e.venue }));
    return (await client.get<BusinessList>('/v1/admin/businesses?limit=100')).items.filter((b) => b.active).map((b) => ({ id: b.id, label: b.name, sub: b.area }));
  }, [client, section]);
  const [items, setItems] = useState<Pick[]>([]);
  const [loadedFor, setLoadedFor] = useState(false);
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (saved.data && !loadedFor) { setItems(saved.data); setLoadedFor(true); }
  }, [saved.data, loadedFor]);

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    setItems(next);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setItems(await client.put<Pick[]>(`/v1/admin/home/picks/${section}`, { ids: items.map((i) => i.id) }));
      setNotice(items.length ? 'Saved. The app shows these first.' : 'Saved. With nothing pinned the app picks automatically.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const available = (options.data ?? []).filter((o) => !items.some((i) => i.id === o.id));

  return (
    <div className="card stack">
      <div><h2>{title}</h2><p className="muted small" style={{ margin: '4px 0 0' }}>{help} Up to 12. Nothing pinned means the app picks automatically.</p></div>
      {saved.error ? <Notice tone="error">{saved.error}</Notice> : null}
      {items.map((it, i) => (
        <div key={it.id} className="list-row">
          <strong style={{ flex: 1 }}>{i + 1}. {it.label}<span className="muted small"> · {it.sub}</span></strong>
          <button className="btn ghost sm" aria-label={`Move ${it.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
          <button className="btn ghost sm" aria-label={`Move ${it.label} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>↓</button>
          <button className="btn ghost sm danger" onClick={() => setItems(items.filter((x) => x.id !== it.id))}>Remove</button>
        </div>
      ))}
      <div className="row">
        <select style={{ maxWidth: 360 }} aria-label={`Add to ${title}`} value={adding} onChange={(e) => setAdding(e.target.value)}>
          <option value="">Add to this section…</option>
          {available.map((o) => <option key={o.id} value={o.id}>{o.label} · {o.sub}</option>)}
        </select>
        <button className="btn sm" disabled={!adding || items.length >= 12} onClick={() => { const o = options.data?.find((x) => x.id === adding); if (o) { setItems([...items, o]); setAdding(''); } }}>Add</button>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <div className="row"><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save order'}</button></div>
    </div>
  );
}
