import { useState } from 'react';

import { Badge, Field, Loading, Modal, Notice, PageHead, errorText, useAsync, useAuth, type Staff } from '@kit';

export function TeamPage() {
  const { client, staff: me } = useAuth();
  const team = useAsync(() => client.get<Staff[]>('/v1/merchant/team'), [client]);
  const isOwner = team.data?.find((s) => s.id === me?.id)?.owner ?? false;
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [reset, setReset] = useState<Staff | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await client.post('/v1/merchant/team', { email, name, password });
      setNotice(`Login created for ${email}. Share the password with them privately.`);
      setEmail(''); setName(''); setPassword('');
      team.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (s: Staff) => {
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
      <PageHead title="Team" sub="People who can sign in to this dashboard for your business. Only the owner can add or remove them." />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error && !reset ? <Notice tone="error">{error}</Notice> : null}
      {team.error ? <Notice tone="error">{team.error}</Notice> : null}
      {team.loading && !team.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>
              {team.data?.map((s) => (
                <tr key={s.id} className={s.active ? '' : 'dim'}>
                  <td><strong>{s.name}</strong>{s.id === me?.id ? <span className="muted small"> (you)</span> : null}</td>
                  <td>{s.email}</td>
                  <td>{s.owner ? <Badge tone="pink">Owner</Badge> : <Badge>Staff</Badge>}</td>
                  <td>{s.active ? <Badge tone="success">Active</Badge> : <Badge>Switched off</Badge>}</td>
                  <td className="actions">
                    {isOwner && !s.owner ? (
                      <>
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

      {isOwner ? (
        <div className="card stack" style={{ marginTop: 18 }}>
          <h2>Add a team member</h2>
          <div className="grid3">
            <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></Field>
            <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></Field>
            <Field label="Password" hint="At least 10 characters."><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
          </div>
          <div className="row"><button className="btn primary" disabled={busy || !email || !name || password.length < 10} onClick={add}>{busy ? 'Adding…' : 'Add team member'}</button></div>
        </div>
      ) : team.data ? <p className="muted small" style={{ marginTop: 14 }}>Ask the account owner to add or remove team members.</p> : null}

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
