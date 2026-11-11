import { useState } from 'react';

import { errorText, type Session } from './api';
import { useAuth } from './auth';

/**
 * Shown before anything else when the login was made by someone else (an admin, or the owner who added a team member).
 * Their password is known to that person, so the account's owner chooses a new one now.
 */
export function ChangePasswordPage() {
  const { staff, client, adopt, signOut } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = again.length > 0 && next !== again;
  const ready = current.length > 0 && next.length >= 10 && next === again;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      adopt(await client.post<Session>('/v1/staff/password', { current, next }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand"><span className="brand-vibe">VIBE</span> <span>Choose your password</span></div>
        <p className="muted small" style={{ margin: 0 }}>Hello {staff?.name}. The password you were given is known to the person who set up your login. Choose your own to continue.</p>
        <label className="field"><span>Password you were given</span><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
        <label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /><small className="muted">At least 10 characters.</small></label>
        <label className="field"><span>New password again</span><input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />{mismatch ? <small style={{ color: 'var(--error)' }}>These don’t match.</small> : null}</label>
        {error ? <div className="notice error" role="alert">{error}</div> : null}
        <button className="btn primary" disabled={busy || !ready}>{busy ? 'Saving…' : 'Save and continue'}</button>
        <button type="button" className="btn ghost" onClick={signOut}>Sign out</button>
      </form>
    </div>
  );
}
