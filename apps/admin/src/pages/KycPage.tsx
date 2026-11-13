import { useState } from 'react';

import { Badge, Field, Loading, Modal, Notice, PageHead, errorText, showDateTime, useAsync, useAuth, type KycRow, type KycStatus, type KycView } from '@kit';

const TABS: { key: KycStatus | ''; label: string }[] = [{ key: 'submitted', label: 'Waiting for review' }, { key: 'verified', label: 'Verified' }, { key: 'rejected', label: 'Sent back' }, { key: '', label: 'All' }];
const TONE: Record<KycStatus, 'success' | 'warning' | 'muted'> = { verified: 'success', submitted: 'warning', rejected: 'muted', not_submitted: 'muted' };

/**
 * Legal and bank details of each business. VIBE checks formats, the GSTIN's check digit and the PAN inside it automatically; a person approves.
 * A business can't be paid out until it is verified, and any change to its details sends it back here.
 */
export function KycPage() {
  const { client } = useAuth();
  const [tab, setTab] = useState<KycStatus | ''>('submitted');
  const list = useAsync(() => client.get<KycRow[]>(`/v1/admin/kyc${tab ? `?status=${tab}` : ''}`), [client, tab]);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <>
      <PageHead title="KYC and bank details" sub="Who each business legally is and where VIBE pays it. Nothing is paid out until a business is verified here." actions={<button className="btn" onClick={list.reload}>Refresh</button>} />
      <div className="tabs" role="tablist">
        {TABS.map((t) => <button key={t.label} role="tab" aria-selected={tab === t.key} className={`tab${tab === t.key ? ' on' : ''}`} onClick={() => { setTab(t.key); setNotice(null); }}>{t.label}</button>)}
      </div>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Business</th><th>Legal name</th><th>Sent</th><th>Automatic checks</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data?.map((k) => (
                <tr key={k.businessId}>
                  <td><strong>{k.businessName}</strong><div className="muted small">{k.category}</div></td>
                  <td>{k.legalName}</td>
                  <td className="small">{showDateTime(k.submittedAt)}</td>
                  <td>{k.checksPass ? <Badge tone="success">All pass</Badge> : <Badge tone="warning">Some fail</Badge>}</td>
                  <td><Badge tone={TONE[k.status]}>{k.status === 'submitted' ? 'Waiting' : k.status === 'rejected' ? 'Sent back' : 'Verified'}</Badge></td>
                  <td className="actions"><button className="btn ghost sm" onClick={() => setOpen(k.businessId)}>Open</button></td>
                </tr>
              ))}
              {list.data?.length === 0 ? <tr><td colSpan={6} className="muted">{tab === 'submitted' ? 'Nothing waiting for review.' : 'None.'}</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
      {open ? <KycModal businessId={open} onClose={() => setOpen(null)} onDone={(m) => { setNotice(m); list.reload(); }} /> : null}
    </>
  );
}

function KycModal({ businessId, onClose, onDone }: { businessId: string; onClose: () => void; onDone: (message: string) => void }) {
  const { client } = useAuth();
  const d = useAsync(() => client.get<KycView>(`/v1/admin/kyc/${businessId}`), [client, businessId]);
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const k = d.data;

  const act = async (kind: 'approve' | 'reject') => {
    setError(null);
    try {
      await client.post(`/v1/admin/kyc/${businessId}/${kind}`, kind === 'reject' ? { note } : undefined);
      onDone(kind === 'approve' ? `${k?.businessName} is verified and can be paid out.` : `Sent back to ${k?.businessName} with your note.`);
      onClose();
    } catch (e) { setError(errorText(e)); }
  };

  return (
    <Modal title={k ? k.businessName : 'KYC'} onClose={onClose} wide>
      {d.loading && !k ? <Loading /> : d.error && !k ? <Notice tone="error">{d.error}</Notice> : k ? (
        <div className="stack">
          <div className="grid2">
            <div className="card stack" style={{ gap: 4 }}>
              <strong>Who they are</strong>
              <div className="small">Legal name: <strong>{k.legalName}</strong></div>
              <div className="small">PAN: <strong>{k.pan}</strong></div>
              <div className="small">GSTIN: <strong>{k.gstin || '—'}</strong></div>
              <div className="small">FSSAI: <strong>{k.fssai || '—'}</strong>{k.fssaiRequired ? ' (required for food)' : ''}</div>
            </div>
            <div className="card stack" style={{ gap: 4 }}>
              <strong>Where VIBE pays</strong>
              <div className="small">Account holder: <strong>{k.bankAccountName}</strong></div>
              <div className="small">Account number: <strong>{k.bankAccountNo}</strong></div>
              <div className="small">IFSC: <strong>{k.bankIfsc}</strong> {k.bankName ? `· ${k.bankName}` : ''}</div>
            </div>
          </div>
          <div className="card stack" style={{ gap: 6 }}>
            <strong>Automatic checks</strong>
            {k.checks.map((c) => <div key={c.key} className="row small"><Badge tone={c.ok ? 'success' : 'warning'}>{c.ok ? 'Pass' : 'Fail'}</Badge><strong>{c.label}</strong><span className="muted">{c.message}</span></div>)}
            <p className="muted small" style={{ margin: 0 }}>These check the details are well formed and consistent. Confirm the account really belongs to them (a ₹1 test transfer, or a cancelled cheque) before approving.</p>
          </div>
          {k.documents.length ? <div className="small">Documents: {k.documents.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer">{u.split('/').pop() || 'document'} </a>)}</div> : null}
          {k.reviewNote ? <Notice tone="info">Last note: {k.reviewNote}</Notice> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          {rejecting ? (
            <div className="stack">
              <Field label="What should they correct?"><textarea rows={3} autoFocus value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
              <div className="modal-foot"><button className="btn" onClick={() => setRejecting(false)}>Back</button><button className="btn primary" disabled={!note.trim()} onClick={() => act('reject')}>Send back</button></div>
            </div>
          ) : (
            <div className="modal-foot">
              {k.status !== 'rejected' ? <button className="btn ghost danger" onClick={() => setRejecting(true)}>Send back…</button> : null}
              {k.status !== 'verified' ? <button className="btn primary" disabled={!k.checks.every((c) => c.ok)} onClick={() => act('approve')}>Verify</button> : <Badge tone="success">Verified</Badge>}
            </div>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
