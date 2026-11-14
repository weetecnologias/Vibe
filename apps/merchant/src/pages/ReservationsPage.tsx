import { useEffect, useState } from 'react';

import { Badge, Field, Loading, Notice, PageHead, errorText, formatINR, paiseToRupees, rupeesToPaise, useAsync, useAuth, type MeetupReservation, type ReservationSettings } from '@kit';

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const todayIST = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const shiftDay = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);

const STATUS: Record<MeetupReservation['status'], { label: string; tone: 'muted' | 'success' | 'warning' | 'pink' }> = {
  pending: { label: 'Waiting for a guest', tone: 'muted' },
  confirmed: { label: 'Booked', tone: 'pink' },
  arrived: { label: 'Arrived', tone: 'success' },
  no_show: { label: 'No-show', tone: 'warning' },
  released: { label: 'Released', tone: 'muted' },
};

/** The day's VIBE Social reservations: a table or slot for two, booked once both people are in. */
function MeetupBookings() {
  const { client } = useAuth();
  const [day, setDay] = useState(todayIST());
  const list = useAsync(() => client.get<MeetupReservation[]>(`/v1/merchant/reservations?day=${day}`), [client, day]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mark = async (ref: string, what: 'arrived' | 'no-show') => {
    setError(null);
    setBusy(ref);
    try {
      await client.post(`/v1/merchant/reservations/${ref}/${what}`, {});
      list.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const now = Date.now();
  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>VIBE Social bookings</h2>
          <div className="muted small">Tables and slots for two from one-on-one plans. Each is held 30 minutes past the start.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button className="btn ghost sm" onClick={() => setDay(shiftDay(day, -1))} aria-label="Previous day">‹</button>
          <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Day" style={{ width: 'auto' }} />
          <button className="btn ghost sm" onClick={() => setDay(shiftDay(day, 1))} aria-label="Next day">›</button>
          {day !== todayIST() ? <button className="btn ghost sm" onClick={() => setDay(todayIST())}>Today</button> : null}
        </div>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : list.data && list.data.length === 0 ? (
        <div className="muted">No Social bookings on this day.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Booking</th><th>Guests</th><th>Deposit</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data?.map((r) => {
                const start = Date.parse(r.startsAt), hold = Date.parse(r.holdUntil);
                const canArrive = r.status === 'confirmed' && now >= start - 3_600_000;
                const canNoShow = r.status === 'confirmed' && now >= hold;
                return (
                  <tr key={r.reference}>
                    <td><strong>{time(r.startsAt)}</strong><div className="muted small">held until {time(r.holdUntil)}</div></td>
                    <td><strong>{r.reference}</strong><div className="muted small">{r.activity}</div></td>
                    <td className="small">{r.guests} · party of {r.party}</td>
                    <td className="small">
                      {formatINR(r.deposit)}{r.payMode === 'split' ? ' · split' : ''}
                      <div className="muted small">{r.depositPaid >= r.deposit ? 'Paid · take it off the bill' : r.depositPaid > 0 ? `${formatINR(r.depositPaid)} paid so far` : 'Not paid'}</div>
                    </td>
                    <td><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></td>
                    <td>
                      {r.status === 'confirmed' ? (
                        <div className="row" style={{ gap: 6 }}>
                          <button className="btn primary sm" disabled={!canArrive || busy === r.reference} onClick={() => mark(r.reference, 'arrived')} title={canArrive ? undefined : 'From an hour before the start'}>Arrived</button>
                          <button className="btn ghost sm" disabled={!canNoShow || busy === r.reference} onClick={() => mark(r.reference, 'no-show')} title={canNoShow ? undefined : `After ${time(r.holdUntil)}`}>No-show</button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted small">Mark Arrived from an hour before the start. No-show unlocks once the hold ends; the deposit then stays with you.</div>
    </div>
  );
}

export function ReservationsPage() {
  const { client } = useAuth();
  const settings = useAsync(() => client.get<ReservationSettings>('/v1/merchant/reservation-settings'), [client]);
  const [enabled, setEnabled] = useState(false);
  const [table, setTable] = useState('');
  const [slot, setSlot] = useState('');
  const [perHour, setPerHour] = useState('2');
  const [policy, setPolicy] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const s = settings.data;
    if (s && !loaded) { setLoaded(true); setEnabled(s.enabled); setTable(paiseToRupees(s.tableFee)); setSlot(paiseToRupees(s.slotFee)); setPolicy(s.policy); setPerHour(String(s.meetupsPerHour ?? 2)); }
  }, [settings.data, loaded]);

  const save = async () => {
    setError(null);
    setSaved(false);
    const tableFee = table.trim() ? rupeesToPaise(table) : null;
    const slotFee = slot.trim() ? rupeesToPaise(slot) : null;
    const meetupsPerHour = Number(perHour);
    if ((table.trim() && (tableFee === null || tableFee < 1)) || (slot.trim() && (slotFee === null || slotFee < 1))) return setError('Deposits must be amounts in rupees, like 200 or 150.50.');
    if (!Number.isInteger(meetupsPerHour) || meetupsPerHour < 1 || meetupsPerHour > 20) return setError('Tables per hour must be a whole number from 1 to 20.');
    setBusy(true);
    try {
      await client.put('/v1/merchant/reservation-settings', { enabled, tableFee, slotFee, policy: policy.trim(), meetupsPerHour });
      setSaved(true);
      settings.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (settings.loading && !settings.data) return <Loading />;
  if (settings.error && !settings.data) return <Notice tone="error">{settings.error}</Notice>;

  return (
    <>
      <PageHead title="Reservations" sub="People meeting through VIBE Social reserve a table or a slot for two at your place. They pay a deposit you set, and it comes off their bill." />
      <MeetupBookings />
      <div className="card stack">
        <h2 style={{ margin: 0 }}>Settings</h2>
        <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> <strong>Accept reservations at my place</strong></label>
        <div className="grid2">
          <Field label="Table deposit (₹)" hint="For a table for two. Leave empty if you don’t take table reservations."><input inputMode="decimal" value={table} onChange={(e) => setTable(e.target.value)} placeholder="300" /></Field>
          <Field label="Slot deposit (₹)" hint="For a court or slot, for example a badminton court. Leave empty if it doesn’t apply."><input inputMode="decimal" value={slot} onChange={(e) => setSlot(e.target.value)} placeholder="500" /></Field>
        </div>
        <Field label="Tables for VIBE Social per hour" hint="The most one-on-one bookings you’ll take in any hour, from 1 to 20.">
          <input inputMode="numeric" value={perHour} onChange={(e) => setPerHour(e.target.value.replace(/\D/g, ''))} style={{ maxWidth: 120 }} />
        </Field>
        <Field label="Your house rules" hint="Customers read this before they pay. VIBE’s rules always apply: free cancellation until 3 hours before, the table held 30 minutes past the start, and the deposit kept on a no-show.">
          <textarea rows={4} maxLength={600} value={policy} onChange={(e) => setPolicy(e.target.value)} />
        </Field>
        <Notice tone="info">Only VIBE-verified places (KYC approved) appear to customers. Deposits are collected by VIBE and paid out with your settlements.</Notice>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {saved ? <Notice tone="success">Saved.</Notice> : null}
        <div className="row"><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
      </div>
    </>
  );
}
