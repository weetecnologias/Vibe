import { useRef, useState } from 'react';

import { errorText } from './api';
import { useAuth } from './auth';

/**
 * An image link with an Upload button. Uploading sends the file to the backend (PNG, JPEG or WebP, up to 5 MB) and fills in the link it returns.
 * The link can also be pasted. Shows what the image looks like so a wrong one is obvious.
 */
export function ImageField({ label, value, onChange, hint }: { label: string; value: string; onChange: (url: string) => void; hint?: string }) {
  const { client } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > 5 * 1024 * 1024) return setError('That image is over 5 MB. Choose a smaller one.');
    setBusy(true);
    try {
      onChange((await client.upload(file)).url);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="field">
      <span>{label}</span>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        {value ? <img src={value} alt="" className="thumb" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} onLoad={(e) => { e.currentTarget.style.visibility = 'visible'; }} /> : <div className="thumb empty" aria-hidden />}
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://… or upload" aria-label={`${label} link`} />
        <button type="button" className="btn sm" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : 'Upload'}</button>
        {value ? <button type="button" className="btn ghost sm" onClick={() => onChange('')}>Clear</button> : null}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      </div>
      {error ? <small style={{ color: 'var(--error)' }} role="alert">{error}</small> : hint ? <small className="muted">{hint}</small> : null}
    </div>
  );
}
