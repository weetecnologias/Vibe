import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { createClient, errorText, type Client, type Role, type Session, type Staff } from './api';

type Auth = { staff: Staff | null; client: Client; signIn(email: string, password: string): Promise<void>; signOut(): void; adopt(session: Session): void };

const Ctx = createContext<Auth | null>(null);

const KEY = 'vibe.staff.session';

function load(role: Role): Session | null {
  try {
    const raw = sessionStorage.getItem(`${KEY}.${role}`);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    return Date.parse(s.expiresAt) > Date.now() && s.staff.role === role ? s : null;
  } catch {
    return null;
  }
}

/**
 * Keeps the signed-in staff member for this browser tab only (sessionStorage), so closing the tab signs out.
 * Each dashboard accepts only its own role: an admin token is never accepted by the merchant dashboard and the other way round.
 */
export function AuthProvider({ role, baseUrl, children }: { role: Role; baseUrl: string; children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => load(role));

  const signOut = useCallback(() => {
    try { sessionStorage.removeItem(`${KEY}.${role}`); } catch { /* storage blocked */ }
    setSession(null);
  }, [role]);

  const client = useMemo(
    () => createClient({ baseUrl, token: () => session?.token ?? null, onUnauthorized: signOut }),
    [baseUrl, session?.token, signOut],
  );

  const signIn = useCallback(async (email: string, password: string) => {
    const s = await createClient({ baseUrl, token: () => null, onUnauthorized: () => {} }).login(email, password);
    if (s.staff.role !== role) throw new Error(role === 'ADMIN' ? 'This is the admin dashboard. Use the merchant dashboard instead.' : 'This is the merchant dashboard. Use the admin dashboard instead.');
    try { sessionStorage.setItem(`${KEY}.${role}`, JSON.stringify(s)); } catch { /* storage blocked: stay signed in for this page only */ }
    setSession(s);
  }, [baseUrl, role]);

  /** Replaces the session, for example after choosing a new password returns a fresh one. */
  const adopt = useCallback((s: Session) => {
    try { sessionStorage.setItem(`${KEY}.${role}`, JSON.stringify(s)); } catch { /* storage blocked */ }
    setSession(s);
  }, [role]);

  const value = useMemo<Auth>(() => ({ staff: session?.staff ?? null, client, signIn, signOut, adopt }), [session, client, signIn, signOut, adopt]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): Auth {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}

export function LoginPage({ title, hint, footer }: { title: string; hint?: string; footer?: ReactNode }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand"><span className="brand-vibe">VIBE</span> <span>{title}</span></div>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error ? <div className="notice error" role="alert">{error}</div> : null}
        <button className="btn primary" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {hint ? <p className="muted small">{hint}</p> : null}
        {footer}
      </form>
    </div>
  );
}
