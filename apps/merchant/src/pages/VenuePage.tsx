import { useEffect, useState } from 'react';

import {
  Badge, Field, Loading, Modal, Notice, PageHead, errorText, formatINR, paiseToRupees, rupeesToPaise, useAsync, useAuth,
  type MerchantFeature, type VenueCheckIn, type VenueDay, type VenueMember, type VenuePlan, type VenuePlanInput, type VenueResource, type VenueResourceInput,
} from '@kit';

import { useSettings } from '../settings';

const IST = 'Asia/Kolkata';
const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const hourIST = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).getUTCHours();
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 || h === 24 ? 'AM' : 'PM'}`;
const atHour = (date: string, h: number) => new Date(`${date}T${String(h).padStart(2, '0')}:00:00+05:30`).toISOString();
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: IST });
const REFRESH_MS = 15_000;

/**
 * Courts, turfs and classes, booked by the slot from the VIBE app (like Playo). Today: who has booked what, by the hour, with check-in at the front
 * desk and blocking a slot (maintenance, a walk-in). Courts and prices: what customers can book and what it costs, with evening and weekend peak prices.
 * Memberships: monthly plans (gyms, yoga and meditation studios, trainers) that customers buy from a start month, and who the members are.
 */
export function VenuePage() {
  const settings = useSettings();
  const has = (f: MerchantFeature) => !settings.features || settings.features.includes(f);
  const bookings = has('bookings'), plans = has('memberships');
  const [tab, setTab] = useState<'day' | 'courts' | 'plans'>(bookings ? 'day' : 'plans');
  return (
    <>
      <PageHead title={bookings && plans ? 'Bookings & members' : bookings ? 'Bookings' : 'Members'} sub="Customers book your courts, turfs and classes by the slot, or join monthly, in the VIBE app and pay through VIBE. You get an alert with each booking or membership, and the money in your settlements." />
      <div className="tabs" role="tablist">
        {bookings ? <button role="tab" aria-selected={tab === 'day'} className={`tab${tab === 'day' ? ' on' : ''}`} onClick={() => setTab('day')}>Schedule</button> : null}
        {bookings ? <button role="tab" aria-selected={tab === 'courts'} className={`tab${tab === 'courts' ? ' on' : ''}`} onClick={() => setTab('courts')}>Courts and prices</button> : null}
        {plans ? <button role="tab" aria-selected={tab === 'plans'} className={`tab${tab === 'plans' ? ' on' : ''}`} onClick={() => setTab('plans')}>Memberships</button> : null}
      </div>
      {tab === 'day' ? <Schedule /> : tab === 'courts' ? <Courts /> : <Memberships />}
    </>
  );
}

function Schedule() {
  const { client } = useAuth();
  const [date, setDate] = useState(todayIST());
  const day = useAsync(() => client.get<VenueDay>(`/v1/merchant/venue/day?date=${date}`), [client, date]);
  const [blocking, setBlocking] = useState<{ resource: VenueResource; hour: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = day.reload;
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) reload(); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [reload]);
  const d = day.data;
  const active = (d?.resources ?? []).filter((r) => r.active);
  const hours = Array.from({ length: 18 }, (_, i) => i + 6); // 6 AM to 11 PM

  const unblock = async (id: string) => {
    setError(null);
    try { await client.del(`/v1/merchant/venue/blocks/${id}`); reload(); } catch (e) { setError(errorText(e)); }
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <label className="row" style={{ gap: 8 }}><strong>Day</strong><input type="date" value={date} onChange={(e) => setDate(e.target.value || todayIST())} style={{ maxWidth: 180 }} /></label>
        <div className="stats" style={{ margin: 0 }}>
          <div className="card"><span className="muted small">Booked today</span><strong>{d?.bookedToday ?? '–'}</strong></div>
          <div className="card"><span className="muted small">Booking sales today</span><strong>{d ? formatINR(d.salesToday) : '–'}</strong></div>
        </div>
      </div>
      <FrontDesk onDone={reload} />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {day.error ? <Notice tone="error">{day.error}</Notice> : null}
      {day.loading && !d ? <Loading /> : d && active.length === 0 ? (
        <div className="card muted">Nothing to book yet. Add your courts, turfs or classes under “Courts and prices”.</div>
      ) : d ? (
        <div className="table-wrap">
          <table className="schedule">
            <thead><tr><th>Time</th>{active.map((r) => <th key={r.id}>{r.name}<div className="muted small">{r.sport}{r.kind === 'spots' ? ` · ${r.capacity} spots` : ''}</div></th>)}</tr></thead>
            <tbody>
              {hours.map((h) => (
                <tr key={h}>
                  <td className="small"><strong>{hourLabel(h)}</strong></td>
                  {active.map((r) => {
                    const bookings = d.bookings.filter((b) => b.resourceId === r.id && hourIST(b.startsAt) <= h && hourIST(b.endsAt) > h);
                    const block = d.blocks.find((k) => k.resourceId === r.id && hourIST(k.startsAt) <= h && (hourIST(k.endsAt) > h || hourIST(k.endsAt) === 0));
                    if (block) {
                      return <td key={r.id} className="cell blocked"><span className="small">Blocked{block.reason ? `: ${block.reason}` : ''}</span> <button className="link small" onClick={() => unblock(block.id)}>Unblock</button></td>;
                    }
                    if (bookings.length) {
                      const people = bookings.reduce((n, b) => n + b.spots, 0);
                      return (
                        <td key={r.id} className="cell booked">
                          {r.kind === 'spots' ? <strong className="small">{people}/{r.capacity} booked</strong> : null}
                          {bookings.slice(0, 3).map((b) => (
                            <div key={b.bookingId} className="small">{b.checkedIn ? '✓ ' : ''}<strong>{b.customerName}</strong> <span className="muted">{b.bookingRef}</span></div>
                          ))}
                        </td>
                      );
                    }
                    return <td key={r.id} className="cell free"><button className="link small" onClick={() => setBlocking({ resource: r, hour: h })}>Block</button></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="muted small">Updates by itself. ✓ means checked in at the front desk. Block a slot for maintenance or a walk-in so it can’t be booked in the app.</p>
      {blocking ? <BlockSlot date={date} resource={blocking.resource} hour={blocking.hour} onClose={() => setBlocking(null)} onDone={() => { setBlocking(null); reload(); }} /> : null}
    </div>
  );
}

function BlockSlot({ date, resource, hour, onClose, onDone }: { date: string; resource: VenueResource; hour: number; onClose: () => void; onDone: () => void }) {
  const { client } = useAuth();
  const [hours, setHours] = useState(1);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await client.post('/v1/merchant/venue/blocks', { resourceId: resource.id, startsAt: atHour(date, hour), endsAt: atHour(date, hour + hours), reason: reason.trim() });
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Block ${resource.name}`} onClose={onClose}>
      <div className="stack">
        <p className="small" style={{ margin: 0 }}>From {hourLabel(hour)} on {date}. Customers won’t be able to book it in the app.</p>
        <Field label="For how long"><select value={hours} onChange={(e) => setHours(Number(e.target.value))}>{[1, 2, 3, 4, 6].map((n) => <option key={n} value={n}>{n} hour{n === 1 ? '' : 's'}</option>)}</select></Field>
        <Field label="Reason (optional)" hint="For your team, for example “Floor polishing” or “Walk-in”."><input value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} /></Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="modal-foot"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Blocking…' : 'Block'}</button></div>
      </div>
    </Modal>
  );
}

