import { useState } from 'react';

import { Badge, Field, ImageField, Loading, Modal, Notice, PageHead, errorText, useAsync, useAuth, type FilmInput, type FilmRow } from '@kit';

const FORMATS = ['2D', '3D', 'IMAX', 'Dolby Atmos'];
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/** VIBE's film list. Cinemas schedule shows only of films listed here; archiving a film hides it from the app. */
export function FilmsPage() {
  const { client } = useAuth();
  const films = useAsync(() => client.get<FilmRow[]>('/v1/admin/movies'), [client]);
  const [editing, setEditing] = useState<FilmRow | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <PageHead title="Films" sub="The films customers can book. Cinemas schedule shows of these films on their own screens." actions={<button className="btn primary" onClick={() => setEditing('new')}>Add a film</button>} />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {films.error ? <Notice tone="error">{films.error}</Notice> : null}
      {films.loading && !films.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Film</th><th>Languages</th><th>Release</th><th>Shows coming up</th><th>Status</th><th /></tr></thead>
            <tbody>
              {films.data?.map((r) => (
                <tr key={r.film.id} style={r.archived ? { opacity: 0.55 } : undefined}>
                  <td><strong>{r.film.title}</strong><div className="muted small">{r.film.certificate} · {r.film.durationMin} min · {r.film.genres.join(', ')}</div></td>
                  <td className="small">{r.film.languages.join(', ')}<div className="muted small">{r.film.formats.join(', ')}</div></td>
                  <td className="small">{r.film.releaseDate}</td>
                  <td className="small">{r.upcomingShows}</td>
                  <td>{r.archived ? <Badge>Archived</Badge> : r.film.status === 'now_showing' ? <Badge tone="success">Now showing</Badge> : <Badge tone="pink">Coming soon</Badge>}</td>
                  <td><button className="btn sm" onClick={() => setEditing(r)}>Edit</button></td>
                </tr>
              ))}
              {films.data && films.data.length === 0 ? <tr><td colSpan={6} className="muted">No films yet. Add the first one.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <FilmModal row={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={(t) => { setEditing(null); setNotice(t); films.reload(); }} /> : null}
    </>
  );
}

function FilmModal({ row, onClose, onDone }: { row: FilmRow | null; onClose: () => void; onDone: (t: string) => void }) {
  const { client } = useAuth();
  const f = row?.film;
  const [title, setTitle] = useState(f?.title ?? '');
  const [certificate, setCertificate] = useState(f?.certificate ?? 'UA');
  const [duration, setDuration] = useState(String(f?.durationMin ?? ''));
  const [genres, setGenres] = useState(f?.genres.join(', ') ?? '');
  const [languages, setLanguages] = useState(f?.languages.join(', ') ?? 'Telugu');
  const [formats, setFormats] = useState<string[]>(f?.formats ?? ['2D']);
  const [release, setRelease] = useState(f?.releaseDate ?? new Date().toISOString().slice(0, 10));
  const [rating, setRating] = useState(f?.rating != null ? String(f.rating) : '');
  const [poster, setPoster] = useState<string | null>(f?.posterUrl ?? null);
  const [synopsis, setSynopsis] = useState(f?.synopsis ?? '');
  const [director, setDirector] = useState(f?.director ?? '');
  const [cast, setCast] = useState(f?.cast?.join(', ') ?? '');
  const [archived, setArchived] = useState(row?.archived ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    const d = Number(duration);
    if (!title.trim()) return setError('Add the title.');
    if (!Number.isInteger(d) || d < 30 || d > 300) return setError('Running time is 30 to 300 minutes.');
    if (!list(languages).length) return setError('Add at least one language.');
    const r = rating.trim() ? Number(rating) : null;
    if (r !== null && (Number.isNaN(r) || r < 0 || r > 10)) return setError('Rating is out of 10, or leave it empty.');
    const body: FilmInput = {
      title: title.trim(), certificate, durationMin: d, genres: list(genres), languages: list(languages), formats: formats.length ? formats : ['2D'], rating: r, votes: null, posterUrl: poster,
      releaseDate: release, synopsis: synopsis.trim(), director: director.trim(), cast: list(cast), archived,
    };
    setBusy(true);
    try {
      if (row) await client.put(`/v1/admin/movies/${row.film.id}`, body); else await client.post('/v1/admin/movies', body);
      onDone(row ? 'Film saved.' : 'Film added. Cinemas can schedule it now.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={row ? `Edit ${row.film.title}` : 'Add a film'} onClose={onClose} wide>
      <div className="stack">
        <div className="grid2">
          <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></Field>
          <div className="grid2">
            <Field label="Certificate"><select value={certificate} onChange={(e) => setCertificate(e.target.value as 'U' | 'UA' | 'A')}><option>U</option><option>UA</option><option>A</option></select></Field>
            <Field label="Running time (min)"><input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ''))} /></Field>
          </div>
          <Field label="Languages" hint="Separated by commas. Cinemas pick one per show."><input value={languages} onChange={(e) => setLanguages(e.target.value)} /></Field>
          <Field label="Genres" hint="Separated by commas."><input value={genres} onChange={(e) => setGenres(e.target.value)} /></Field>
          <Field label="Release date" hint="Before this date the film shows as coming soon."><input type="date" value={release} onChange={(e) => setRelease(e.target.value)} /></Field>
          <Field label="Rating out of 10" hint="Optional."><input inputMode="decimal" value={rating} onChange={(e) => setRating(e.target.value)} /></Field>
        </div>
        <Field label="Formats">
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            {FORMATS.map((x) => (
              <label key={x} className="check"><input type="checkbox" checked={formats.includes(x)} onChange={(e) => setFormats(e.target.checked ? [...formats, x] : formats.filter((y) => y !== x))} /> {x}</label>
            ))}
          </div>
        </Field>
        <ImageField label="Poster" value={poster ?? ''} onChange={(u) => setPoster(u || null)} hint="Optional. Without one the app shows a branded placeholder." />
        <Field label="Synopsis"><textarea rows={3} maxLength={1000} value={synopsis} onChange={(e) => setSynopsis(e.target.value)} /></Field>
        <div className="grid2">
          <Field label="Director"><input value={director} onChange={(e) => setDirector(e.target.value)} /></Field>
          <Field label="Cast" hint="Separated by commas."><input value={cast} onChange={(e) => setCast(e.target.value)} /></Field>
        </div>
        {row ? <label className="check"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived: hide this film from the app and from cinemas</label> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="modal-foot"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
      </div>
    </Modal>
  );
}
