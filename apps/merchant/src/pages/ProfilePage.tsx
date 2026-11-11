import { useEffect, useState } from 'react';

import { Badge, Loading, Notice, PageHead, ProfileFields, emptyDraft, errorText, fromDraft, toDraft, useAsync, useAuth, type Editable, type ProfileDraft } from '@kit';

export function ProfilePage() {
  const { client } = useAuth();
  const biz = useAsync(() => client.get<Editable>('/v1/merchant/business'), [client]);
  const [draft, setDraft] = useState<ProfileDraft>(emptyDraft);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (biz.data && loadedFor !== biz.data.id) {
      setLoadedFor(biz.data.id);
      setDraft(toDraft(biz.data));
    }
  }, [biz.data, loadedFor]);

  const save = async () => {
    setError(null);
    setSaved(false);
    const parsed = fromDraft(draft);
    if (!parsed.ok) return setError(parsed.error);
    setBusy(true);
    try {
      await client.put('/v1/merchant/business', parsed.profile);
      setSaved(true);
      biz.reload();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (biz.loading && !biz.data) return <Loading />;
  if (biz.error && !biz.data) return <Notice tone="error">{biz.error}</Notice>;
  const b = biz.data!;

  return (
    <>
      <PageHead title={b.name} sub="This is what customers see on your page in the VIBE app." />
      <div className="row" style={{ marginBottom: 14 }}>
        {b.active ? <Badge tone="success">Live in the app</Badge> : <Badge tone="warning">Hidden from customers</Badge>}
        {b.verified ? <Badge tone="pink">Verified by VIBE</Badge> : <Badge>Not verified yet</Badge>}
        <span className="muted small">Categories, verification and visibility are managed by the VIBE team.</span>
      </div>
      <div className="card stack">
        <ProfileFields draft={draft} onChange={setDraft} />
        {error ? <Notice tone="error">{error}</Notice> : null}
        {saved ? <Notice tone="success">Saved. Customers see the changes the next time the app loads.</Notice> : null}
        <div className="row"><button className="btn primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button></div>
      </div>
    </>
  );
}