/** The customer shows the entry code on their booking. */
function FrontDesk({ onDone }: { onDone: () => void }) {
  const { client } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VenueCheckIn | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try { setResult(await client.post<VenueCheckIn>('/v1/merchant/venue/check-in', { code: code.trim() })); setCode(''); onDone(); } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };
  return (
    <div className="card stack">
      <form className="row" onSubmit={check}>
        <strong style={{ marginRight: 6 }}>Front desk</strong>
        <input style={{ maxWidth: 220 }} placeholder="Entry or pass code, like ABC-123" aria-label="Entry or pass code" value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn primary" disabled={busy || !code.trim()}>{busy ? 'Checking…' : 'Check in'}</button>
      </form>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {result ? (
        <div className={`checkin ${result.result === 'admitted' ? 'success' : 'warning'}`} role="status">
          <strong>{result.result === 'admitted' ? '✓ ' : '✕ '}{result.message}</strong>
          <span>{result.customerName}{result.items.length ? ' · ' : ''}{result.items.map((i) => `${i.sport} ${i.resourceName} ${timeLabel(i.startsAt)}–${timeLabel(i.endsAt)}${i.spots > 1 ? ` × ${i.spots}` : ''}`).join(', ')} · {result.bookingRef}</span>
        </div>
      ) : null}
    </div>
  );
}

