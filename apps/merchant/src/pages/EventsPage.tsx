import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Badge, EventSalesView, Loading, Notice, PageHead, errorText, formatINR, showDateTime, useAsync, useAuth, type EventListRow, type EventStatus } from '@kit';

const TONE: Record<EventStatus, 'warning' | 'success' | 'muted'> = { pending: 'warning', published: 'success', rejected: 'muted', cancelled: 'muted' };
const LABEL: Record<EventStatus, string> = { pending: 'Waiting for VIBE', published: 'On sale', rejected: 'Not approved', cancelled: 'Cancelled' };

export function EventsPage() {
  const { client } = useAuth();
  const list = useAsync(() => client.get<EventListRow[]>('/v1/merchant/events'), [client]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const cancel = async (e: EventListRow) => {
    if (!window.confirm(`Cancel “${e.title}”? It disappears from the app and can’t be brought back.`)) return;
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
      <PageHead title="Events" sub="Workshops, tastings, live nights and more. Customers buy tickets in the VIBE app; you see every sale here and check people in at the door."
        actions={<Link className="btn primary" to="/events/new" style={{ textDecoration: 'none' }}>Create event</Link>} />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : null}
      {list.data && list.data.length === 0 ? <div className="card muted">No events yet. Create one to sell tickets through VIBE.</div> : null}
      {list.data && list.data.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Event</th><th>When</th><th>From</th><th>Sold</th><th>Left</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data.map((e) => {
                const sold = e.sold ?? 0;
                return (
                  <tr key={e.id} className={e.status === 'cancelled' ? 'dim' : ''}>
                    <td><strong>{e.title}</strong><div className="muted small">{e.kind} · {e.venue}</div></td>
                    <td className="small">{showDateTime(e.startsAt)}</td>
                    <td>{formatINR(e.fromPrice)}</td>
                    <td><strong>{sold}</strong> <span className="muted small">/ {e.capacity}</span><div className="meter" aria-hidden="true"><span style={{ width: `${e.capacity ? Math.min(100, (sold / e.capacity) * 100) : 0}%` }} /></div></td>
                    <td>{Math.max(0, e.capacity - sold)}</td>
                    <td><Badge tone={TONE[e.status]}>{LABEL[e.status]}</Badge></td>
                    <td className="actions">
                      <Link className="btn sm" to={`/events/${e.id}/sales`} style={{ textDecoration: 'none' }}>Sales and door</Link>
                      {e.status !== 'cancelled' ? <Link className="btn ghost sm" to={`/events/${e.id}`} style={{ textDecoration: 'none' }}>Edit</Link> : null}
                      {e.status !== 'cancelled' && sold === 0 ? <button className="btn ghost sm danger" onClick={() => cancel(e)}>Cancel</button> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="muted small">Left counts tickets not yet sold; a few may be held for customers who are paying right now. Once tickets are sold, only VIBE can cancel the event, so every buyer is told and refunded.</p>
    </>
  );
}

export function EventSalesPage() {
  const { id } = useParams();
  return id ? <EventSalesView base="/v1/merchant" eventId={id} backTo="/events" /> : null;
}
