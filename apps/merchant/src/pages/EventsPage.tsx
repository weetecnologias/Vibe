import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge, Loading, Notice, PageHead, errorText, formatINR, showDateTime, useAsync, useAuth, type EventListRow, type EventStatus } from '@kit';

const TONE: Record<EventStatus, 'warning' | 'success' | 'muted'> = { pending: 'warning', published: 'success', rejected: 'muted', cancelled: 'muted' };
const LABEL: Record<EventStatus, string> = { pending: 'Waiting for VIBE', published: 'Published', rejected: 'Not approved', cancelled: 'Cancelled' };

export function EventsPage() {
  const { client } = useAuth();
  const list = useAsync(() => client.get<EventListRow[]>('/v1/merchant/events'), [client]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const cancel = async (e: EventListRow) => {
    if (!window.confirm(`Cancel “${e.title}”? It disappears from the app and can’t be brought back. Contact VIBE about tickets already sold.`)) return;
    setError(null);
    try {
      await client.post(`/v1/merchant/events/${e.id}/cancel`);
      setNotice(`Cancelled “${e.title}”.`);
      list.reload();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <>
      <PageHead title="Events" sub="Workshops, tastings, live nights and more. VIBE reviews each event before customers see it, and again after you change it."
        actions={<Link className="btn primary" to="/events/new" style={{ textDecoration: 'none' }}>Create event</Link>} />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data && list.data.length === 0 ? <div className="card muted">No events yet. Create one to sell tickets through VIBE.</div> : null}
      {list.data && list.data.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Event</th><th>When</th><th>From</th><th>Tickets</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data.map((e) => (
                <tr key={e.id} className={e.status === 'cancelled' ? 'dim' : ''}>
                  <td><strong>{e.title}</strong><div className="muted small">{e.kind} · {e.venue}</div></td>
                  <td className="small">{showDateTime(e.startsAt)}</td>
                  <td>{formatINR(e.fromPrice)}</td>
                  <td>{e.capacity}</td>
                  <td><Badge tone={TONE[e.status]}>{LABEL[e.status]}</Badge></td>
                  <td className="actions">
                    {e.status !== 'cancelled' ? <Link className="btn ghost sm" to={`/events/${e.id}`} style={{ textDecoration: 'none' }}>Edit</Link> : null}
                    {e.status !== 'cancelled' ? <button className="btn ghost sm danger" onClick={() => cancel(e)}>Cancel</button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="muted small">Ticket sales, holds and door check-in arrive with the ticketing module. Until then the number of tickets is the capacity you set.</p>
    </>
  );
}
