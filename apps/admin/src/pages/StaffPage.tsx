import { useState } from 'react';

import { Badge, Field, Loading, Modal, Notice, PageHead, errorText, useAsync, useAuth, type Staff } from '@kit';

export function StaffPage() {
  const { client, staff: me } = useAuth();
  const list = useAsync(() => client.get<Staff[]>('/v1/admin/staff'), [client]);
  const [reset, setReset] = useState<Staff | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const toggle = async (s: Staff) => {
    setError(null);
    setNotice(null);
    try {
      await client.post(`/v1/admin/staff/${s.id}/${s.active ? 'deactivate' : 'activate'}`);
      list.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const doReset = async () => {
    if (!reset) return;
    setError(null);
    try {
      await client.put(`/v1/admin/staff/${reset.id}/password`, { password });
      setNotice(`Password changed for ${reset.email}.`);
      setReset(null);
      setPassword('');
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <>
      <PageHead title="Staff accounts" sub="Admins and merchant logins. Merchant logins are created from the business page." />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data?.map((s) => (
                <tr key={s.id} className={s.active ? '' : 'dim'}>
                  <td><strong>{s.name}</strong></td>
                  <td>{s.email}</td>
                  <td><Badge tone={s.role === 'ADMIN' ? 'pink' : 'muted'}>{s.role === 'ADMIN' ? 'Admin' : s.owner ? 'Merchant owner' : 'Merchant staff'}</Badge></td>
                  <td>{s.active ? <Badge tone="success">Active</Badge> : <Badge>Switched off</Badge>}</td>
                  <td className="actions">
                    <button className="btn ghost sm" onClick={() => { setError(null); setReset(s); }}>Reset password</button>
                    <button className="btn ghost sm" disabled={s.id === me?.id && s.active} onClick={() => toggle(s)}>{s.active ? 'Switch off' : 'Switch on'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reset ? (
        <Modal title={`Reset password for ${reset.email}`} onClose={() => setReset(null)}>
          <div className="stack">
            <Field label="New password" hint="At least 10 characters. Share it privately."><input type="password" autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot">
              <button className="btn" onClick={() => setReset(null)}>Cancel</button>
              <button className="btn primary" disabled={password.length < 10} onClick={doReset}>Change password</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
