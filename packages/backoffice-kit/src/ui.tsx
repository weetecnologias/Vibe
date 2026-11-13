import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from './auth';
import { NotificationBell } from './NotificationBell';

/** Loads data when `deps` change and lets the caller reload it. Ignores answers that arrive after the screen moved on. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ key: string; data?: T; error?: string }>({ key: '' });
  const key = JSON.stringify([deps, tick]);
  useEffect(() => {
    let live = true;
    fn().then(
      (data) => live && setState({ key, data }),
      (e: unknown) => live && setState((s) => ({ key, data: s.data, error: e instanceof Error ? e.message : 'Something went wrong.' })),
    );
    return () => { live = false; };
    // `key` already encodes deps and reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((u: (d: T | undefined) => T | undefined) => setState((s) => ({ ...s, data: u(s.data) })), []);
  return { data: state.data, error: state.key === key ? state.error : undefined, loading: state.key !== key, reload, setData };
}

export type NavItem = { to: string; label: string; badge?: number } | { heading: string };

/**
 * The dashboard frame: menu on the left, page on the right. `switcher` sits above the menu (the admin's category picker). On a narrow screen the
 * menu folds behind a Menu button instead of wrapping across the top of the page.
 */
export function Shell({ title, nav, switcher }: { title: string; nav: NavItem[]; switcher?: ReactNode }) {
  const { staff, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => { setOpen(false); }, [location.pathname]);
  return (
    <div className="shell">
      <aside className={`side${open ? ' open' : ''}`}>
        <div className="side-top">
          <div className="brand"><span className="brand-vibe">VIBE</span> <span>{title}</span></div>
          <button type="button" className="btn ghost sm menu-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close' : 'Menu'}</button>
        </div>
        {switcher}
        <NotificationBell />
        <nav>{nav.map((n) => ('heading' in n ? <div key={n.heading} className="nav-heading">{n.heading}</div> : <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>{n.label}{n.badge ? <span className="nav-badge">{n.badge}</span> : null}</NavLink>))}</nav>
        <div className="side-foot">
          <div className="small">{staff?.name}</div>
          <div className="small muted">{staff?.email}</div>
          <button className="btn ghost" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <main className="main"><Outlet /></main>
    </div>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div><h1>{title}</h1>{sub ? <p className="muted">{sub}</p> : null}</div>
      <div className="row">{actions}</div>
    </header>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error' | 'success'; children: ReactNode }) {
  return <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'success' | 'warning' | 'pink' }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small className="muted">{hint}</small> : null}
    </label>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2><button className="btn ghost" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}

/** A button that downloads a spreadsheet from the server. Shows its own error if the download fails. */
export function DownloadButton({ path, filename, label = 'Download Excel (CSV)', small }: { path: string; filename: string; label?: string; small?: boolean }) {
  const { client } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try { await client.download(path, filename); } catch (e) { setError(e instanceof Error ? e.message : 'The download didn’t work.'); } finally { setBusy(false); }
  };
  return (
    <span className="download">
      <button type="button" className={`btn${small ? ' sm' : ''}`} disabled={busy} onClick={go}>{busy ? 'Preparing…' : label}</button>
      {error ? <span className="small" role="alert" style={{ color: 'var(--error)' }}>{error}</span> : null}
    </span>
  );
}

export function Loading({ what = 'Loading' }: { what?: string }) {
  return <p className="muted" role="status">{what}…</p>;
}
