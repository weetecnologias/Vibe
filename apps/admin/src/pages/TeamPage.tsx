import { useState } from 'react';

import { Badge, Field, Loading, Modal, Notice, PageHead, errorText, showDateTime, useAsync, useAuth, type AdminArea, type AdminRole, type AdminTeamMember, type CategoryRow } from '@kit';

import { useAccess } from '../access';

const ROLES: { key: AdminRole; label: string; hint: string }[] = [
  { key: 'super_admin', label: 'Super admin', hint: 'Everything, including every admin account.' },
  { key: 'admin', label: 'Admin', hint: 'CEO level: everything, and staff accounts. Not other admins.' },
  { key: 'staff', label: 'Staff', hint: 'Only the areas you tick. Optionally only some categories (a category manager).' },
];
const ROLE_LABEL: Record<AdminRole, string> = { super_admin: 'Super admin', admin: 'Admin', staff: 'Staff' };

type Access = { role: AdminRole; areas: AdminArea[]; categoryIds: string[] };

function AccessFields({ value, onChange, superAdmin }: { value: Access; onChange: (a: Access) => void; superAdmin: boolean }) {
  const me = useAccess();
  const { client } = useAuth();
  const cats = useAsync(() => client.get<CategoryRow[]>('/v1/admin/categories'), [client]);
  const tops = (cats.data ?? []).filter((c) => c.level <= 2);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="stack">
      <Field label="Role">
        <div className="stack" style={{ gap: 6 }}>
          {ROLES.map((r) => (
            <label key={r.key} className="check" style={{ opacity: !superAdmin && r.key !== 'staff' ? 0.5 : 1 }}>
              <input type="radio" name="role" checked={value.role === r.key} disabled={!superAdmin && r.key !== 'staff'} onChange={() => onChange({ ...value, role: r.key })} />
              <span><strong>{r.label}</strong> <span className="muted small">{r.hint}</span></span>
            </label>
          ))}
        </div>
      </Field>
      {value.role === 'staff' ? (
        <>
          <fieldset className="hours">
            <legend>What they can open</legend>
            {(Object.entries(me.allAreas) as [AdminArea, string][]).map(([k, label]) => (
              <label key={k} className="check"><input type="checkbox" checked={value.areas.includes(k)} onChange={() => onChange({ ...value, areas: toggle(value.areas, k) })} /> {label}</label>
            ))}
          </fieldset>
          <fieldset className="hours">
            <legend>Only these categories (optional)</legend>
            <p className="muted small" style={{ marginTop: 0 }}>Leave all unticked for every category. Ticked: they see partners, reviews, transactions and reports for those categories and everything under them.</p>
            {cats.loading && !cats.data ? <Loading /> : (
              <div className="grid2">
                {tops.map((c) => (
                  <label key={c.id} className="check"><input type="checkbox" checked={value.categoryIds.includes(c.id)} onChange={() => onChange({ ...value, categoryIds: toggle(value.categoryIds, c.id) })} /> {c.level > 1 ? '↳ ' : ''}{c.name}</label>
                ))}
              </div>
            )}
          </fieldset>
        </>
      ) : null}
    </div>
  );
}

/**
 * VIBE's own team. Super admins manage everyone; admins (CEO level) manage staff accounts. Staff get only the areas ticked, and can be
 * limited to some categories, which makes them category managers. Changes apply on the person's next click.
 */
export function TeamPage() {
  const { client } = useAuth();
  const me = useAccess();
  const superAdmin = me.role === 'super_admin';
  const list = useAsync(() => client.get<AdminTeamMember[]>('/v1/admin/team'), [client]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AdminTeamMember | null>(null);
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [access, setAccess] = useState<Access>({ role: 'staff', areas: [], categoryIds: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canManage = (m: AdminTeamMember) => m.id !== me.id && (superAdmin || m.role === 'staff');

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const m = await client.post<AdminTeamMember>('/v1/admin/team', { ...form, role: access.role, areas: access.areas, categoryIds: access.categoryIds });
      setNotice(`${m.name} can sign in now with the password you set. They’ll choose their own on first sign-in.`);
      setAdding(false);
      list.reload();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const m = await client.put<AdminTeamMember>(`/v1/admin/team/${editing.id}/access`, { role: access.role, areas: access.areas, categoryIds: access.categoryIds });
      setNotice(`${m.name} is now ${ROLE_LABEL[m.role].toLowerCase()}. It applies on their next click.`);
      setEditing(null);
      list.reload();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const toggle = async (m: AdminTeamMember) => {
    setError(null);
    try { await client.post(`/v1/admin/staff/${m.id}/${m.active ? 'deactivate' : 'activate'}`); list.reload(); } catch (e) { setError(errorText(e)); }
  };

  const open = (m: AdminTeamMember | null) => {
    setError(null);
    setNotice(null);
    if (m) { setEditing(m); setAccess({ role: m.role, areas: m.areas, categoryIds: m.categories.map((c) => c.id) }); }
    else { setAdding(true); setForm({ name: '', email: '', password: '' }); setAccess({ role: 'staff', areas: [], categoryIds: [] }); }
  };

  return (
    <>
      <PageHead title="VIBE team" sub="Who works in this dashboard and what each person can open. Super admins manage everyone; admins manage staff accounts." actions={<button className="btn primary" onClick={() => open(null)}>Add team member</button>} />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error && !adding && !editing ? <Notice tone="error">{error}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Can open</th><th>Categories</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data?.map((m) => (
                <tr key={m.id} className={m.active ? '' : 'dim'}>
                  <td><strong>{m.name}</strong>{m.id === me.id ? <> <Badge>You</Badge></> : null}<div className="muted small">{m.email} · since {showDateTime(m.createdAt)}</div></td>
                  <td><Badge tone={m.role === 'staff' ? 'muted' : 'pink'}>{ROLE_LABEL[m.role]}</Badge></td>
                  <td className="small">{m.role === 'staff' ? m.areas.map((a) => me.allAreas[a]?.split(':')[0] ?? a).join(', ') : 'Everything'}</td>
                  <td className="small">{m.role === 'staff' && m.categories.length ? m.categories.map((c) => c.name).join(', ') : 'All'}</td>
                  <td>{m.active ? <Badge tone="success">Active</Badge> : <Badge>Switched off</Badge>}{m.mustChangePassword ? <div className="muted small">Hasn’t signed in yet</div> : null}</td>
                  <td className="actions">
                    {canManage(m) ? <button className="btn ghost sm" onClick={() => open(m)}>Change access</button> : null}
                    {canManage(m) ? <button className="btn ghost sm" onClick={() => toggle(m)}>{m.active ? 'Switch off' : 'Switch on'}</button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding ? (
        <Modal title="Add a team member" onClose={() => setAdding(false)} wide>
          <div className="stack">
            <div className="grid3">
              <Field label="Name"><input value={form.name} maxLength={120} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Email"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="First password" hint="At least 10 characters. They change it on first sign-in."><input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            </div>
            <AccessFields value={access} onChange={setAccess} superAdmin={superAdmin} />
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot"><button className="btn" onClick={() => setAdding(false)}>Cancel</button><button className="btn primary" disabled={busy || !form.name.trim() || form.password.length < 10} onClick={add}>{busy ? 'Adding…' : 'Add'}</button></div>
          </div>
        </Modal>
      ) : null}
      {editing ? (
        <Modal title={`Access for ${editing.name}`} onClose={() => setEditing(null)} wide>
          <div className="stack">
            <AccessFields value={access} onChange={setAccess} superAdmin={superAdmin} />
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot"><button className="btn" onClick={() => setEditing(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
