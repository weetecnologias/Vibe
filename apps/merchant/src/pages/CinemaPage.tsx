import { useState } from 'react';

import {
  Badge, Field, Loading, Modal, Notice, PageHead, errorText, formatINR, fromLocalInput, paiseToRupees, rupeesToPaise, showDateTime, useAsync, useAuth,
  type CinemaScreen, type CinemaShow, type Film, type MovieCheckIn, type ScreenRow, type SeatClassDef,
} from '@kit';

type Tab = 'shows' | 'screens' | 'door';
const todayIST = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

/** A cinema on VIBE: screens with their seat layout and prices, the shows on them, and checking tickets at the door. Films come from VIBE's list. */
export function CinemaPage() {
  const [tab, setTab] = useState<Tab>('shows');
  return (
    <>
      <PageHead title="Cinema" sub="Set up your screens once, then schedule shows of the films VIBE lists. Customers pick seats in the app and get QR tickets; check them in at the door." />
      <div className="tabs" role="tablist">
        {([['shows', 'Shows'], ['screens', 'Screens'], ['door', 'Door check-in']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'shows' ? <Shows /> : tab === 'screens' ? <Screens /> : <Door />}
    </>
  );
}

function Shows() {
  const { client } = useAuth();
  const [from, setFrom] = useState(todayIST());
  const shows = useAsync(() => client.get<CinemaShow[]>(`/v1/merchant/cinema/shows?from=${from}&days=7`), [client, from]);
  const screens = useAsync(() => client.get<CinemaScreen[]>('/v1/merchant/cinema/screens'), [client]);
  const films = useAsync(() => client.get<Film[]>('/v1/merchant/cinema/films'), [client]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const cancel = async (s: CinemaShow) => {
    if (!window.confirm(`Cancel ${s.movieTitle} at ${time(s.startsAt)} on ${s.screenName}?`)) return;
    setError(null);
    try {
      await client.post(`/v1/merchant/cinema/shows/${s.id}/cancel`, {});
      setNotice('Show cancelled.');
      shows.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const active = (screens.data ?? []).filter((s) => s.active);
  return (
    <div className="stack">
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <label className="small">From <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></label>
        <button className="btn primary" disabled={!active.length} onClick={() => setAdding(true)} title={active.length ? undefined : 'Add a screen first'}>Schedule a show</button>
      </div>
      {screens.data && !active.length ? <Notice tone="info">Add a screen first (Screens tab): its seat layout and the price of each seat class.</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {shows.error ? <Notice tone="error">{shows.error}</Notice> : null}
      {shows.loading && !shows.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Film</th><th>Screen</th><th>Sold</th><th>Takings</th><th /></tr></thead>
            <tbody>
              {shows.data?.map((s) => (
                <tr key={s.id} style={s.status === 'cancelled' ? { opacity: 0.55 } : undefined}>
                  <td><strong>{time(s.startsAt)}</strong><div className="muted small">{dayLabel(s.startsAt)} · ends {time(s.endsAt)}</div></td>
                  <td><strong>{s.movieTitle}</strong><div className="muted small">{s.language} · {s.format}</div></td>
                  <td className="small">{s.screenName}</td>
                  <td className="small">{s.sold} of {s.capacity}{s.checkedIn ? <div className="muted small">{s.checkedIn} checked in</div> : null}</td>
                  <td className="small">{formatINR(s.revenue)}</td>
                  <td>{s.status === 'cancelled' ? <Badge>Cancelled</Badge> : s.sold === 0 && Date.parse(s.startsAt) > Date.now() ? <button className="btn ghost sm danger" onClick={() => cancel(s)}>Cancel</button> : null}</td>
                </tr>
              ))}
              {shows.data && shows.data.length === 0 ? <tr><td colSpan={6} className="muted">No shows in these 7 days.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted small">A show with seats sold can’t be cancelled here: ask VIBE support, so every buyer is refunded.</div>
      {adding ? <AddShow films={films.data ?? []} screens={active} onClose={() => setAdding(false)} onDone={() => { setAdding(false); setNotice('Show scheduled. It’s on sale in the app now.'); shows.reload(); }} /> : null}
    </div>
  );
}

function AddShow({ films, screens, onClose, onDone }: { films: Film[]; screens: CinemaScreen[]; onClose: () => void; onDone: () => void }) {
  const { client } = useAuth();
  const [movieId, setMovieId] = useState('');
  const [screenId, setScreenId] = useState(screens[0]?.id ?? '');
  const [when, setWhen] = useState('');
  const [language, setLanguage] = useState('');
  const [format, setFormat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const film = films.find((f) => f.id === movieId);

  const save = async () => {
    if (!film || !screenId || !when || !language) return setError('Choose the film, screen, time and language.');
    setBusy(true);
    setError(null);
    try {
      await client.post('/v1/merchant/cinema/shows', { movieId, screenId, startsAt: fromLocalInput(when), language, format: format || film.formats[0] });
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Schedule a show" onClose={onClose}>
      <div className="stack">
        <Field label="Film" hint="Films come from VIBE’s list. Ask VIBE to add one that’s missing.">
          <select value={movieId} onChange={(e) => { const f = films.find((x) => x.id === e.target.value); setMovieId(e.target.value); setLanguage(f?.languages[0] ?? ''); setFormat(f?.formats[0] ?? ''); }}>
            <option value="">Choose a film</option>
            {films.map((f) => <option key={f.id} value={f.id}>{f.title} ({f.certificate}, {f.durationMin} min){f.status === 'coming_soon' ? ' · coming soon' : ''}</option>)}
          </select>
        </Field>
        <div className="grid2">
          <Field label="Screen"><select value={screenId} onChange={(e) => setScreenId(e.target.value)}>{screens.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.seatCount} seats</option>)}</select></Field>
          <Field label="Starts at"><input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        </div>
        {film ? (
          <div className="grid2">
            <Field label="Language"><select value={language} onChange={(e) => setLanguage(e.target.value)}>{film.languages.map((l) => <option key={l}>{l}</option>)}</select></Field>
            <Field label="Format"><select value={format} onChange={(e) => setFormat(e.target.value)}>{film.formats.map((l) => <option key={l}>{l}</option>)}</select></Field>
          </div>
        ) : null}
        <div className="muted small">Prices come from the screen’s seat classes. Leave 20 minutes between shows on one screen.</div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="modal-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Schedule'}</button></div>
      </div>
    </Modal>
  );
}

// ---------- screens ----------
type Block = { name: string; price: string; rows: string; seats: string };
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const slug = (s: string, n: number) => (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `class-${n}`).slice(0, 30);

/** Front rows first: each block is a seat class with its rows; an aisle splits every row in the middle. */
function buildLayout(blocks: Block[]): { classes: SeatClassDef[]; rows: ScreenRow[] } | string {
  const classes: SeatClassDef[] = [];
  const rows: ScreenRow[] = [];
  for (const [n, b] of blocks.entries()) {
    const price = rupeesToPaise(b.price), r = Number(b.rows), s = Number(b.seats);
    if (!b.name.trim()) return 'Name every seat class.';
    if (price === null || price < 100) return `Give ${b.name} a price in rupees.`;
    if (!Number.isInteger(r) || r < 1 || r > 26) return `${b.name}: rows must be 1 to 26.`;
    if (!Number.isInteger(s) || s < 1 || s > 40) return `${b.name}: seats per row must be 1 to 40.`;
    let id = slug(b.name, n);
    while (classes.some((c) => c.id === id)) id = `${id}-${n}`;
    classes.push({ id, name: b.name.trim(), price });
    for (let i = 0; i < r; i++) {
      if (rows.length >= 26) return 'Up to 26 rows on one screen.';
      const half = Math.ceil(s / 2);
      const seats: (number | null)[] = [];
      for (let k = 1; k <= s; k++) { seats.push(k); if (k === half && s > 4) seats.push(null); }
      rows.push({ label: LETTERS[rows.length], classId: id, seats });
    }
  }
  return { classes, rows };
}

function Screens() {
  const { client } = useAuth();
  const list = useAsync(() => client.get<CinemaScreen[]>('/v1/merchant/cinema/screens'), [client]);
  const [editing, setEditing] = useState<CinemaScreen | 'new' | null>(null);
  return (
    <div className="stack">
      <div className="row"><button className="btn primary" onClick={() => setEditing('new')}>Add a screen</button></div>
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Screen</th><th>Seats</th><th>Classes and prices</th><th /></tr></thead>
            <tbody>
              {list.data?.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong>{s.active ? null : <div><Badge>Hidden</Badge></div>}</td>
                  <td className="small">{s.seatCount} in {s.rows.length} rows</td>
                  <td className="small">{s.classes.map((c) => `${c.name} ${formatINR(c.price)}`).join(' · ')}</td>
                  <td><button className="btn sm" onClick={() => setEditing(s)}>Edit</button></td>
                </tr>
              ))}
              {list.data && list.data.length === 0 ? <tr><td colSpan={4} className="muted">No screens yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <ScreenModal screen={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); list.reload(); }} /> : null}
    </div>
  );
}

function ScreenModal({ screen, onClose, onDone }: { screen: CinemaScreen | null; onClose: () => void; onDone: () => void }) {
  const { client } = useAuth();
  const [name, setName] = useState(screen?.name ?? '');
  const [active, setActive] = useState(screen?.active ?? true);
  const [blocks, setBlocks] = useState<Block[]>([{ name: 'Classic', price: '180', rows: '4', seats: '14' }, { name: 'Prime', price: '280', rows: '4', seats: '14' }, { name: 'Recliner', price: '450', rows: '2', seats: '8' }]);
  const [prices, setPrices] = useState<Record<string, string>>(Object.fromEntries((screen?.classes ?? []).map((c) => [c.id, paiseToRupees(c.price)])));
  const [rebuild, setRebuild] = useState(!screen);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const built = rebuild ? buildLayout(blocks) : null;

  const save = async () => {
    setError(null);
    let classes: SeatClassDef[], rows: ScreenRow[];
    if (rebuild) {
      if (typeof built === 'string' || !built) return setError(built ?? 'Check the layout.');
      ({ classes, rows } = built);
    } else {
      classes = [];
      for (const c of screen!.classes) {
        const p = rupeesToPaise(prices[c.id] ?? '');
        if (p === null || p < 100) return setError(`Give ${c.name} a price in rupees.`);
        classes.push({ ...c, price: p });
      }
      rows = screen!.rows;
    }
    setBusy(true);
    try {
      const body = { name: name.trim(), classes, rows, active };
      if (screen) await client.put(`/v1/merchant/cinema/screens/${screen.id}`, body); else await client.post('/v1/merchant/cinema/screens', body);
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const set = (i: number, k: keyof Block, v: string) => setBlocks((bs) => bs.map((b, n) => (n === i ? { ...b, [k]: v } : b)));
  return (
    <Modal title={screen ? `Edit ${screen.name}` : 'Add a screen'} onClose={onClose} wide>
      <div className="stack">
        <div className="grid2">
          <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Audi 1" maxLength={40} /></Field>
          {screen ? <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Show this screen</label> : null}
        </div>
        {screen && !rebuild ? (
          <>
            <div className="small muted">{screen.seatCount} seats in {screen.rows.length} rows ({screen.rows[0]?.label}–{screen.rows[screen.rows.length - 1]?.label}).</div>
            <div className="grid2">
              {screen.classes.map((c) => <Field key={c.id} label={`${c.name} price (₹)`}><input inputMode="decimal" value={prices[c.id] ?? ''} onChange={(e) => setPrices({ ...prices, [c.id]: e.target.value })} /></Field>)}
            </div>
            <div><button className="btn ghost sm" onClick={() => setRebuild(true)}>Change the seat layout</button> <span className="muted small">Not possible once seats are sold for upcoming shows.</span></div>
          </>
        ) : (
          <>
            <div className="small muted">Seat classes from the front of the screen to the back. Each row gets an aisle in the middle.</div>
            <table>
              <thead><tr><th>Seat class</th><th>Price (₹)</th><th>Rows</th><th>Seats per row</th><th /></tr></thead>
              <tbody>
                {blocks.map((b, i) => (
                  <tr key={i}>
                    <td><input value={b.name} onChange={(e) => set(i, 'name', e.target.value)} maxLength={30} /></td>
                    <td><input inputMode="decimal" value={b.price} onChange={(e) => set(i, 'price', e.target.value)} style={{ width: 90 }} /></td>
                    <td><input inputMode="numeric" value={b.rows} onChange={(e) => set(i, 'rows', e.target.value)} style={{ width: 60 }} /></td>
                    <td><input inputMode="numeric" value={b.seats} onChange={(e) => set(i, 'seats', e.target.value)} style={{ width: 60 }} /></td>
                    <td>{blocks.length > 1 ? <button className="btn ghost sm" onClick={() => setBlocks(blocks.filter((_, n) => n !== i))}>Remove</button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {blocks.length < 6 ? <div><button className="btn ghost sm" onClick={() => setBlocks([...blocks, { name: '', price: '', rows: '2', seats: '10' }])}>Add a seat class</button></div> : null}
            {built && typeof built !== 'string' ? <LayoutPreview rows={built.rows} classes={built.classes} /> : built ? <Notice tone="error">{built}</Notice> : null}
          </>
        )}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="modal-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
      </div>
    </Modal>
  );
}

function LayoutPreview({ rows, classes }: { rows: ScreenRow[]; classes: SeatClassDef[] }) {
  const seats = rows.reduce((n, r) => n + r.seats.filter((s) => s !== null).length, 0);
  return (
    <div className="card" style={{ overflowX: 'auto' }}>
      <div className="muted small" style={{ textAlign: 'center', marginBottom: 8 }}>Screen this way · {seats} seats</div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'flex', gap: 3, alignItems: 'center', justifyContent: 'center', marginBottom: 3 }}>
          <span className="small muted" style={{ width: 18 }}>{r.label}</span>
          {r.seats.map((s, i) => <span key={i} title={s ? `${r.label}${s} · ${classes.find((c) => c.id === r.classId)?.name}` : undefined}
            style={{ width: 12, height: 12, borderRadius: 3, background: s ? 'var(--pink)' : 'transparent', opacity: s ? 0.35 + 0.65 * (classes.findIndex((c) => c.id === r.classId) + 1) / classes.length : 1 }} />)}
        </div>
      ))}
    </div>
  );
}

// ---------- the door ----------
function Door() {
  const { client } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MovieCheckIn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await client.post<MovieCheckIn>('/v1/merchant/cinema/check-in', { code: code.trim() }));
      setCode('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card stack" style={{ maxWidth: 520 }}>
      <form className="row" style={{ gap: 8 }} onSubmit={check}>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ticket code, like ABC-123, or scan the QR" aria-label="Ticket code" autoFocus style={{ flex: 1 }} />
        <button className="btn primary" disabled={busy}>{busy ? 'Checking…' : 'Check'}</button>
      </form>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {result ? (
        <Notice tone={result.result === 'admitted' ? 'success' : 'error'}>
          <strong>{result.message}</strong>
          <div className="small">{result.movieTitle} · {showDateTime(result.startsAt)} · {result.screen} · seat {result.seat} · {result.bookingId}</div>
        </Notice>
      ) : null}
      <div className="muted small">Each ticket gets in once, from an hour before the show.</div>
    </div>
  );
}
