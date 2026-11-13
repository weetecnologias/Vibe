import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Field, MERCHANT_FEATURES, Notice, errorText, useAuth, type Client, type MerchantFeature } from '@kit';

type Node = { id: string; slug: string; name: string; features: MerchantFeature[]; children: Node[] };
type Terms = { id: string; version: number; title: string; body: string };
type Form = { acceptTerms?: boolean; businessName: string; categoryId: string; area: string; address: string; contactName: string; email: string; phone: string; about: string; documents: string };
type Saved = { id: string; token: string; form: Form };
type Status = { id: string; businessName: string; status: 'pending' | 'changes_requested' | 'approved' | 'rejected'; reviewNote: string | null; submittedAt: string; decidedAt: string | null };

const KEY = 'vibe.application';
const empty: Form = { businessName: '', categoryId: '', area: '', address: '', contactName: '', email: '', phone: '', about: '', documents: '' };

const load = (): Saved | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Saved | null; } catch { return null; } };
const save = (s: Saved | null) => { try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* storage blocked */ } };

/** The top-level category a category sits under, and the category itself, found anywhere in the tree. */
const findPath = (nodes: Node[], id: string, path: Node[] = []): Node[] | null => {
  for (const n of nodes) {
    if (n.id === id) return [...path, n];
    const deeper = findPath(n.children, id, [...path, n]);
    if (deeper) return deeper;
  }
  return null;
};
const flatChildren = (n: Node, depth = 0): { node: Node; depth: number }[] => n.children.flatMap((c) => [{ node: c, depth }, ...flatChildren(c, depth + 1)]);

const body = (f: Form) => ({
  acceptTerms: f.acceptTerms === true, businessName: f.businessName.trim(), categoryId: f.categoryId || null, area: f.area.trim(), address: f.address.trim(), contactName: f.contactName.trim(), email: f.email.trim(), phone: f.phone.trim(), about: f.about.trim(),
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
  const [tree, setTree] = useState<Node[]>([]);
  const [top, setTop] = useState<string>('');
  const [terms, setTerms] = useState<Terms | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });

  useEffect(() => {
    let live = true;
    client.get<Node[]>('/v1/business-applications/categories').then((n) => {
      if (!live) return;
      setTree(n);
      const path = initial.categoryId ? findPath(n, initial.categoryId) : null;
      if (path) setTop(path[0].id);
    }, () => undefined);
    client.get<Terms | null>('/v1/business-applications/terms').then((t) => live && setTerms(t ?? null), () => undefined);
    return () => { live = false; };
  }, [client, initial.categoryId]);

  const topNode = tree.find((n) => n.id === top) ?? null;
  const chosen = f.categoryId ? findPath(tree, f.categoryId)?.at(-1) ?? null : null;
  const ready = (!terms || f.acceptTerms === true) && !!f.categoryId && f.businessName.trim() && f.area.trim() && f.contactName.trim() && /\S+@\S+\.\S+/.test(f.email) && f.phone.replace(/\D/g, '').length >= 10;

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
      <fieldset className="hours">
        <legend>1. What kind of business is it?</legend>
        <p className="muted small" style={{ marginTop: 0 }}>Choose one. Your VIBE dashboard shows only what this kind of business needs. Running two kinds of business (say a café and a gym)? Apply for each one separately; each gets its own login.</p>
        <div className="choice-grid">
          {tree.map((n) => (
            <button type="button" key={n.id} className={`choice${top === n.id ? ' on' : ''}`} aria-pressed={top === n.id}
              onClick={() => { setTop(n.id); setF({ ...f, categoryId: n.children.length ? '' : n.id }); }}>{n.name}</button>
          ))}
        </div>
        {topNode && topNode.children.length ? (
          <Field label={`2. Which kind of ${topNode.name}?`}>
            <select value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
              <option value="">Choose…</option>
              {flatChildren(topNode).map(({ node, depth }) => <option key={node.id} value={node.id}>{`${'— '.repeat(depth)}${node.name}`}</option>)}
            </select>
          </Field>
        ) : null}
        {chosen ? (
          <div className="card" style={{ background: 'var(--soft, #f8f6f9)' }}>
            <strong>On VIBE, {chosen.name} businesses get:</strong>
            <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {MERCHANT_FEATURES.filter((x) => chosen.features.includes(x.key)).map((x) => <li key={x.key}><strong>{x.label}</strong>: {x.hint}</li>)}
              <li><strong>Always</strong>: your profile and photos, reviews, results, settlements with Excel downloads, and your team’s logins</li>
            </ul>
          </div>
        ) : null}
      </fieldset>
      <Field label="Business name"><input value={f.businessName} maxLength={120} onChange={(e) => set('businessName', e.target.value)} /></Field>
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
      {terms ? (
        <div className="card stack" style={{ gap: 8 }}>
          <label className="check"><input type="checkbox" checked={f.acceptTerms === true} onChange={(e) => setF({ ...f, acceptTerms: e.target.checked })} /> I have read and accept the <button type="button" className="btn ghost sm" onClick={() => setReading(!reading)}>{terms.title}</button> (version {terms.version}).</label>
          {reading ? <div style={{ whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }} className="small" tabIndex={0}>{terms.body}</div> : null}
        </div>
      ) : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <button className="btn primary" disabled={busy || !ready}>{busy ? 'Sending…' : submitLabel}</button>
    </form>
  );
}
