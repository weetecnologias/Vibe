import { useState } from 'react';

import { Notice, errorText, useAuth, type AgreementStatus } from '@kit';

/**
 * Shown instead of the dashboard until the owner accepts VIBE's current merchant agreement (on first sign-in, and again when VIBE publishes a new
 * version). Everyone else on the team is asked to get the owner to do it. Acceptance is kept with who, when and from where.
 */
export function AgreementPage({ status, owner, onAccepted }: { status: AgreementStatus; owner: boolean; onAccepted: () => void }) {
  const { client, signOut } = useAuth();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const v = status.current;
  if (!v) return null;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try { await client.post('/v1/merchant/agreement/accept'); onAccepted(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="login" style={{ alignItems: 'start', paddingTop: 32 }}>
      <div className="card" style={{ width: 'min(760px, 100%)', display: 'grid', gap: 14 }}>
        <div className="brand"><span className="brand-vibe">VIBE</span> <span>for Business</span></div>
        <h1 style={{ margin: 0 }}>{v.title} · version {v.version}</h1>
        <p className="muted" style={{ margin: 0 }}>{owner ? 'Please read and accept this to keep using your VIBE dashboard.' : 'The business owner needs to accept VIBE’s merchant agreement before the dashboard works. Ask them to sign in and accept it.'}</p>
        <div className="card" style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto', background: 'var(--soft-white, #f8f6f9)' }} tabIndex={0} aria-label="The agreement">{v.body}</div>
        {owner ? (
          <>
            <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I have read the agreement and accept it on behalf of the business.</label>
            {error ? <Notice tone="error">{error}</Notice> : null}
            <button className="btn primary" disabled={!agree || busy} onClick={accept}>{busy ? 'Saving…' : 'Accept and continue'}</button>
          </>
        ) : null}
        <button className="btn ghost" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
