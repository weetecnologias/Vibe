import { useMemo, useState } from 'react';

import { Badge, Field, ImageField, Loading, Modal, Notice, PageHead, errorText, formatINR, paiseToRupees, rupeesToPaise, useAsync, useAuth, type MenuInput, type MenuRow } from '@kit';

type Draft = { id: string | null; name: string; note: string; price: string; section: string; imageUrl: string; sortOrder: string; active: boolean };
const blank: Draft = { id: null, name: '', note: '', price: '', section: '', imageUrl: '', sortOrder: '0', active: true };

export function MenuPage() {
  const { client } = useAuth();
  const list = useAsync(() => client.get<MenuRow[]>('/v1/merchant/menu'), [client]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sections = useMemo(() => {
    const m = new Map<string, MenuRow[]>();
    for (const r of list.data ?? []) m.set(r.section ?? 'Other', [...(m.get(r.section ?? 'Other') ?? []), r]);
    return [...m.entries()];
  }, [list.data]);

  const price = draft ? rupeesToPaise(draft.price) : null;

  const save = async () => {
    if (!draft || price === null) return;
    setBusy(true);
    setError(null);
    const body: MenuInput = { name: draft.name.trim(), note: draft.note.trim(), price, section: draft.section.trim() || null, imageUrl: draft.imageUrl.trim() || null, sortOrder: Math.max(0, parseInt(draft.sortOrder, 10) || 0), active: draft.active };
    try {
      if (draft.id) await client.put(`/v1/merchant/menu/${draft.id}`, body); else await client.post('/v1/merchant/menu', body);
      setNotice(draft.id ? 'Item saved.' : 'Item added.');
      setDraft(null);
      list.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: MenuRow) => {
    if (!window.confirm(`Delete “${r.name}”? To hide it for now, edit it and switch it off instead.`)) return;
    try {
      await client.del(`/v1/merchant/menu/${r.id}`);
      setNotice('Item deleted.');
      list.reload();
    } catch (e) {
      setNotice(null);
      setError(errorText(e));
    }
  };

  return (
    <>
      <PageHead title="Menu" sub="Items customers see on your page. Group them with a section, like Starters or Mains." actions={<button className="btn primary" onClick={() => { setError(null); setDraft(blank); }}>Add item</button>} />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error && !draft ? <Notice tone="error">{error}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data && list.data.length === 0 ? <div className="card muted">No items yet. Add your first dish or service.</div> : null}
      <div className="stack">
        {sections.map(([name, rows]) => (
          <div key={name}>
            <h2 style={{ margin: '4px 0 8px' }}>{name}</h2>
            <div className="table-wrap">
              <table>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.active ? '' : 'dim'}>
                      <td><strong>{r.name}</strong>{r.note ? <div className="muted small">{r.note}</div> : null}</td>
                      <td>{formatINR(r.price)}</td>
                      <td>{r.active ? null : <Badge>Hidden</Badge>}</td>
                      <td className="actions">
                        <button className="btn ghost sm" onClick={() => { setError(null); setDraft({ id: r.id, name: r.name, note: r.note, price: paiseToRupees(r.price), section: r.section ?? '', imageUrl: r.imageUrl ?? '', sortOrder: String(r.sortOrder), active: r.active }); }}>Edit</button>
                        <button className="btn ghost sm danger" onClick={() => remove(r)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {draft ? (
        <Modal title={draft.id ? 'Edit item' : 'Add item'} onClose={() => setDraft(null)}>
          <div className="stack">
            <Field label="Name"><input autoFocus value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <Field label="Short description"><input value={draft.note} maxLength={200} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></Field>
            <div className="grid2">
              <Field label="Price (₹)" hint={draft.price && price === null ? 'Enter an amount like 450 or 450.50.' : undefined}><input inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></Field>
              <Field label="Section"><input value={draft.section} maxLength={60} placeholder="Mains" onChange={(e) => setDraft({ ...draft, section: e.target.value })} /></Field>
            </div>
            <div className="grid2">
              <ImageField label="Photo (optional)" value={draft.imageUrl} onChange={(v) => setDraft({ ...draft, imageUrl: v })} />
              <Field label="Order" hint="Smaller numbers come first."><input inputMode="numeric" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })} /></Field>
            </div>
            <label className="check"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Show to customers</label>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot">
              <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn primary" disabled={busy || !draft.name.trim() || price === null} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
