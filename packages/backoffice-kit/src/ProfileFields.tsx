import { useState } from 'react';

import { type ProfileDraft } from './draft';
import { DAYS } from './types';
import { Field } from './ui';

export function ProfileFields({ draft, onChange }: { draft: ProfileDraft; onChange: (d: ProfileDraft) => void }) {
  const set = <K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) => onChange({ ...draft, [k]: v });
  const [showMore, setShowMore] = useState(true);
  return (
    <div className="stack">
      <div className="grid2">
        <Field label="Business name"><input value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={120} required /></Field>
        <Field label="Area"><input value={draft.area} onChange={(e) => set('area', e.target.value)} maxLength={80} placeholder="Jubilee Hills" required /></Field>
      </div>
      <Field label="Address"><input value={draft.address} onChange={(e) => set('address', e.target.value)} maxLength={300} /></Field>
      <div className="grid2">
        <Field label="Latitude" hint="Used for distance. Find it on a map."><input inputMode="decimal" value={draft.lat} onChange={(e) => set('lat', e.target.value)} placeholder="17.4326" /></Field>
        <Field label="Longitude"><input inputMode="decimal" value={draft.lng} onChange={(e) => set('lng', e.target.value)} placeholder="78.4071" /></Field>
      </div>
      <Field label="About"><textarea rows={3} value={draft.description} onChange={(e) => set('description', e.target.value)} maxLength={2000} /></Field>
      <div className="grid3">
        <Field label="Price level" hint="1 = budget, 4 = premium">
          <select value={draft.priceLevel} onChange={(e) => set('priceLevel', e.target.value)}>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{'₹'.repeat(n)}</option>)}</select>
        </Field>
        <Field label="Cost for two (₹)"><input inputMode="decimal" value={draft.costForTwo} onChange={(e) => set('costForTwo', e.target.value)} placeholder="1200" /></Field>
        <Field label="Online booking"><label className="check"><input type="checkbox" checked={draft.bookingEnabled} onChange={(e) => set('bookingEnabled', e.target.checked)} /> Accept bookings</label></Field>
      </div>

      <fieldset className="hours">
        <legend>Opening hours (India time)</legend>
        {DAYS.map((day, i) => {
          const h = draft.hours[i];
          const upd = (patch: Partial<ProfileDraft['hours'][number]>) => set('hours', draft.hours.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <div className="hours-row" key={day}>
              <span className="day">{day}</span>
              <label className="check"><input type="checkbox" checked={h.open} onChange={(e) => upd({ open: e.target.checked })} /> Open</label>
              <input type="time" aria-label={`${day} opens`} value={h.opens} disabled={!h.open} onChange={(e) => upd({ opens: e.target.value })} />
              <span>to</span>
              <input type="time" aria-label={`${day} closes`} value={h.closes} disabled={!h.open} onChange={(e) => upd({ closes: e.target.value })} />
            </div>
          );
        })}
        <small className="muted">A closing time earlier than the opening time means it closes after midnight.</small>
      </fieldset>

      <button type="button" className="btn ghost" onClick={() => setShowMore((s) => !s)}>{showMore ? 'Hide' : 'Show'} images and terms</button>
      {showMore ? (
        <div className="stack">
          <div className="grid2">
            <Field label="Logo link" hint="https://…  An uploaded image link. Upload storage arrives with the media service."><input value={draft.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} /></Field>
            <Field label="Cover photo link"><input value={draft.coverUrl} onChange={(e) => set('coverUrl', e.target.value)} /></Field>
          </div>
          <Field label="Photo links" hint="One per line. The first is the main photo. Up to 12."><textarea rows={3} value={draft.photos} onChange={(e) => set('photos', e.target.value)} /></Field>
          <Field label="Terms shown to customers" hint="One per line. Up to 10."><textarea rows={3} value={draft.terms} onChange={(e) => set('terms', e.target.value)} /></Field>
        </div>
      ) : null}
    </div>
  );
}
