import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
  Field, Loading, Notice, PageHead, ProfileFields, bpsToPercent, emptyDraft, errorText, fromDraft, percentToBps, toDraft, useAsync, useAuth,
  type AdminInput, type BusinessTerms, type CategoryRow, type Editable, type ProfileDraft, type Staff,
} from '@kit';

export function BusinessEditPage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const { client } = useAuth();
  const navigate = useNavigate();
  const cats = useAsync(() => client.get<CategoryRow[]>('/v1/admin/categories'), [client]);
  const biz = useAsync(() => (isNew ? Promise.resolve(null) : client.get<Editable>(`/v1/admin/businesses/${id}`)), [client, id]);

  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
  const [primary, setPrimary] = useState('');
  const [extra, setExtra] = useState<string[]>([]);
  const [verified, setVerified] = useState(false);
  const [isNewFlag, setIsNewFlag] = useState(false);
  const [active, setActive] = useState(true);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Fill the form once, when the business arrives (not on every re-render).
  useEffect(() => {
    const b = biz.data;
    if (!b || loadedFor === b.id) return;
    setLoadedFor(b.id);
    setDraft(toDraft(b));
    setPrimary(b.primaryCategoryId);
    setExtra(b.categoryIds.filter((c) => c !== b.primaryCategoryId));
    setVerified(b.verified);
    setIsNewFlag(b.isNew);
    setActive(b.active);
  }, [biz.data, loadedFor]);

  const options = useMemo(() => {
    const rows = cats.data ?? [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const label = (r: CategoryRow): string => (r.parentId && byId.get(r.parentId) ? `${label(byId.get(r.parentId)!)} › ${r.name}` : r.name);
    return rows.map((r) => ({ id: r.id, label: label(r) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [cats.data]);

  const save = async () => {
    setError(null);
    setSaved(false);
    const parsed = fromDraft(draft);
    if (!parsed.ok) return setError(parsed.error);
    if (!primary) return setError('Choose the main category.');
    const body: AdminInput = { primaryCategoryId: primary, categoryIds: [primary, ...extra.filter((c) => c !== primary)], verified, isNew: isNewFlag, active, profile: parsed.profile };
    setBusy(true);
    try {
      if (isNew) {
        const created = await client.post<Editable>('/v1/admin/businesses', body);
        navigate(`/businesses/${created.id}`, { replace: true });
      } else {
        await client.put(`/v1/admin/businesses/${id}`, body);
        setSaved(true);
        biz.reload();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (!isNew && biz.loading && !biz.data) return <Loading />;
  if (!isNew && biz.error && !biz.data) return <Notice tone="error">{biz.error}</Notice>;

  return (
    <>
      <PageHead title={isNew ? 'Add business' : draft.name || 'Business'} sub={isNew ? 'Create the listing, then give the owner a login.' : 'Changes show in the customer app the next time it loads.'}
        actions={<button className="btn" onClick={() => navigate('/businesses')}>Back</button>} />
      <div className="stack">
        <div className="card stack">
          <h2>Listing</h2>
          <ProfileFields draft={draft} onChange={setDraft} />
        </div>

        <div className="card stack">
          <h2>Categories and visibility</h2>
          <Field label="Main category">
            <select value={primary} onChange={(e) => setPrimary(e.target.value)}>
              <option value="">Choose…</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </Field>
          <fieldset className="hours">
            <legend>Also listed under</legend>
            <div className="grid2">
              {options.filter((o) => o.id !== primary).map((o) => (
                <label key={o.id} className="check"><input type="checkbox" checked={extra.includes(o.id)} onChange={(e) => setExtra(e.target.checked ? [...extra, o.id] : extra.filter((x) => x !== o.id))} /> {o.label}</label>
              ))}
            </div>
          </fieldset>
          <div className="row" style={{ gap: 20 }}>
            <label className="check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Live in the customer app</label>
            <label className="check"><input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} /> Verified by VIBE</label>
            <label className="check"><input type="checkbox" checked={isNewFlag} onChange={(e) => setIsNewFlag(e.target.checked)} /> Show “New”</label>
          </div>
        </div>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {saved ? <Notice tone="success">Saved.</Notice> : null}
        <div className="row"><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : isNew ? 'Create business' : 'Save changes'}</button></div>

        {!isNew && id ? <CommercialTerms businessId={id} /> : null}
        {!isNew && id ? <MerchantLogins businessId={id} /> : null}
      </div>
    </>
  );
}

/** VIBE's commission on payments at this business, and whether its offers and events go live without review. Every change needs a reason and is audited. */
function CommercialTerms({ businessId }: { businessId: string }) {
  const { client } = useAuth();
  const terms = useAsync(() => client.get<BusinessTerms>(`/v1/admin/businesses/${businessId}/terms`), [client, businessId]);
  const [commission, setCommission] = useState<string | null>(null);
  const [auto, setAuto] = useState<boolean | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const t = terms.data;
  const pct = commission ?? (t ? bpsToPercent(t.commissionBps) : '');
  const autoOn = auto ?? t?.autoApprove ?? false;
  const bps = percentToBps(pct || '0');
  const changed = !!t && (bps !== t.commissionBps || autoOn !== t.autoApprove);

  const save = async () => {
    if (bps === null) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await client.put(`/v1/admin/businesses/${businessId}/terms`, { commissionBps: bps, autoApprove: autoOn, reason: reason.trim() });
      setReason('');
      setCommission(null);
      setAuto(null);
      setDone(true);
      terms.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <h2>Commercial terms</h2>
      {terms.loading && !t ? <Loading /> : (
        <>
          <div className="grid2">
            <Field label="VIBE commission (%)" hint="Taken from each payment at this business when it is settled. Applies to settlements drawn up from now on.">
              <input inputMode="decimal" style={{ maxWidth: 140 }} value={pct} onChange={(e) => setCommission(e.target.value)} />
            </Field>
            <label className="check" style={{ alignSelf: 'center' }}>
              <input type="checkbox" checked={autoOn} onChange={(e) => setAuto(e.target.checked)} /> Auto-approve this merchant’s offers and events
            </label>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Auto-approved items go live straight away. Admins are still told, and can switch an offer off or reject it later. Use it for merchants you trust.</p>
          {changed ? <Field label="Reason for the change" hint="Kept in the audit log."><input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} /></Field> : null}
          {bps === null ? <Notice tone="error">Enter the commission as a number, for example 8 or 7.5.</Notice> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          {done ? <Notice tone="success">Saved. The merchant has been told if auto-approval changed.</Notice> : null}
          <div className="row"><button className="btn primary" disabled={busy || !changed || bps === null || !reason.trim()} onClick={save}>{busy ? 'Saving…' : 'Save terms'}</button></div>
        </>
      )}
    </div>
  );
}

function MerchantLogins({ businessId }: { businessId: string }) {
  const { client } = useAuth();
  const staff = useAsync(() => client.get<Staff[]>('/v1/admin/staff'), [client]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mine = (staff.data ?? []).filter((s) => s.businessId === businessId);

  const create = async () => {
    setBusy(true);
    setError(null);
    setMade(null);
    try {
      await client.post(`/v1/admin/businesses/${businessId}/staff`, { email, name, password });
      setMade(`Login created for ${email}. Share the password with them privately and ask them to keep it safe.`);
      setEmail(''); setName(''); setPassword('');
      staff.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <h2>Merchant logins</h2>
      <p className="muted small" style={{ margin: 0 }}>People who can sign in to the merchant dashboard for this business only.</p>
      {mine.length ? (
        <ul style={{ margin: 0, paddingLeft: 18 }}>{mine.map((s) => <li key={s.id}>{s.name} · {s.email} {s.active ? '' : '(switched off)'}</li>)}</ul>
      ) : <p className="muted small" style={{ margin: 0 }}>No logins yet.</p>}
      <div className="grid3">
        <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></Field>
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></Field>
        <Field label="Password" hint="At least 10 characters."><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></Field>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {made ? <Notice tone="success">{made}</Notice> : null}
      <div className="row"><button className="btn" disabled={busy || !email || !name || password.length < 10} onClick={create}>Create login</button></div>
    </div>
  );
}
