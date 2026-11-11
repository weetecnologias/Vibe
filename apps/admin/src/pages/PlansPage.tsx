import { useState } from 'react';

import { Badge, Field, Loading, Modal, Notice, PageHead, errorText, formatINR, paiseToRupees, rupeesToPaise, useAsync, useAuth, type Plan, type PlanInput } from '@kit';

type Draft = { id: string | null; name: string; interval: 'month' | 'year'; price: string; note: string; savingsLabel: string; benefits: string; sortOrder: string; active: boolean };
const blank: Draft = { id: null, name: '', interval: 'month', price: '', note: '', savingsLabel: '', benefits: '', sortOrder: '0', active: true };

export function PlansPage() {
  const { client } = useAuth();
  const list = useAsync(() => client.get<Plan[]>('/v1/admin/plans'), [client]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const price = draft ? rupeesToPaise(draft.price) : null;

  const save = async () => {
    if (!draft || price === null) return;
    setBusy(true);
    setError(null);
    const body: PlanInput = {
      name: draft.name.trim(), interval: draft.interval, price, note: draft.note.trim(), savingsLabel: draft.savingsLabel.trim() || null,
      benefits: draft.benefits.split('\n').map((l) => l.trim()).filter(Boolean), sortOrder: Math.max(0, parseInt(draft.sortOrder, 10) || 0), active: draft.active,
    };
    try {
      if (draft.id) await client.put(`/v1/admin/plans/${draft.id}`, body); else await client.post('/v1/admin/plans', body);
      setNotice('Plan saved.');
      setDraft(null);
      list.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Plan) => {
    if (!window.confirm(`Delete the ${p.name} plan? To stop selling it, edit it and switch it off instead.`)) return;
    try {
      await client.del(`/v1/admin/plans/${p.id}`);
      setNotice('Plan deleted.');
      list.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <>
      <PageHead title="Membership plans" sub="What VIBE membership costs. Customers see only the plans that are switched on." actions={<button className="btn primary" onClick={() => { setError(null); setDraft(blank); }}>Add plan</button>} />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error && !draft ? <Notice tone="error">{error}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Plan</th><th>Price</th><th>Benefits</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data?.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'dim'}>
                  <td><strong>{p.name}</strong>{p.savingsLabel ? <> <Badge tone="pink">{p.savingsLabel}</Badge></> : null}<div className="muted small">{p.note}</div></td>
                  <td>{formatINR(p.price)} <span className="muted small">/ {p.interval}</span></td>
                  <td className="small">{p.benefits.join(' · ') || '—'}</td>
                  <td>{p.active ? <Badge tone="success">On sale</Badge> : <Badge>Switched off</Badge>}</td>
                  <td className="actions">
                    <button className="btn ghost sm" onClick={() => { setError(null); setDraft({ id: p.id, name: p.name, interval: p.interval, price: paiseToRupees(p.price), note: p.note, savingsLabel: p.savingsLabel ?? '', benefits: p.benefits.join('\n'), sortOrder: String(p.sortOrder), active: p.active }); }}>Edit</button>
                    <button className="btn ghost sm danger" onClick={() => remove(p)}>Delete</button>
                  </td>
                </tr>
              ))}
              {list.data?.length === 0 ? <tr><td colSpan={5} className="muted">No plans yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {draft ? (
        <Modal title={draft.id ? 'Edit plan' : 'Add plan'} onClose={() => setDraft(null)}>
          <div className="stack">
            <div className="grid2">
              <Field label="Name"><input autoFocus value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
              <Field label="Billed"><select value={draft.interval} onChange={(e) => setDraft({ ...draft, interval: e.target.value as 'month' | 'year' })}><option value="month">Every month</option><option value="year">Every year</option></select></Field>
            </div>
            <div className="grid2">
              <Field label="Price (₹)" hint={draft.price && price === null ? 'Enter an amount like 299 or 2,999.' : undefined}><input inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></Field>
              <Field label="Savings label (optional)"><input value={draft.savingsLabel} maxLength={60} placeholder="Save 17%" onChange={(e) => setDraft({ ...draft, savingsLabel: e.target.value })} /></Field>
            </div>
            <Field label="Short note"><input value={draft.note} maxLength={160} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></Field>
            <Field label="Benefits" hint="One per line. Up to 12."><textarea rows={4} value={draft.benefits} onChange={(e) => setDraft({ ...draft, benefits: e.target.value })} /></Field>
            <div className="grid2">
              <Field label="Order" hint="Smaller numbers come first. The first plan is the one promoted on the home screen."><input inputMode="numeric" value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })} /></Field>
              <Field label="Status"><label className="check"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> On sale</label></Field>
            </div>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot">
              <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
              <button className="btn primary" disabled={busy || !draft.name.trim() || price === null} onClick={save}>{busy ? 'Saving…' : 'Save plan'}</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
