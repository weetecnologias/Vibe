import { useEffect, useState } from 'react';

import { Badge, Field, Loading, Notice, PageHead, errorText, useAsync, useAuth, type KycInput, type KycView } from '@kit';

type Form = Omit<KycInput, 'documents'> & { documents: string };

const STATUS: Record<string, { label: string; tone: 'success' | 'warning' | 'muted' }> = {
  verified: { label: 'Verified', tone: 'success' }, submitted: { label: 'Waiting for VIBE', tone: 'warning' }, rejected: { label: 'Needs changes', tone: 'warning' }, not_submitted: { label: 'Not sent yet', tone: 'muted' },
};

/**
 * Who the business legally is, and the bank account VIBE pays settlements into. The owner sends these once; VIBE checks and verifies them. Until then
 * payments are collected and counted but not paid out. Changing any detail later sends it back for verification.
 */
export function KycPage() {
  const { client } = useAuth();
  const k = useAsync(() => client.get<KycView>('/v1/merchant/kyc'), [client]);
  const [f, setF] = useState<Form>({ legalName: '', pan: '', gstin: '', fssai: '', bankAccountName: '', bankAccountNo: '', bankIfsc: '', bankName: '', documents: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const v = k.data;

  useEffect(() => {
    if (v) setF({ legalName: v.legalName, pan: v.pan, gstin: v.gstin ?? '', fssai: v.fssai ?? '', bankAccountName: v.bankAccountName, bankAccountNo: '', bankIfsc: v.bankIfsc, bankName: v.bankName ?? '', documents: v.documents.join('\n') });
  }, [v]);

  const set = (key: keyof typeof f, value: string) => setF({ ...f, [key]: value });
  const ready = f.legalName.trim() && f.pan.trim() && f.bankAccountName.trim() && f.bankAccountNo.trim() && f.bankIfsc.trim();

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const body: KycInput = { ...f, gstin: f.gstin?.trim() || undefined, fssai: f.fssai?.trim() || undefined, bankName: f.bankName?.trim() || undefined, documents: f.documents.split('\n').map((l) => l.trim()).filter(Boolean) };
      const saved = await client.put<KycView>('/v1/merchant/kyc', body);
      setNotice('Sent to VIBE. You’ll get an alert when it’s verified.');
      k.setData(() => saved);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const st = STATUS[v?.status ?? 'not_submitted'];
  return (
    <>
      <PageHead title="Bank and KYC" sub="Your legal and bank details. VIBE pays your settlements into this account once they’re verified." />
      {k.error ? <Notice tone="error">{k.error}</Notice> : null}
      {k.loading && !v ? <Loading /> : v ? (
        <div className="stack">
          <div className="row"><Badge tone={st.tone}>{st.label}</Badge>{v.submittedAt ? <span className="muted small">Last sent {new Date(v.submittedAt).toLocaleDateString('en-IN')}</span> : null}</div>
          {v.status === 'rejected' && v.reviewNote ? <Notice tone="error">VIBE asks: {v.reviewNote}</Notice> : null}
          {v.status === 'verified' ? <Notice tone="success">Verified. Settlements are paid to the account ending {v.bankAccountNo.slice(-4)}. Changing any detail sends it back for verification and pauses payouts until it’s checked again.</Notice> : null}
          {notice ? <Notice tone="success">{notice}</Notice> : null}
          <div className="card stack">
            <h3 style={{ margin: 0 }}>Who you are</h3>
            <div className="grid2">
              <Field label="Legal name" hint="As on your PAN or GST certificate."><input value={f.legalName} maxLength={150} onChange={(e) => set('legalName', e.target.value)} /></Field>
              <Field label="PAN"><input value={f.pan} maxLength={10} onChange={(e) => set('pan', e.target.value.toUpperCase())} placeholder="ABCDE1234F" /></Field>
            </div>
            <div className="grid2">
              <Field label="GSTIN (if registered)" hint="15 characters. The PAN inside must match your PAN."><input value={f.gstin} maxLength={15} onChange={(e) => set('gstin', e.target.value.toUpperCase())} placeholder="36ABCDE1234F1Z5" /></Field>
              <Field label={v.fssaiRequired ? 'FSSAI licence number (required)' : 'FSSAI licence number'} hint="14 digits."><input value={f.fssai} maxLength={14} inputMode="numeric" onChange={(e) => set('fssai', e.target.value)} /></Field>
            </div>
          </div>
          <div className="card stack">
            <h3 style={{ margin: 0 }}>Where VIBE pays you</h3>
            <div className="grid2">
              <Field label="Name on the bank account" hint="Should match your legal name."><input value={f.bankAccountName} maxLength={150} onChange={(e) => set('bankAccountName', e.target.value)} /></Field>
              <Field label="Account number" hint={v.bankAccountNo ? `Saved: ${v.bankAccountNo}. Type it again to change or resubmit.` : '9 to 18 digits.'}><input value={f.bankAccountNo} maxLength={18} inputMode="numeric" onChange={(e) => set('bankAccountNo', e.target.value)} autoComplete="off" /></Field>
            </div>
            <div className="grid2">
              <Field label="IFSC"><input value={f.bankIfsc} maxLength={11} onChange={(e) => set('bankIfsc', e.target.value.toUpperCase())} placeholder="HDFC0001234" /></Field>
              <Field label="Bank name (optional)"><input value={f.bankName} maxLength={100} onChange={(e) => set('bankName', e.target.value)} /></Field>
            </div>
            <Field label="Document links (optional)" hint="One link per line: PAN card, GST certificate, a cancelled cheque."><textarea rows={3} value={f.documents} onChange={(e) => set('documents', e.target.value)} /></Field>
          </div>
          {v.checks.some((c) => !c.ok) ? <div className="card stack" style={{ gap: 4 }}><strong>VIBE’s automatic checks</strong>{v.checks.filter((c) => !c.ok).map((c) => <div key={c.key} className="small"><Badge tone="warning">Fix</Badge> <strong>{c.label}</strong>: {c.message}</div>)}</div> : null}
          {error ? <Notice tone="error">{error}</Notice> : null}
          <div className="row"><button className="btn primary" disabled={busy || !ready} onClick={save}>{busy ? 'Sending…' : v.status === 'not_submitted' ? 'Send to VIBE' : 'Save and send again'}</button></div>
        </div>
      ) : null}
    </>
  );
}
