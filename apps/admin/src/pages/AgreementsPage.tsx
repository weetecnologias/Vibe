import { useState } from 'react';

import { Badge, Field, Loading, Notice, PageHead, errorText, showDateTime, useAsync, useAuth, type AgreementAcceptance, type AgreementVersion } from '@kit';

/**
 * The merchant agreement. Publish a version and every business has to accept it (new applicants accept it when applying; businesses already on VIBE
 * on their next sign-in). Each acceptance is kept with who, when and from where. Have a lawyer approve the text before real businesses sign.
 */
export function AgreementsPage() {
  const { client } = useAuth();
  const versions = useAsync(() => client.get<AgreementVersion[]>('/v1/admin/agreements'), [client]);
  const [showing, setShowing] = useState<number | undefined>(undefined);
  const accepted = useAsync(() => client.get<AgreementAcceptance[]>(`/v1/admin/agreements/acceptances${showing ? `?version=${showing}` : ''}`), [client, showing]);
  const [title, setTitle] = useState('VIBE Merchant Agreement');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reading, setReading] = useState<AgreementVersion | null>(null);
  const current = versions.data?.[0];

  const publish = async () => {
    if (!window.confirm('Publish this as the new version? Every business will have to accept it again before using its dashboard.')) return;
    setBusy(true);
    setError(null);
    try {
      const v = await client.post<AgreementVersion>('/v1/admin/agreements', { title: title.trim(), body: body.trim() });
      setNotice(`Version ${v.version} is published. Businesses are asked to accept it.`);
      setBody('');
      versions.reload();
      accepted.reload();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHead title="Merchant agreement" sub="The terms every business accepts: fees, settlement, refunds, verification. Publishing a new version asks everyone to accept it again." />
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {!current && !versions.loading ? <Notice tone="info">No agreement is published, so nothing is required of businesses yet. Publish one below before onboarding real businesses.</Notice> : null}
      {versions.loading && !versions.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Version</th><th>Published</th><th>Accepted by</th><th /></tr></thead>
            <tbody>
              {versions.data?.map((v, i) => (
                <tr key={v.id}>
                  <td><strong>Version {v.version}</strong>{i === 0 ? <> <Badge tone="success">Current</Badge></> : null}<div className="muted small">{v.title}</div></td>
                  <td className="small">{showDateTime(v.publishedAt)}<div className="muted">{v.publishedBy}</div></td>
                  <td>{v.accepted} businesses</td>
                  <td className="actions"><button className="btn ghost sm" onClick={() => setReading(reading?.id === v.id ? null : v)}>{reading?.id === v.id ? 'Hide' : 'Read'}</button><button className="btn ghost sm" onClick={() => setShowing(v.version)}>Who accepted</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reading ? <div className="card" style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}><strong>{reading.title}</strong>{'\n\n'}{reading.body}</div> : null}

      <div className="card stack" style={{ marginTop: 16 }}>
        <h3 style={{ margin: 0 }}>Publish a new version</h3>
        <Field label="Title"><input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Text" hint="Plain text. Cover fees and commission, GST, settlement timing, who bears refunds and cancellations, KYC, data use and ending the agreement."><textarea rows={10} value={body} maxLength={50000} onChange={(e) => setBody(e.target.value)} /></Field>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="row"><button className="btn primary" disabled={busy || title.trim().length < 3 || body.trim().length < 20} onClick={publish}>{busy ? 'Publishing…' : 'Publish'}</button></div>
      </div>

      <h3 style={{ margin: '18px 0 8px' }}>Acceptances {showing ? `of version ${showing}` : ''} {showing ? <button className="btn ghost sm" onClick={() => setShowing(undefined)}>All versions</button> : null}</h3>
      {accepted.loading && !accepted.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Business</th><th>Version</th><th>Accepted</th><th>By</th><th>From</th></tr></thead>
            <tbody>
              {accepted.data?.map((a) => <tr key={`${a.businessId}-${a.version}`}><td><strong>{a.businessName}</strong></td><td>{a.version}</td><td className="small">{showDateTime(a.acceptedAt)}</td><td className="small">{a.acceptedBy ?? '—'}</td><td className="small">{a.source === 'application' ? 'When applying' : 'Dashboard'} {a.ip ? `· ${a.ip}` : ''}</td></tr>)}
              {accepted.data?.length === 0 ? <tr><td colSpan={5} className="muted">No acceptances yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
