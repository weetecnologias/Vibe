import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { errorText } from './api';
import { useAuth } from './auth';
import { formatINR } from './money';
import { showDateTime } from './time';
import type { CheckInResult, EventSales } from './types';
import { Badge, Loading, Notice, PageHead, useAsync } from './ui';

const REFRESH_MS = 10_000;
const TONE: Record<CheckInResult['result'], 'success' | 'warning' | 'error'> = { admitted: 'success', already: 'warning', wrong_event: 'error', cancelled: 'error' };

/**
 * One event's ticket sales and its door: sold and left per ticket type, what's being bought right now, each booking, and check-in by
 * admission code or QR. `base` is '/v1/merchant' or '/v1/admin'; the server decides who may see which event.
 */
export function EventSalesView({ base, eventId, backTo }: { base: string; eventId: string; backTo: string }) {
  const { client } = useAuth();
  const sales = useAsync(() => client.get<EventSales>(`${base}/events/${eventId}/sales`), [client, base, eventId]);
  const reload = sales.reload;
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) reload(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);
  const s = sales.data;

  return (
    <>
      <PageHead title={s ? s.title : 'Ticket sales'} sub={s ? `${showDateTime(s.startsAt)} · updates by itself every few seconds` : undefined}
        actions={<div className="row"><Link className="btn ghost" to={backTo} style={{ textDecoration: 'none' }}>Back to events</Link><button className="btn" onClick={reload}>Refresh</button></div>} />
      {sales.error ? <Notice tone="error">{sales.error}</Notice> : null}
      {sales.loading && !s ? <Loading /> : s ? (
        <div className="stack">
          {s.status !== 'published' ? <Notice tone="info">{s.status === 'cancelled' ? 'This event was cancelled. Tickets sold are no longer valid.' : 'This event isn’t on sale right now (it’s waiting for VIBE’s review or wasn’t approved). Tickets already sold stay valid.'}</Notice> : null}
          <div className="stats">
            <div className="card"><span className="muted small">Sold</span><strong>{s.sold}</strong><span className="muted small">of {s.capacity}</span></div>
            <div className="card"><span className="muted small">Left</span><strong>{s.left}</strong>{s.held ? <span className="muted small">{s.held} being bought now</span> : null}</div>
            <div className="card"><span className="muted small">Checked in</span><strong>{s.checkedIn}</strong><span className="muted small">of {s.sold}</span></div>
            <div className="card"><span className="muted small">Ticket sales</span><strong>{formatINR(s.revenue)}</strong></div>
          </div>

          <CheckInBox base={base} eventId={eventId} onDone={reload} />

          <div className="card stack">
            <h2>By ticket type</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Ticket</th><th>Price</th><th>Sold</th><th>Being bought</th><th>Left</th><th>Sales</th></tr></thead>
                <tbody>
                  {s.types.map((t) => (
                    <tr key={t.ticketTypeId} className={t.archived ? 'dim' : ''}>
                      <td>
                        <strong>{t.name}</strong> {t.archived ? <Badge>Removed</Badge> : t.left === 0 ? <Badge tone="pink">Sold out</Badge> : null}
                        <div className="meter" aria-hidden="true"><span style={{ width: `${t.capacity ? Math.min(100, ((t.sold + t.held) / t.capacity) * 100) : 0}%` }} /></div>
                      </td>
                      <td>{formatINR(t.price)}</td>
                      <td>{t.sold} <span className="muted small">/ {t.capacity}</span></td>
                      <td>{t.held}</td>
                      <td><strong>{t.left}</strong></td>
                      <td>{formatINR(t.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <span className="muted small">“Being bought” are tickets held for a customer who is paying (for up to 10 minutes). They come back if the customer doesn’t pay.</span>
          </div>

          <div className="card stack">
            <h2>Bookings</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Booking</th><th>Customer</th><th>Tickets</th><th>Paid</th><th>Checked in</th></tr></thead>
                <tbody>
                  {s.bookings.map((b) => (
                    <tr key={b.bookingId}>
                      <td><strong>{b.bookingId}</strong><div className="muted small">{b.paidAt ? showDateTime(b.paidAt) : ''} · {b.paymentReference}</div></td>
                      <td className="small">{b.customerName}<div className="muted">ID {b.vibeId}</div></td>
                      <td>{b.tickets}</td>
                      <td>{formatINR(b.paid)}{b.saved > 0 ? <div className="muted small">VIBE offer −{formatINR(b.saved)}</div> : null}</td>
                      <td>{b.checkedIn} / {b.tickets}</td>
                    </tr>
                  ))}
                  {s.bookings.length === 0 ? <tr><td colSpan={5} className="muted">No tickets sold yet. You’ll get an alert with each sale.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** At the door: type the code on the customer's ticket (like ABC-123) or paste what a QR scanner reads. */
function CheckInBox({ base, eventId, onDone }: { base: string; eventId: string; onDone: () => void }) {
  const { client } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await client.post<CheckInResult>(`${base}/events/${eventId}/check-in`, { code: code.trim() }));
      setCode('');
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <div className="card stack">
      <h2>Check in at the door</h2>
      <form className="row" onSubmit={check}>
        <input ref={input} style={{ maxWidth: 260 }} placeholder="Code on the ticket, like ABC-123" aria-label="Ticket code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
        <button className="btn primary" disabled={busy || !code.trim()}>{busy ? 'Checking…' : 'Check in'}</button>
      </form>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {result ? (
        <div className={`checkin ${TONE[result.result]}`} role="status">
          <strong>{result.result === 'admitted' ? '✓ ' : '✕ '}{result.message}</strong>
          <span>{result.attendeeName} · {result.typeName} · ticket {result.index} of {result.of} · booking {result.bookingId}</span>
        </div>
      ) : null}
    </div>
  );
}
