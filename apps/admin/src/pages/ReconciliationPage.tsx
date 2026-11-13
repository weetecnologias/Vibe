import { useRef, useState } from 'react';

import { Badge, DownloadButton, Loading, Notice, PageHead, errorText, formatINR, showDateTime, useAsync, useAuth, type ReconDetail, type ReconItem, type ReconRun } from '@kit';

const RESULT: Record<ReconItem['result'], { label: string; tone: 'success' | 'warning' | 'muted' }> = {
  matched: { label: 'Matched', tone: 'success' }, amount_mismatch: { label: 'Different amount', tone: 'warning' }, status_mismatch: { label: 'Different status', tone: 'warning' },
  missing_in_vibe: { label: 'Not in VIBE', tone: 'warning' }, missing_at_partner: { label: 'Not in partner’s file', tone: 'warning' },
};
const toLook = (r: ReconRun) => r.mismatched + r.missingInVibe + r.missingAtPartner;

/**
 * Checking VIBE's records against the payment partner's settlement file. Upload the file (CSV with a reference or payment id, an amount in rupees and,
 * optionally, a status). Every line is matched; every difference is kept so it can be chased.
 */
export function ReconciliationPage() {
  const { client } = useAuth();
  const runs = useAsync(() => client.get<ReconRun[]>('/v1/admin/reconciliation'), [client]);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReconDetail | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError('That file is over 5 MB. Split it by date.');
    setFileName(file.name);
    setCsv(await file.text());
    setError(null);
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await client.post<ReconDetail>('/v1/admin/reconciliation', { fileName, csv, from: from || null, to: to || null }));
      runs.reload();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const open = async (id: string) => { try { setResult(await client.get<ReconDetail>(`/v1/admin/reconciliation/${id}`)); } catch (e) { setError(errorText(e)); } };

  return (
    <>
      <PageHead title="Reconciliation" sub="Match the payment partner’s settlement file against VIBE’s payments, so nothing customers paid goes missing between the app and the bank." />
      <div className="card stack">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input ref={input} type="file" accept=".csv,text/csv,text/plain" style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} />
          <button className="btn" onClick={() => input.current?.click()}>Choose the partner’s file…</button>
          <span className="small muted">{fileName || 'or paste it below'}</span>
          <label className="small">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="small">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <textarea rows={5} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'reference,amount,status\nVB-ABCD-EFGH,620.00,captured'} style={{ fontFamily: 'monospace' }} aria-label="Settlement file" />
        <p className="muted small" style={{ margin: 0 }}>Columns: <strong>reference</strong> (VIBE’s) or <strong>payment_id</strong> (the partner’s), <strong>amount</strong> in rupees, and optionally <strong>status</strong>. Dates narrow which VIBE payments are expected in the file; without them, the span of the matched payments is used.</p>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <div className="row"><button className="btn primary" disabled={busy || !csv.trim()} onClick={run}>{busy ? 'Matching…' : 'Match against VIBE'}</button></div>
      </div>

      {result ? (
        <div className="stack" style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>{result.run.fileName}</strong><DownloadButton path={`/v1/admin/reconciliation/${result.run.id}.csv`} filename={`vibe-reconciliation-${result.run.id.slice(0, 8)}.csv`} label="Download differences" />
          </div>
          <div className="kpis">
            <div className="card"><span className="muted small">Lines in the file</span><strong>{result.run.partnerRows}</strong><span className="muted small">{formatINR(result.run.partnerAmount)}</span></div>
            <div className="card"><span className="muted small">Matched</span><strong>{result.run.matched}</strong></div>
            <div className="card"><span className="muted small">To look at</span><strong style={{ color: toLook(result.run) ? 'var(--warning, #b45309)' : undefined }}>{toLook(result.run)}</strong><span className="muted small">{result.run.mismatched} differ · {result.run.missingInVibe} not in VIBE · {result.run.missingAtPartner} not in the file</span></div>
            <div className="card"><span className="muted small">VIBE’s total</span><strong>{formatINR(result.run.vibeAmount)}</strong></div>
          </div>
          {toLook(result.run) === 0 ? <Notice tone="success">Everything matches.</Notice> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Result</th><th>Reference or id</th><th>Partner</th><th>VIBE</th></tr></thead>
                <tbody>
                  {result.items.map((i, n) => (
                    <tr key={`${i.key}-${n}`}>
                      <td><Badge tone={RESULT[i.result].tone}>{RESULT[i.result].label}</Badge>{i.line ? <div className="muted small">line {i.line}</div> : null}</td>
                      <td><strong>{i.key}</strong>{i.paymentReference && i.paymentReference !== i.key ? <div className="muted small">{i.paymentReference}</div> : null}</td>
                      <td>{i.partnerAmount === null ? '—' : formatINR(i.partnerAmount)}{i.partnerStatus ? <div className="muted small">{i.partnerStatus}</div> : null}</td>
                      <td>{i.vibeAmount === null ? '—' : formatINR(i.vibeAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      <h3 style={{ margin: '18px 0 8px' }}>Earlier checks</h3>
      {runs.loading && !runs.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>File</th><th>Checked</th><th>Lines</th><th>Matched</th><th>To look at</th><th /></tr></thead>
            <tbody>
              {runs.data?.map((r) => <tr key={r.id}><td><strong>{r.fileName}</strong></td><td className="small">{showDateTime(r.uploadedAt)}<div className="muted">{r.uploadedBy}</div></td><td>{r.partnerRows}</td><td>{r.matched}</td><td>{toLook(r) ? <Badge tone="warning">{toLook(r)}</Badge> : <Badge tone="success">0</Badge>}</td><td className="actions"><button className="btn ghost sm" onClick={() => open(r.id)}>Open</button></td></tr>)}
              {runs.data?.length === 0 ? <tr><td colSpan={6} className="muted">No checks yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
