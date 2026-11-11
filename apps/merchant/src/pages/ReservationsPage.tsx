import { useEffect, useState } from 'react';

import { Field, Loading, Notice, PageHead, errorText, paiseToRupees, rupeesToPaise, useAsync, useAuth, type ReservationSettings } from '@kit';

export function ReservationsPage() {
  const { client } = useAuth();
  const settings = useAsync(() => client.get<ReservationSettings>('/v1/merchant/reservation-settings'), [client]);
  const [enabled, setEnabled] = useState(false);
  const [table, setTable] = useState('');
  const [slot, setSlot] = useState('');
  const [policy, setPolicy] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const s = settings.data;
    if (s && !loaded) { setLoaded(true); setEnabled(s.enabled); setTable(paiseToRupees(s.tableFee)); setSlot(paiseToRupees(s.slotFee)); setPolicy(s.policy); }
  }, [settings.data, loaded]);

  const save = async () => {
    setError(null);
    setSaved(false);
    const tableFee = table.trim() ? rupeesToPaise(table) : null;
    const slotFee = slot.trim() ? rupeesToPaise(slot) : null;
    if ((table.trim() && (tableFee === null || tableFee < 1)) || (slot.trim() && (slotFee === null || slotFee < 1))) return setError('Fees must be amounts in rupees, like 200 or 150.50.');
    setBusy(true);
    try {
      await client.put('/v1/merchant/reservation-settings', { enabled, tableFee, slotFee, policy: policy.trim() });
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
      <PageHead title="Reservations" sub="When someone plans to meet a person at your place, they can pay a small fee to reserve a table or a slot. You set the fee and the policy." />
      <div className="card stack">
        <label className="check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> <strong>Accept reservations at my place</strong></label>
        <div className="grid2">
          <Field label="Table fee (₹)" hint="For a table for two. Leave empty if you don’t take table reservations."><input inputMode="decimal" value={table} onChange={(e) => setTable(e.target.value)} placeholder="200" /></Field>
          <Field label="Slot fee (₹)" hint="For a court or slot, for example a badminton court. Leave empty if it doesn’t apply."><input inputMode="decimal" value={slot} onChange={(e) => setSlot(e.target.value)} placeholder="200" /></Field>
        </div>
        <Field label="Cancellation policy" hint="Customers read this before they pay. Say what happens to the fee, for example whether it is adjusted against the bill and when it is refunded.">
          <textarea rows={4} maxLength={600} value={policy} onChange={(e) => setPolicy(e.target.value)} />
        </Field>
        <Notice tone="info">Customers can reserve only once VIBE turns reservations on for the app. Refunds are issued through VIBE’s payment partner, which is not connected yet.</Notice>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {saved ? <Notice tone="success">Saved.</Notice> : null}
        <div className="row"><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
      </div>
    </>
  );
}
