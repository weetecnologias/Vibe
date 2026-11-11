import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Field, Notice, errorText, useAuth, type Client } from '@kit';

type Node = { id: string; name: string; children: Node[] };
type Form = { businessName: string; categoryId: string; area: string; address: string; contactName: string; email: string; phone: string; about: string; documents: string };
type Saved = { id: string; token: string; form: Form };
type Status = { id: string; businessName: string; status: 'pending' | 'changes_requested' | 'approved' | 'rejected'; reviewNote: string | null; submittedAt: string; decidedAt: string | null };

const KEY = 'vibe.application';
const empty: Form = { businessName: '', categoryId: '', area: '', address: '', contactName: '', email: '', phone: '', about: '', documents: '' };

const load = (): Saved | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null; } catch { return null; } };
const save = (s: Saved | null) => { try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* storage blocked */ } };

const flatten = (nodes: Node[], depth = 0): { id: string; label: string }[] => nodes.flatMap((n) => [{ id: n.id, label: `${'— '.repeat(depth)}${n.name}` }, ...flatten(n.children, depth + 1)]);

const body = (f: Form) => ({
  businessName: f.businessName.trim(), categoryId: f.categoryId || null, area: f.area.trim(), address: f.address.trim(), contactName: f.contactName.trim(), email: f.email.trim(), phone: f.phone.trim(), about: f.about.trim(),
  documents: f.documents.split('\n').map((l) => l.trim()).filter(Boolean),
});

/** For a business that isn't on VIBE yet. No sign-in: the application is followed with a private link kept in this browser. */
export function ApplyPage() {
  const { client } = useAuth();
  const [saved, setSaved] = useState<Saved | null>(load);
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  useEffect(() => {
    if (!saved) return;
    let live = true;
    client.get<Status>(`/v1/business-applications/${saved.id}?token=${encodeURIComponent(saved.token)}`).then((s) => live && setStatus(s), (e) => live && setStatusError(errorText(e)));
    return () => { live = false; };
  }, [client, saved]);

  return (
    <div className="login" style={{ alignItems: 'start', paddingTop: 40 }}>
      <div className="card" style={{ width: 'min(640px, 100%)', display: 'grid', gap: 14 }}>
        <div className="brand"><span className="brand-vibe">VIBE</span> <span>for Business</span></div>
        {saved && status ? (
          <Tracker saved={saved} status={status} client={client} onChanged={(s) => { setSaved(s); setStatus(null); }} onNew={() => { save(null); setSaved(null); setStatus(null); }} />
        ) : saved && statusError ? (
          <>
            <Notice tone="error">{statusError}</Notice>
            <button className="btn" onClick={() => { save(null); setSaved(null); setStatusError(null); }}>Start a new application</button>
          </>
        ) : saved ? <p className="muted">Checking your application…</p> : (
          <ApplicationForm client={client} initial={empty} submitLabel="Send application" onDone={(s) => { save(s); setSaved(s); }} />
        )}
        <Link to="/" className="small">Already have a login? Sign in</Link>
      </div>
    </div>
  );
}

const LABEL: Record<Status['status'], string> = { pending: 'Waiting for review', changes_requested: 'VIBE needs a few changes', approved: 'Approved', rejected: 'Not approved' };

function Tracker({ saved, status, client, onChanged, onNew }: { saved: Saved; status: Status; client: Client; onChanged: (s: Saved) => void; onNew: () => void }) {
  return (
    <div className="stack">
      <h1>{status.businessName}</h1>
      <Notice tone={status.status === 'approved' ? 'success' : status.status === 'rejected' ? 'error' : 'info'}>{LABEL[status.status]}</Notice>
      {status.status === 'pending' ? <p className="muted">Thanks. The VIBE team reviews every business before it goes live. Keep this page: come back to it to see the decision.</p> : null}
      {status.status === 'approved' ? <p>You’re approved. The VIBE team will send your login details. Once you have them, sign in to set up your photos, menu and hours.</p> : null}
      {status.reviewNote ? <div className="card"><strong>Note from VIBE</strong><p style={{ margin: '4px 0 0' }}>{status.reviewNote}</p></div> : null}
      {status.status === 'changes_requested' ? (
        <ApplicationForm client={client} initial={saved.form} submitLabel="Send the changes" resubmit={{ id: saved.id, token: saved.token }} onDone={(s) => onChanged(s)} />
      ) : null}
      {status.status === 'rejected' || status.status === 'approved' ? <button className="btn" onClick={onNew}>Start a new application</button> : null}
    </div>
  );
}

function ApplicationForm({ client, initial, submitLabel, resubmit, onDone }: { client: Client; initial: Form; submitLabel: string; resubmit?: { id: string; token: string }; onDone: (s: Saved) => void }) {
  const [f, setF] = useState<Form>(initial);
  const [cats, setCats] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });

  useEffect(() => {
    let live = true;
    client.get<Node[]>('/v1/categories').then((n) => live && setCats(flatten(n)), () => undefined);
    return () => { live = false; };
  }, [client]);

  const ready = f.businessName.trim() && f.area.trim() && f.contactName.trim() && /\S+@\S+\.\S+/.test(f.email) && f.phone.replace(/\D/g, '').length >= 10;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (resubmit) {
        await client.put(`/v1/business-applications/${resubmit.id}?token=${encodeURIComponent(resubmit.token)}`, body(f));
        onDone({ ...resubmit, form: f });
      } else {
        const r = await client.post<{ id: string; statusToken: string }>('/v1/business-applications', body(f));
        onDone({ id: r.id, token: r.statusToken, form: f });
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={submit}>
      {!resubmit ? <p className="muted" style={{ margin: 0 }}>Tell us about your business. We review every application, and may ask for more details before you go live.</p> : null}
      <div className="grid2">
        <Field label="Business name"><input value={f.businessName} maxLength={120} onChange={(e) => set('businessName', e.target.value)} /></Field>
        <Field label="Type of business"><select value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}><option value="">Choose…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field>
      </div>
      <div className="grid2">
        <Field label="Area"><input value={f.area} maxLength={80} placeholder="Jubilee Hills" onChange={(e) => set('area', e.target.value)} /></Field>
        <Field label="Address"><input value={f.address} maxLength={300} onChange={(e) => set('address', e.target.value)} /></Field>
      </div>
      <div className="grid3">
        <Field label="Your name"><input value={f.contactName} maxLength={120} onChange={(e) => set('contactName', e.target.value)} /></Field>
        <Field label="Email"><input type="email" value={f.email} readOnly={!!resubmit} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Mobile number"><input inputMode="tel" value={f.phone} maxLength={20} placeholder="98765 43210" onChange={(e) => set('phone', e.target.value)} /></Field>
      </div>
      <Field label="About your business"><textarea rows={3} maxLength={1000} value={f.about} onChange={(e) => set('about', e.target.value)} /></Field>
      <Field label="Document links (optional)" hint="One link per line, for example your GST or FSSAI certificate. VIBE will tell you if it needs anything else."><textarea rows={2} value={f.documents} onChange={(e) => set('documents', e.target.value)} /></Field>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <button className="btn primary" disabled={busy || !ready}>{busy ? 'Sending…' : submitLabel}</button>
    </form>
  );
}
