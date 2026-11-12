import { useState } from 'react';

import { Badge, Field, Loading, Modal, Notice, PageHead, errorText, useAsync, useAuth, type StaffRole, type TeamMember } from '@kit';

import { useSettings } from '../settings';

/** What each preset means, in the owner's words. The server holds everyone to these, not just this menu. */
export const ROLES: { key: StaffRole; label: string; hint: string }[] = [
  { key: 'cashier', label: 'Cashier / waiter', hint: 'Bills only: sees customers waiting, raises and withdraws bills. Nothing else.' },
  { key: 'manager', label: 'Manager', hint: 'Everything except the team: bills, offers, events, menu, profile, reservations, results and settlements.' },
  { key: 'custom', label: 'Custom', hint: 'Only the areas you tick.' },
];
const ROLE_LABEL: Record<StaffRole, string> = { cashier: 'Cashier / waiter', manager: 'Manager', custom: 'Custom' };

type Access = { staffRole: StaffRole; permissions: string[] };

function RoleFields({ value, onChange, areas }: { value: Access; onChange: (a: Access) => void; areas: Record<string, string> }) {
  return (
    <div className="stack">
      <fieldset className="hours">
        <legend>Role</legend>
        <div className="stack" style={{ gap: 8 }}>
          {ROLES.map((r) => (
            <label key={r.key} className="check" style={{ alignItems: 'flex-start' }}>
              <input type="radio" name="role" checked={value.staffRole === r.key} onChange={() => onChange({ ...value, staffRole: r.key })} />
              <span><strong>{r.label}</strong><span className="muted small" style={{ display: 'block' }}>{r.hint}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      {value.staffRole === 'custom' ? (
        <fieldset className="hours">
          <legend>What they can do</legend>
          <div className="stack" style={{ gap: 6 }}>
            {Object.entries(areas).map(([k, label]) => (
              <label key={k} className="check">
                <input type="checkbox" checked={value.permissions.includes(k)} onChange={(e) => onChange({ ...value, permissions: e.target.checked ? [...value.permissions, k] : value.permissions.filter((p) => p !== k) })} /> {label}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}

const areaNames = (perms: string[], areas: Record<string, string>) => perms.map((p) => (areas[p] ?? p).split(':')[0]).join(', ');

/** Only the owner sees this page. They add people, choose what each may do, and can change it or switch them off at any time. */
export function TeamPage() {
  const { client, staff: me } = useAuth();
  const settings = useSettings();
  const areas = settings.areas ?? {};
  const team = useAsync(() => client.get<TeamMember[]>('/v1/merchant/team'), [client]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [access, setAccess] = useState<Access>({ staffRole: 'cashier', permissions: [] });
  const [reset, setReset] = useState<TeamMember | null>(null);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const accessOk = access.staffRole !== 'custom' || access.permissions.length > 0;

  const add = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await client.post('/v1/merchant/team', { email, name, password, ...access });
      setNotice(`Login created for ${email} as ${ROLE_LABEL[access.staffRole].toLowerCase()}. Share the password with them privately; they choose their own when they first sign in.`);
      setEmail(''); setName(''); setPassword(''); setAccess({ staffRole: 'cashier', permissions: [] });
      team.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (s: TeamMember) => {
    setError(null);
    setNotice(null);
    try {
      await client.post(`/v1/merchant/team/${s.id}/${s.active ? 'deactivate' : 'activate'}`);
      team.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const doReset = async () => {
    if (!reset) return;
    setError(null);
    try {
      await client.put(`/v1/merchant/team/${reset.id}/password`, { password: newPassword });
      setNotice(`Password changed for ${reset.email}.`);
      setReset(null);
      setNewPassword('');
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <>
      <PageHead title="Team" sub="People who can sign in to this dashboard for your business, and what each of them may do. You, the owner, can do everything." />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error && !reset && !editing ? <Notice tone="error">{error}</Notice> : null}
      {team.error ? <Notice tone="error">{team.error}</Notice> : null}
      {team.loading && !team.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Can do</th><th>Status</th><th /></tr></thead>
            <tbody>
              {team.data?.map((s) => (
                <tr key={s.id} className={s.active ? '' : 'dim'}>
                  <td><strong>{s.name}</strong>{s.id === me?.id ? <span className="muted small"> (you)</span> : null}<div className="muted small">{s.email}</div></td>
                  <td>{s.owner ? <Badge tone="pink">Owner</Badge> : <Badge>{s.staffRole ? ROLE_LABEL[s.staffRole] : 'Staff'}</Badge>}</td>
                  <td className="small">{s.owner ? 'Everything' : areaNames(s.permissions, areas) || '—'}</td>
                  <td>{s.active ? <Badge tone="success">Active</Badge> : <Badge>Switched off</Badge>}</td>
                  <td className="actions">
                    {!s.owner ? (
                      <>
                        <button className="btn ghost sm" onClick={() => { setError(null); setEditing(s); }}>Change role</button>
                        <button className="btn ghost sm" onClick={() => { setError(null); setReset(s); }}>Reset password</button>
                        <button className="btn ghost sm" onClick={() => toggle(s)}>{s.active ? 'Switch off' : 'Switch on'}</button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card stack" style={{ marginTop: 18 }}>
        <h2>Add a team member</h2>
        <div className="grid3">
          <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></Field>
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></Field>
          <Field label="Password" hint="At least 10 characters. They choose their own when they first sign in."><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
        </div>
        <RoleFields value={access} onChange={setAccess} areas={areas} />
        <div className="row"><button className="btn primary" disabled={busy || !email || !name || password.length < 10 || !accessOk} onClick={add}>{busy ? 'Adding…' : 'Add team member'}</button></div>
      </div>

      {editing ? <ChangeRole member={editing} areas={areas} onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); setNotice(`${m.name} is now ${ROLE_LABEL[m.staffRole ?? 'custom'].toLowerCase()}. It applies straight away.`); team.reload(); }} /> : null}

      {reset ? (
        <Modal title={`Reset password for ${reset.email}`} onClose={() => setReset(null)}>
          <div className="stack">
            <Field label="New password" hint="At least 10 characters. Share it privately."><input type="password" autoFocus autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></Field>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot">
              <button className="btn" onClick={() => setReset(null)}>Cancel</button>
              <button className="btn primary" disabled={newPassword.length < 10} onClick={doReset}>Change password</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function ChangeRole({ member, areas, onClose, onSaved }: { member: TeamMember; areas: Record<string, string>; onClose: () => void; onSaved: (m: TeamMember) => void }) {
  const { client } = useAuth();
  const [access, setAccess] = useState<Access>({ staffRole: member.staffRole ?? 'custom', permissions: member.permissions });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try { onSaved(await client.put<TeamMember>(`/v1/merchant/team/${member.id}/access`, access)); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`What ${member.name} can do`} onClose={onClose}>
      <div className="stack">
        <RoleFields value={access} onChange={setAccess} areas={areas} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || (access.staffRole === 'custom' && access.permissions.length === 0)} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </Modal>
  );
}
