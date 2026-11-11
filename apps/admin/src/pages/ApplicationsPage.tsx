import { useState } from 'react';

import {
  Badge, Field, Loading, Modal, Notice, PageHead, errorText, showDateTime, useAsync, useAuth,
  type ApplicationApproved, type ApplicationDetail, type ApplicationRow, type ApplicationStatus, type CategoryRow,
} from '@kit';

import { order } from './CategoriesPage';

const TABS: { key: ApplicationStatus; label: string }[] = [{ key: 'pending', label: 'Waiting for review' }, { key: 'changes_requested', label: 'Changes requested' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Rejected' }];
const TONE: Record<ApplicationStatus, 'warning' | 'pink' | 'success' | 'muted'> = { pending: 'warning', changes_requested: 'pink', approved: 'success', rejected: 'muted' };

/** Businesses that applied to join VIBE. Approving creates the listing (switched off) and the owner's login. */
export function ApplicationsPage() {
  const { client } = useAuth();
  const [tab, setTab] = useState<ApplicationStatus>('pending');
  const list = useAsync(() => client.get<ApplicationRow[]>(`/v1/admin/applications?status=${tab}`), [client, tab]);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <PageHead title="Business applications" sub="Review each business before it can appear in the app. Approving gives the owner a login; the listing stays off until it is complete and you switch it on." />
      <div className="tabs" role="tablist">
        {TABS.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} className={`tab${tab === t.key ? ' on' : ''}`} onClick={() => { setTab(t.key); setNotice(null); }}>{t.label}</button>)}
      </div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Business</th><th>Category</th><th>Contact</th><th>Applied</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data?.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.businessName}</strong><div className="muted small">{a.area}</div></td>
                  <td className="small">{a.categoryName ?? '—'}</td>
                  <td className="small">{a.contactName}<div className="muted">{a.email}</div></td>
                  <td className="small">{showDateTime(a.submittedAt)}</td>
                  <td><Badge tone={TONE[a.status]}>{TABS.find((t) => t.key === a.status)?.label}</Badge></td>
                  <td className="actions"><button className="btn ghost sm" onClick={() => setOpen(a.id)}>{a.status === 'pending' ? 'Review' : 'Open'}</button></td>
                </tr>
              ))}
              {list.data?.length === 0 ? <tr><td colSpan={6} className="muted">{tab === 'pending' ? 'Nothing waiting for review.' : 'None.'}</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {open ? <ApplicationModal id={open} onClose={() => setOpen(null)} onDecided={(msg) => { setNotice(msg); list.reload(); }} /> : null}
    </>
  );
}

function ApplicationModal({ id, onClose, onDecided }: { id: string; onClose: () => void; onDecided: (message: string) => void }) {
  const { client } = useAuth();
  const app = useAsync(() => client.get<ApplicationDetail>(`/v1/admin/applications/${id}`), [client, id]);
  const cats = useAsync(() => client.get<CategoryRow[]>('/v1/admin/categories'), [client]);
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'review' | 'changes' | 'reject'>('review');
  const [approved, setApproved] = useState<ApplicationApproved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const a = app.data;
  const catId = category || a?.categoryId || '';

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try { await fn(); onDecided(done); app.reload(); setMode('review'); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await client.post<ApplicationApproved>(`/v1/admin/applications/${id}/approve`, { categoryId: catId || null });
      setApproved(r);
      onDecided(`Approved ${a?.row.businessName}.`);
      app.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const options = order((cats.data ?? []).filter((c) => c.active)).map((c) => ({ id: c.id, label: c.name, level: c.depth + 1 }));

  return (
    <Modal title={a?.row.businessName ?? 'Application'} onClose={onClose} wide>
      {app.loading && !a ? <Loading /> : app.error && !a ? <Notice tone="error">{app.error}</Notice> : a ? (
        approved ? (
          <div className="stack">
            <Notice tone="success">Approved. The listing exists but is switched off. Pass these login details to the owner now: the password is shown only here, once, and they must change it when they first sign in.</Notice>
            <div className="card stack">
              <div>Merchant dashboard: <strong>{approved.loginEmail}</strong></div>
              <div className="secret" aria-label="Temporary password">{approved.temporaryPassword}</div>
            </div>
            <p className="muted small" style={{ margin: 0 }}>Email delivery isn’t connected yet, so this is passed on by hand. Open the business under Businesses to check the listing and switch it on when it’s ready.</p>
            <div className="modal-foot"><button className="btn primary" onClick={onClose}>Done</button></div>
          </div>
        ) : (
          <div className="stack">
            <div className="grid2">
              <div className="card stack">
                <h2>Business</h2>
                <div><strong>{a.row.businessName}</strong></div>
                <div className="small">{a.address || '—'}, {a.row.area}</div>
                <div className="small">Category asked for: {a.row.categoryName ?? 'not chosen'}</div>
                <p className="small" style={{ margin: 0 }}>{a.about || 'No description.'}</p>
              </div>
              <div className="card stack">
                <h2>Contact</h2>
                <div>{a.row.contactName}</div>
                <div className="small">{a.row.email} · {a.row.phone}</div>
                <div className="small">Applied {showDateTime(a.row.submittedAt)}</div>
                <div className="small"><strong>Documents</strong>{a.documents.length ? <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{a.documents.map((d) => <li key={d}><a href={d} target="_blank" rel="noreferrer noopener">{d}</a></li>)}</ul> : <span className="muted"> none attached</span>}</div>
              </div>
            </div>
            {a.reviewNote ? <Notice tone="info">Note to the applicant: {a.reviewNote}</Notice> : null}
            {error ? <Notice tone="error">{error}</Notice> : null}

            {a.row.status === 'pending' ? (
              mode === 'review' ? (
                <div className="card stack">
                  <Field label="Main category for the listing" hint="Decides how customers pay it (bills or tickets).">
                    <select value={catId} onChange={(e) => setCategory(e.target.value)}><option value="">Choose…</option>{options.map((o) => <option key={o.id} value={o.id}>{'— '.repeat(o.level - 1)}{o.label}</option>)}</select>
                  </Field>
                  <div className="row">
                    <button className="btn primary" disabled={busy || !catId} onClick={approve}>{busy ? 'Approving…' : 'Approve and create login'}</button>
                    <button className="btn" onClick={() => { setError(null); setNote(''); setMode('changes'); }}>Ask for changes</button>
                    <button className="btn ghost danger" onClick={() => { setError(null); setNote(''); setMode('reject'); }}>Reject</button>
                  </div>
                </div>
              ) : (
                <div className="card stack">
                  <Field label={mode === 'changes' ? 'What should they change?' : 'Reason for rejecting'} hint="The applicant sees this when they check their application."><textarea autoFocus rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
                  <div className="row">
                    <button className="btn primary" disabled={busy || !note.trim()} onClick={() => run(() => client.post(`/v1/admin/applications/${id}/${mode === 'changes' ? 'request-changes' : 'reject'}`, { note }), mode === 'changes' ? 'Asked for changes.' : 'Rejected.')}>{mode === 'changes' ? 'Send request' : 'Reject application'}</button>
                    <button className="btn" onClick={() => setMode('review')}>Back</button>
                  </div>
                </div>
              )
            ) : a.row.status === 'approved' ? <Notice tone="success">Approved {a.decidedAt ? showDateTime(a.decidedAt) : ''}. The business is under Businesses.</Notice> : null}
          </div>
        )
      ) : null}
    </Modal>
  );
}
