import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from './auth';
import { showDateTime } from './time';

export type StaffAlert = { id: string; kind: string; title: string; body: string; link: string | null; createdAt: string; read: boolean };
type Inbox = { unread: number; items: StaffAlert[] };

const POLL_MS = 5000;
const SOUND_KEY = 'vibe.alerts.sound';

const safeGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };

/** A short two-note chime made in the browser, so no sound file is needed. Browsers allow it once the person has clicked anywhere on the page. */
function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g);
      g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.start(t);
      o.stop(t + 0.4);
    });
    setTimeout(() => void ctx.close(), 900);
  } catch { /* no audio available */ }
}

/**
 * The bell on both dashboards. It asks for new alerts every few seconds. When there is a new one it shows a banner, plays a chime (can be switched off),
 * puts the count in the browser tab's title, and, if the person allowed desktop notifications, shows one when the tab is in the background.
 * Staff alerts are shared by the whole team, so one person opening one marks it read for everyone.
 */
export function NotificationBell() {
  const { client, staff } = useAuth();
  const navigate = useNavigate();
  const [inbox, setInbox] = useState<Inbox>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<StaffAlert | null>(null);
  const [sound, setSound] = useState(() => safeGet(SOUND_KEY) !== 'off');
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const seen = useRef<Set<string> | null>(null);
  const baseTitle = useRef(document.title.replace(/^\(\d+\) /, ''));

  const load = useCallback(async () => {
    try {
      const next = await client.get<Inbox>('/v1/staff/notifications?limit=20');
      const ids = new Set(next.items.map((i) => i.id));
      if (seen.current) {
        const fresh = next.items.filter((i) => !seen.current!.has(i.id) && !i.read);
        if (fresh.length) {
          setToast(fresh[0]);
          if (safeGet(SOUND_KEY) !== 'off') chime();
          if (document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(fresh[0].title, { body: fresh[0].body });
        }
      }
      seen.current = ids;
      setInbox(next);
    } catch { /* offline or signed out: try again next time */ }
  }, [client]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => { if (!document.hidden) void load(); }, POLL_MS);
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearTimeout(first); clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [load]);

  useEffect(() => {
    document.title = inbox.unread > 0 ? `(${inbox.unread}) ${baseTitle.current}` : baseTitle.current;
  }, [inbox.unread]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const openAlert = async (a: StaffAlert) => {
    setOpen(false);
    setToast(null);
    if (!a.read) { await client.post(`/v1/staff/notifications/${a.id}/read`).catch(() => undefined); void load(); }
    if (a.link) navigate(a.link);
  };

  const readAll = async () => { await client.post('/v1/staff/notifications/read').catch(() => undefined); void load(); };

  const toggleSound = () => { const next = !sound; setSound(next); safeSet(SOUND_KEY, next ? 'on' : 'off'); if (next) chime(); };

  const askDesktop = async () => { if (typeof Notification !== 'undefined') setPerm(await Notification.requestPermission()); };

  if (!staff) return null;

  return (
    <div className="bell">
      <button className="bell-btn" aria-label={`Alerts${inbox.unread ? `, ${inbox.unread} new` : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        <span>Alerts</span>
        {inbox.unread > 0 ? <span className="bell-count">{inbox.unread > 99 ? '99+' : inbox.unread}</span> : null}
      </button>

      {open ? (
        <div className="bell-panel" role="dialog" aria-label="Alerts">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <strong>Alerts</strong>
            <button className="btn ghost sm" disabled={!inbox.unread} onClick={readAll}>Mark all read</button>
          </div>
          <div className="bell-list">
            {inbox.items.length === 0 ? <p className="muted small">Nothing yet. New customers, payments and reviews show up here.</p> : inbox.items.map((a) => (
              <button key={a.id} className={`bell-item${a.read ? '' : ' unread'}`} onClick={() => void openAlert(a)}>
                <strong>{a.title}</strong>
                {a.body ? <span className="small">{a.body}</span> : null}
                <span className="muted small">{showDateTime(a.createdAt)}</span>
              </button>
            ))}
          </div>
          <div className="row" style={{ marginTop: 8, gap: 12 }}>
            <label className="check small"><input type="checkbox" checked={sound} onChange={toggleSound} /> Sound</label>
            {perm === 'default' ? <button className="btn ghost sm" onClick={askDesktop}>Allow desktop alerts</button> : perm === 'granted' ? <span className="muted small">Desktop alerts on</span> : perm === 'denied' ? <span className="muted small">Desktop alerts blocked in this browser</span> : null}
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="toast" role="status" aria-live="polite">
          <button className="toast-body" onClick={() => void openAlert(toast)}>
            <strong>{toast.title}</strong>
            {toast.body ? <span className="small">{toast.body}</span> : null}
          </button>
          <button className="btn ghost sm" aria-label="Dismiss" onClick={() => setToast(null)}>✕</button>
        </div>
      ) : null}
    </div>
  );
}