type Draft = { id: string | null; sport: string; name: string; kind: 'court' | 'spots'; capacity: string; slotMinutes: string; price: string; peakPrice: string; peakFrom: string; peakTo: string; weekendPeak: boolean; active: boolean };
const blank: Draft = { id: null, sport: '', name: '', kind: 'court', capacity: '10', slotMinutes: '60', price: '', peakPrice: '', peakFrom: '', peakTo: '', weekendPeak: false, active: true };
const SPORTS = ['Badminton', 'Pickleball', 'Tennis', 'Football', 'Cricket', 'Box cricket', 'Table tennis', 'Basketball', 'Swimming', 'Skating', 'Yoga', 'Gym', 'Martial arts', 'Personal training'];

function Courts() {
  const { client } = useAuth();
  const list = useAsync(() => client.get<VenueResource[]>('/v1/merchant/venue/resources'), [client]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const edit = (r: VenueResource) => setDraft({
    id: r.id, sport: r.sport, name: r.name, kind: r.kind, capacity: String(r.capacity), slotMinutes: String(r.slotMinutes), price: paiseToRupees(r.price),
    peakPrice: r.peakPrice === null ? '' : paiseToRupees(r.peakPrice), peakFrom: r.peakFrom ?? '', peakTo: r.peakTo ?? '', weekendPeak: r.weekendPeak, active: r.active,
  });

  const save = async () => {
    if (!draft) return;
    const price = rupeesToPaise(draft.price), peak = draft.peakPrice.trim() ? rupeesToPaise(draft.peakPrice) : null;
    if (!draft.sport.trim() || !draft.name.trim()) return setError('Give the sport and a name, like “Badminton” and “Court 1”.');
    if (price === null) return setError('Enter the price per slot in rupees.');
    if (draft.peakPrice.trim() && peak === null) return setError('Enter the peak price in rupees, or leave it empty.');
    const body: VenueResourceInput = {
      sport: draft.sport.trim(), name: draft.name.trim(), kind: draft.kind, capacity: draft.kind === 'court' ? 1 : Number(draft.capacity) || 1, slotMinutes: Number(draft.slotMinutes),
      price, peakPrice: peak, peakFrom: draft.peakFrom || null, peakTo: draft.peakTo || null, weekendPeak: draft.weekendPeak, active: draft.active, sortOrder: 0,
    };
    setBusy(true);
    setError(null);
    try {
      if (draft.id) await client.put(`/v1/merchant/venue/resources/${draft.id}`, body); else await client.post('/v1/merchant/venue/resources', body);
      setNotice(`Saved ${body.name}. Customers can book it in the app.`);
      setDraft(null);
      list.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: VenueResource) => {
    if (!window.confirm(`Delete ${r.name}? If it has bookings it can only be switched off.`)) return;
    setError(null);
    try { await client.del(`/v1/merchant/venue/resources/${r.id}`); setNotice(`${r.name} deleted.`); list.reload(); } catch (e) { setError(errorText(e)); }
  };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p className="muted small" style={{ margin: 0 }}>A <strong>court</strong> is booked by one group per slot (a badminton court, a football turf, cricket nets). A <strong>session</strong> takes several people per slot up to its capacity (swimming, yoga, a gym slot).</p>
        <button className="btn primary" onClick={() => { setError(null); setDraft({ ...blank }); }}>Add court or session</button>
      </div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error && !draft ? <Notice tone="error">{error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Sport</th><th>Name</th><th>Type</th><th>Price per slot</th><th>Peak</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data?.map((r) => (
                <tr key={r.id} className={r.active ? '' : 'dim'}>
                  <td>{r.sport}</td>
                  <td><strong>{r.name}</strong></td>
                  <td className="small">{r.kind === 'court' ? 'Court' : `Session · ${r.capacity} spots`} · {r.slotMinutes} min</td>
                  <td>{formatINR(r.price)}</td>
                  <td className="small">{r.peakPrice !== null ? `${formatINR(r.peakPrice)}${r.peakFrom ? ` · ${r.peakFrom}–${r.peakTo}` : ''}${r.weekendPeak ? ' · weekends' : ''}` : '—'}</td>
                  <td>{r.active ? <Badge tone="success">Bookable</Badge> : <Badge>Switched off</Badge>}</td>
                  <td className="actions"><button className="btn ghost sm" onClick={() => { setError(null); edit(r); }}>Edit</button><button className="btn ghost sm danger" onClick={() => remove(r)}>Delete</button></td>
                </tr>
              ))}
              {list.data?.length === 0 ? <tr><td colSpan={7} className="muted">Nothing yet. Add your first court, turf or class.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {draft ? (
        <Modal title={draft.id ? `Edit ${draft.name}` : 'Add a court or session'} onClose={() => setDraft(null)} wide>
          <div className="stack">
            <div className="grid3">
              <Field label="Sport"><input list="sports" value={draft.sport} onChange={(e) => setDraft({ ...draft, sport: e.target.value })} placeholder="Badminton" /><datalist id="sports">{SPORTS.map((s) => <option key={s} value={s} />)}</datalist></Field>
              <Field label="Name"><input value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Court 1" /></Field>
              <Field label="Type"><select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft['kind'] })}><option value="court">Court: one group per slot</option><option value="spots">Session: several people per slot</option></select></Field>
            </div>
            <div className="grid3">
              {draft.kind === 'spots' ? <Field label="People per slot"><input inputMode="numeric" value={draft.capacity} onChange={(e) => setDraft({ ...draft, capacity: e.target.value })} /></Field> : null}
              <Field label="Slot length"><select value={draft.slotMinutes} onChange={(e) => setDraft({ ...draft, slotMinutes: e.target.value })}>{[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}</select></Field>
              <Field label={draft.kind === 'spots' ? 'Price per person per slot (₹)' : 'Price per slot (₹)'}><input inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></Field>
            </div>
            <fieldset className="hours">
              <legend>Peak price (optional)</legend>
              <div className="grid3">
                <Field label="Peak price (₹)"><input inputMode="decimal" value={draft.peakPrice} onChange={(e) => setDraft({ ...draft, peakPrice: e.target.value })} /></Field>
                <Field label="From"><input type="time" value={draft.peakFrom} onChange={(e) => setDraft({ ...draft, peakFrom: e.target.value })} /></Field>
                <Field label="To"><input type="time" value={draft.peakTo} onChange={(e) => setDraft({ ...draft, peakTo: e.target.value })} /></Field>
              </div>
              <label className="check"><input type="checkbox" checked={draft.weekendPeak} onChange={(e) => setDraft({ ...draft, weekendPeak: e.target.checked })} /> Peak price all day on Saturdays and Sundays</label>
            </fieldset>
            <label className="check"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Customers can book it</label>
            <p className="muted small" style={{ margin: 0 }}>Slots follow your opening hours (Profile and photos). Bookings open 14 days ahead.</p>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot"><button className="btn" onClick={() => setDraft(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

// ---------- monthly memberships ----------
type PlanDraft = { id: string | null; name: string; description: string; months: string; price: string; benefits: string; active: boolean };
const blankPlan: PlanDraft = { id: null, name: '', description: '', months: '1', price: '', benefits: '', active: true };
const MONTH_CHOICES = [1, 3, 6, 12];
const dayText = (d: string) => new Date(`${d}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: IST });

function Memberships() {
  const { client } = useAuth();
  const plans = useAsync(() => client.get<VenuePlan[]>('/v1/merchant/venue/plans'), [client]);
  const members = useAsync(() => client.get<VenueMember[]>('/v1/merchant/venue/members'), [client]);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const edit = (p: VenuePlan) => setDraft({ id: p.id, name: p.name, description: p.description, months: String(p.months), price: paiseToRupees(p.price), benefits: p.benefits.join('\n'), active: p.active });

  const save = async () => {
    if (!draft) return;
    const price = rupeesToPaise(draft.price);
    if (draft.name.trim().length < 2) return setError('Give the plan a name, like “Monthly unlimited”.');
    if (price === null) return setError('Enter the price for the whole plan in rupees.');
    const benefits = draft.benefits.split('\n').map((b) => b.trim()).filter(Boolean);
    if (benefits.length > 8) return setError('Up to 8 benefits.');
    const body: VenuePlanInput = { name: draft.name.trim(), description: draft.description.trim(), months: Number(draft.months) as VenuePlan['months'], price, benefits, active: draft.active, sortOrder: 0 };
    setBusy(true);
    setError(null);
    try {
      if (draft.id) await client.put(`/v1/merchant/venue/plans/${draft.id}`, body); else await client.post('/v1/merchant/venue/plans', body);
      setNotice(`Saved ${body.name}.${body.active ? ' Customers can join in the app.' : ''}`);
      setDraft(null);
      plans.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: VenuePlan) => {
    if (!window.confirm(`Delete ${p.name}? If customers have bought it, it can only be switched off.`)) return;
    setError(null);
    try { await client.del(`/v1/merchant/venue/plans/${p.id}`); setNotice(`${p.name} deleted.`); plans.reload(); } catch (e) { setError(errorText(e)); }
  };

  const active = members.data?.filter((m) => m.activeNow).length ?? 0;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p className="muted small" style={{ margin: 0 }}>Customers choose a plan and the month they start, and pay through VIBE. They show their pass code at the front desk (Schedule tab) on any day it’s valid. Trials and single days are booked by the slot instead.</p>
        <button className="btn primary" onClick={() => { setError(null); setDraft({ ...blankPlan }); }}>Add plan</button>
      </div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error && !draft ? <Notice tone="error">{error}</Notice> : null}
      {plans.loading && !plans.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Plan</th><th>Length</th><th>Price</th><th>Per month</th><th>Status</th><th /></tr></thead>
            <tbody>
              {plans.data?.map((p) => (
                <tr key={p.id} className={p.active ? '' : 'dim'}>
                  <td><strong>{p.name}</strong>{p.description ? <div className="muted small">{p.description}</div> : null}</td>
                  <td>{p.months === 1 ? '1 month' : `${p.months} months`}</td>
                  <td>{formatINR(p.price)}</td>
                  <td className="small">{formatINR(p.perMonth)}</td>
                  <td>{p.active ? <Badge tone="success">On sale</Badge> : <Badge>Switched off</Badge>}</td>
                  <td className="actions"><button className="btn ghost sm" onClick={() => { setError(null); edit(p); }}>Edit</button><button className="btn ghost sm danger" onClick={() => remove(p)}>Delete</button></td>
                </tr>
              ))}
              {plans.data?.length === 0 ? <tr><td colSpan={6} className="muted">No plans yet. Add a monthly plan so customers can join.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ margin: '8px 0 0' }}>Members {members.data ? <span className="muted small">· {active} active now</span> : null}</h3>
      {members.error ? <Notice tone="error">{members.error}</Notice> : members.loading && !members.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Member</th><th>Plan</th><th>Valid</th><th>Visits</th><th>Last visit</th><th>Status</th></tr></thead>
            <tbody>
              {members.data?.map((m) => (
                <tr key={m.passId}>
                  <td><strong>{m.customerName}</strong><div className="muted small">{m.vibeId} · {m.passRef}</div></td>
                  <td>{m.planName}</td>
                  <td className="small">{dayText(m.startsOn)} – {dayText(m.endsOn)}</td>
                  <td>{m.checkIns}</td>
                  <td className="small">{m.lastCheckIn ? new Date(m.lastCheckIn).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: IST }) : '—'}</td>
                  <td>{m.activeNow ? <Badge tone="success">Active</Badge> : m.startsOn > todayIST() ? <Badge tone="pink">Starts {dayText(m.startsOn)}</Badge> : <Badge>Ended</Badge>}</td>
                </tr>
              ))}
              {members.data?.length === 0 ? <tr><td colSpan={6} className="muted">No members yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}

      {draft ? (
        <Modal title={draft.id ? `Edit ${draft.name}` : 'Add a membership plan'} onClose={() => setDraft(null)} wide>
          <div className="stack">
            <div className="grid3">
              <Field label="Name"><input value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Monthly unlimited" /></Field>
              <Field label="Length"><select value={draft.months} onChange={(e) => setDraft({ ...draft, months: e.target.value })}>{MONTH_CHOICES.map((m) => <option key={m} value={m}>{m === 1 ? '1 month' : `${m} months`}</option>)}</select></Field>
              <Field label="Price for the whole plan (₹)"><input inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} placeholder="2999" /></Field>
            </div>
            <Field label="Short description"><input value={draft.description} maxLength={300} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Unlimited gym access, every day." /></Field>
            <Field label="Benefits, one per line (up to 8)"><textarea rows={4} value={draft.benefits} onChange={(e) => setDraft({ ...draft, benefits: e.target.value })} placeholder={'All equipment\nLocker and shower'} /></Field>
            <label className="check"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> On sale in the app</label>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <div className="modal-foot"><button className="btn" onClick={() => setDraft(null)}>Cancel</button><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
