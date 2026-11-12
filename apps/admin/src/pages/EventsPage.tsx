import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge, Field, Loading, Modal, Notice, PageHead, errorText, formatINR, showDateTime, useAsync, useAuth, type EventListRow, type EventStatus } from '@kit';

const FILTERS: { key: EventStatus | ''; label: string }[] = [{ key: 'pending', label: 'Waiting for review' }, { key: 'published', label: 'Published' }, { key: 'rejected', label: 'Rejected' }, { key: 'cancelled', label: 'Cancelled' }, { key: '', label: 'All' }];
const TONE: Record<EventStatus, 'warning' | 'success' | 'muted'> = { pending: 'warning', published: 'success', rejected: 'muted', cancelled: 'muted' };
const LABEL: Record<EventStatus, string> = { pending: 'Waiting for review', published: 'Published', rejected: 'Rejected', cancelled: 'Cancelled' };

export function EventsPage() {
  const { client } = useAuth();
  const [filter, setFilter] = useState<EventStatus | ''>('pending');
  const list = useAsync(() => client.get<EventListRow[]>(`/v1/admin/events${filter ? `?status=${filter}` : ''}`), [client, filter]);
  const [rejecting, setRejecting] = useState<EventListRow | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const act = async (e: EventListRow, action: 'approve' | 'cancel') => {
    if (action === 'cancel' && !window.confirm(`Cancel “${e.title}”? It disappears from the app. Refunds for tickets already sold are handled with payments, which are not built yet.`)) return;
    setError(null);
    try {
      await client.post(`/v1/admin/events/${e.id}/${action}`);
      setNotice(action === 'approve' ? `Published “${e.title}”.` : `Cancelled “${e.title}”.`);
      list.reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    setError(null);
    try {
      await client.post(`/v1/admin/events/${rejecting.id}/reject`, { note });
      setNotice(`Rejected “${rejecting.title}”. The organiser sees your note.`);
      setRejecting(null);
      setNote('');
      list.reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <>
      <PageHead title="Events" sub="Events from merchants wait here for review. Events you create publish straight away." actions={<Link className="btn primary" to="/events/new" style={{ textDecoration: 'none' }}>Create event</Link>} />
      <div className="tabs" role="tablist">
        {FILTERS.map((f) => <button key={f.label} role="tab" aria-selected={filter === f.key} className={`tab${filter === f.key ? ' on' : ''}`} onClick={() => { setFilter(f.key); setNotice(null); }}>{f.label}</button>)}
      </div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error && !rejecting ? <Notice tone="error">{error}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Event</th><th>Organiser</th><th>When</th><th>From</th><th>Tickets</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data?.map((e) => (
                <tr key={e.id} className={e.status === 'cancelled' ? 'dim' : ''}>
                  <td><strong>{e.title}</strong><div className="muted small">{e.kind} · {e.venue}</div></td>
                  <td className="small">{e.organiser}</td>
                  <td className="small">{showDateTime(e.startsAt)}</td>
                  <td>{formatINR(e.fromPrice)}</td>
                  <td>{e.capacity}</td>
                  <td><Badge tone={TONE[e.status]}>{LABEL[e.status]}</Badge>{e.autoApproved ? <div style={{ marginTop: 4 }}><Badge tone="success">Auto-approved</Badge></div> : null}</td>
                  <td className="actions">
                    <Link className="btn ghost sm" to={`/events/${e.id}`} style={{ textDecoration: 'none' }}>{e.status === 'pending' ? 'Review' : 'Edit'}</Link>
                    {e.status === 'pending' || e.status === 'rejected' ? <button className="btn primary sm" onClick={() => act(e, 'approve')}>Publish</button> : null}
                    {e.status === 'pending' || e.status === 'published' ? <button className="btn ghost sm danger" onClick={() => { setError(null); setNote(''); setRejecting(e); }}>Reject</button> : null}
                    {e.status === 'published' ? <button className="btn ghost sm danger" onClick={() => act(e, 'cancel')}>Cancel</button> : null}
                  </td>
                </tr>
              ))}
              {list.data?.length === 0 ? <tr><td colSpan={7} className="muted">{filter === 'pending' ? 'Nothing waiting for review.' : 'No events.'}</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {rejecting ? (
        <Modal title={`Reject “${rejecting.title}”`} onClose={() => setRejecting(null)}>
          <div className="stack">
            <p className="muted small" style={{ margin: 0 }}>{rejecting.organiser} will see this note, so say what to change. A published event is taken off the app.</p>
            <Field label="Note to the organiser"><textarea autoFocus rows={3} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot">
              <button className="btn" onClick={() => setRejecting(null)}>Cancel</button>
              <button className="btn primary" disabled={!note.trim()} onClick={reject}>Reject event</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
