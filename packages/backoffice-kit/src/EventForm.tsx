import { useState } from 'react';

import { buildEvent, emptyTicket, type EventDraft } from './eventDraft';
import { ImageField } from './ImageField';
import { EVENT_KINDS, type EventInput } from './types';
import { Field, Notice } from './ui';

/** The event and its ticket types. Used by the merchant dashboard and by the admin dashboard (which also sets the organiser and Featured). */
export function EventForm({ draft, onChange, admin, submitLabel, onSubmit, onCancel }: {
  draft: EventDraft; onChange: (d: EventDraft) => void; admin?: boolean; submitLabel: string; onSubmit: (input: EventInput) => Promise<void>; onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) => onChange({ ...draft, [k]: v });
  const setTicket = (i: number, patch: Partial<EventDraft['tickets'][number]>) => set('tickets', draft.tickets.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const submit = async () => {
    setError(null);
    const r = buildEvent(draft, !!admin);
    if (!r.ok) return setError(r.error);
    setBusy(true);
    try {
      await onSubmit(r.input);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="card stack">
        <h2>Event</h2>
        <div className="grid2">
          <Field label="Title"><input value={draft.title} maxLength={120} onChange={(e) => set('title', e.target.value)} /></Field>
          <Field label="Type"><select value={draft.kind} onChange={(e) => set('kind', e.target.value)}>{EVENT_KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field>
        </div>
        <Field label="About"><textarea rows={4} value={draft.description} maxLength={4000} onChange={(e) => set('description', e.target.value)} /></Field>
        <div className="grid2">
          <Field label="Venue"><input value={draft.venue} maxLength={120} onChange={(e) => set('venue', e.target.value)} /></Field>
          <Field label="Area"><input value={draft.area} maxLength={80} placeholder="Jubilee Hills" onChange={(e) => set('area', e.target.value)} /></Field>
        </div>
        <div className="grid3">
          <Field label="Starts (India time)"><input type="datetime-local" value={draft.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></Field>
          <Field label="Doors open (minutes before)"><input inputMode="numeric" value={draft.doorsMinutes} onChange={(e) => set('doorsMinutes', e.target.value)} /></Field>
          <Field label="Age limit" hint="Optional, 5 to 99."><input inputMode="numeric" value={draft.ageLimit} onChange={(e) => set('ageLimit', e.target.value)} placeholder="18" /></Field>
        </div>
        <ImageField label="Cover image" value={draft.coverUrl} onChange={(v) => set('coverUrl', v)} />
        <Field label="Terms shown to customers" hint="One per line. Up to 10."><textarea rows={3} value={draft.terms} onChange={(e) => set('terms', e.target.value)} /></Field>
        {admin ? (
          <div className="grid2">
            <Field label="Organiser" hint="Shown to customers. Leave empty for VIBE Hosts."><input value={draft.organiser} onChange={(e) => set('organiser', e.target.value)} /></Field>
            <Field label="Featured"><label className="check"><input type="checkbox" checked={draft.featured} onChange={(e) => set('featured', e.target.checked)} /> Show first</label></Field>
          </div>
        ) : null}
      </div>

      <div className="card stack">
        <h2>Tickets</h2>
        {draft.tickets.map((t, i) => (
          <div key={i} className="card stack" style={{ background: 'var(--soft-white)' }}>
            <div className="grid2">
              <Field label="Name"><input value={t.name} maxLength={80} placeholder="General" onChange={(e) => setTicket(i, { name: e.target.value })} /></Field>
              <Field label="Description"><input value={t.description} maxLength={200} onChange={(e) => setTicket(i, { description: e.target.value })} /></Field>
            </div>
            <div className="grid3">
              <Field label="Price (₹)" hint="0 for free."><input inputMode="decimal" value={t.price} onChange={(e) => setTicket(i, { price: e.target.value })} /></Field>
              <Field label="Tickets available"><input inputMode="numeric" value={t.capacity} onChange={(e) => setTicket(i, { capacity: e.target.value })} /></Field>
              <Field label="Most per person"><input inputMode="numeric" value={t.maxPerOrder} onChange={(e) => setTicket(i, { maxPerOrder: e.target.value })} /></Field>
            </div>
            {draft.tickets.length > 1 ? <div className="row"><button type="button" className="btn ghost sm danger" onClick={() => set('tickets', draft.tickets.filter((_, j) => j !== i))}>Remove this ticket type</button></div> : null}
          </div>
        ))}
        <div className="row"><button type="button" className="btn sm" disabled={draft.tickets.length >= 10} onClick={() => set('tickets', [...draft.tickets, emptyTicket()])}>Add ticket type</button></div>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : submitLabel}</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

