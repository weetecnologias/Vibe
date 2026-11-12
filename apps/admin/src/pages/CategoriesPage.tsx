import { useMemo, useState } from 'react';

import { BUILT_IN_ICONS, Badge, Field, ImageField, Loading, Modal, Notice, PageHead, errorText, useAsync, useAuth, type CategoryInput, type CategoryRow, MERCHANT_FEATURES, type MerchantFeature } from '@kit';

export type Ordered = CategoryRow & { depth: number };

/** Parents first, children underneath, each level in sort order. */
export function order(rows: CategoryRow[]): Ordered[] {
  const byParent = new Map<string | null, CategoryRow[]>();
  for (const r of rows) byParent.set(r.parentId, [...(byParent.get(r.parentId) ?? []), r]);
  const out: Ordered[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const r of (byParent.get(parent) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))) {
      out.push({ ...r, depth });
      walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

const slugify = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

type Draft = { id: string | null; parentId: string; name: string; slug: string; slugTouched: boolean; icon: string; iconUrl: string; imageUrl: string; sortOrder: string; active: boolean; payRedeem: boolean; menuLabel: string; inherit: boolean; features: MerchantFeature[] };

export function CategoriesPage() {
  const { client } = useAuth();
  const list = useAsync(() => client.get<CategoryRow[]>('/v1/admin/categories'), [client]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const rows = useMemo(() => order(list.data ?? []), [list.data]);
  const byId = useMemo(() => new Map((list.data ?? []).map((r) => [r.id, r])), [list.data]);

  const descendants = (id: string): Set<string> => {
    const out = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of list.data ?? []) if (r.parentId && out.has(r.parentId) && !out.has(r.id)) { out.add(r.id); grew = true; }
    }
    return out;
  };

  const open = (row: CategoryRow | null, parentId = '') => {
    setError(null);
    setDraft(row
      ? { id: row.id, parentId: row.parentId ?? '', name: row.name, slug: row.slug, slugTouched: true, icon: row.icon ?? '', iconUrl: row.iconUrl ?? '', imageUrl: row.imageUrl ?? '', sortOrder: String(row.sortOrder), active: row.active, payRedeem: row.payRedeem, menuLabel: row.menuLabel ?? '', inherit: row.features === null, features: row.features ?? row.effectiveFeatures }
      : { id: null, parentId, name: '', slug: '', slugTouched: false, icon: 'food', iconUrl: '', imageUrl: '', sortOrder: '0', active: true, payRedeem: true, menuLabel: '', inherit: !!parentId, features: parentId ? (rows.find((r) => r.id === parentId)?.effectiveFeatures ?? []) : ['bills', 'offers', 'menu', 'promotions'] });
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    const body: CategoryInput = {
      parentId: draft.parentId || null, slug: draft.slug.trim(), name: draft.name.trim(), icon: draft.icon || null, iconUrl: draft.iconUrl.trim() || null,
      imageUrl: draft.imageUrl.trim() || null, sortOrder: Math.max(0, parseInt(draft.sortOrder, 10) || 0), active: draft.active, payRedeem: draft.inherit ? draft.payRedeem : draft.features.includes('bills'), menuLabel: draft.menuLabel.trim() || null, features: draft.inherit ? null : draft.features,
    };
    try {
      if (draft.id) await client.put(`/v1/admin/categories/${draft.id}`, body); else await client.post('/v1/admin/categories', body);
      setDraft(null);
      setNotice(draft.id ? 'Category saved.' : 'Category added. The customer app shows it the next time it loads.');
      list.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: CategoryRow) => {
    if (!window.confirm(`Delete “${row.name}”? This can’t be undone. To hide it instead, edit it and switch it off.`)) return;
    setNotice(null);
    try {
      await client.del(`/v1/admin/categories/${row.id}`);
      setNotice('Category deleted.');
      list.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  // A category can go under any category that is not itself or inside itself, and not already on the third level.
  const parentOptions = draft ? rows.filter((r) => r.level < 3 && !(draft.id && descendants(draft.id).has(r.id))) : [];

  return (
    <>
      <PageHead title="Categories" sub="Add as many categories and subcategories as you need, up to three levels. The customer app shows changes the next time it loads."
        actions={<button className="btn primary" onClick={() => open(null)}>Add category</button>} />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Slug</th><th>Merchants get</th><th>Businesses</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.active ? '' : 'dim'}>
                  <td><span className={`indent-${r.depth + 1}`}>{r.depth > 0 ? '↳ ' : ''}<strong>{r.name}</strong></span></td>
                  <td className="muted small">{r.slug}</td>
                  <td className="small">{r.effectiveFeatures.length ? MERCHANT_FEATURES.filter((f) => r.effectiveFeatures.includes(f.key)).map((f) => f.label).join(', ') : <span className="muted">Not for merchants</span>}{r.features === null && r.parentId ? <div className="muted">Same as parent</div> : null}</td>
                  <td>{r.businessCount}</td>
                  <td>{r.active ? <Badge tone="success">Live</Badge> : <Badge>Hidden</Badge>}</td>
                  <td className="actions">
                    {r.level < 3 ? <button className="btn ghost sm" onClick={() => open(null, r.id)}>Add sub</button> : null}
                    <button className="btn ghost sm" onClick={() => open(r)}>Edit</button>
                    <button className="btn ghost sm danger" onClick={() => remove(r)}>Delete</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? <tr><td colSpan={6} className="muted">No categories yet. Add the first one.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}

      {draft ? (
        <Modal title={draft.id ? 'Edit category' : draft.parentId ? `New subcategory under ${byId.get(draft.parentId)?.name ?? ''}` : 'New category'} onClose={() => setDraft(null)}>
          <div className="stack">
            <Field label="Name"><input value={draft.name} maxLength={80} autoFocus onChange={(e) => setDraft({ ...draft, name: e.target.value, slug: draft.slugTouched ? draft.slug : slugify(e.target.value) })} /></Field>
            <Field label="Slug" hint="Lower-case letters, numbers, dots and dashes. Used in links.">
              <input value={draft.slug} maxLength={80} onChange={(e) => setDraft({ ...draft, slug: e.target.value, slugTouched: true })} />
            </Field>
            <Field label="Inside">
              <select value={draft.parentId} onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}>
                <option value="">Top level</option>
                {parentOptions.map((r) => <option key={r.id} value={r.id}>{'— '.repeat(r.depth)}{r.name}</option>)}
              </select>
            </Field>
            <div className="grid2">
              <Field label="Built-in icon">
                <select value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })}>
                  <option value="">None</option>
                  {BUILT_IN_ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </Field>
              <Field label="Order" hint="Smaller numbers come first."><input inputMode="numeric" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })} /></Field>
            </div>
            <ImageField label="Uploaded icon (optional)" value={draft.iconUrl} onChange={(v) => setDraft({ ...draft, iconUrl: v })} hint="PNG, JPEG or WebP. Used instead of the built-in icon when set." />
            <ImageField label="Picture (optional)" value={draft.imageUrl} onChange={(v) => setDraft({ ...draft, imageUrl: v })} />
            <fieldset className="hours">
              <legend>What merchants in this category get</legend>
              <p className="muted small" style={{ marginTop: 0 }}>A business onboarded here sees only these in its dashboard, and the server refuses the rest. Subcategories follow unless they set their own. Untick everything for a category merchants can’t join (like VIBE Social).</p>
              {draft.parentId ? <label className="check"><input type="checkbox" checked={draft.inherit} onChange={(e) => setDraft({ ...draft, inherit: e.target.checked, features: rows.find((r) => r.id === draft.parentId)?.effectiveFeatures ?? draft.features })} /> Same as the parent category</label> : null}
              <div className="grid2">
                {MERCHANT_FEATURES.map((f) => (
                  <label key={f.key} className="check" style={{ opacity: draft.inherit ? 0.5 : 1 }}>
                    <input type="checkbox" disabled={draft.inherit} checked={draft.features.includes(f.key)} onChange={(e) => setDraft({ ...draft, features: e.target.checked ? [...draft.features, f.key] : draft.features.filter((x) => x !== f.key) })} />
                    <span><strong>{f.label}</strong> <span className="muted small">{f.hint}</span></span>
                  </label>
                ))}
              </div>
              <small className="muted">Always included: profile and photos, reviews, results, settlements and the team.</small>
              <Field label="What the item list is called" hint="Shown to merchants, for example Menu, Price list or Services. Empty uses the parent category’s, or Menu."><input value={draft.menuLabel} maxLength={30} onChange={(e) => setDraft({ ...draft, menuLabel: e.target.value })} placeholder="Menu" /></Field>
            </fieldset>
            <label className="check"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Live in the customer app</label>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot">
              <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn primary" disabled={busy || !draft.name.trim() || !draft.slug.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
