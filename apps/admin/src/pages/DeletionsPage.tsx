import { useState } from 'react';

import { Badge, Loading, Notice, PageHead, errorText, showDateTime, useAsync, useAuth, type DeletionRow } from '@kit';

export function DeletionsPage() {
  const { client } = useAuth();
  const [tab, setTab] = useState<'pending' | 'done'>('pending');
  const list = useAsync(() => client.get<DeletionRow[]>(`/v1/admin/deletion-requests?status=${tab}`), [client, tab]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const complete = async (r: DeletionRow) => {
    if (!window.confirm(`Mark ${r.name}’s deletion request as done? Do this only after their personal data has been erased.`)) return;
    setError(null);
    try {
      await client.post(`/v1/admin/deletion-requests/${r.id}/complete`);
      setNotice('Marked as done.');
      list.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <>
      <PageHead title="Deletion requests" sub="Customers who asked for their account to be deleted. Under India’s data protection law these need to be handled." />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'pending'} className={`tab${tab === 'pending' ? ' on' : ''}`} onClick={() => setTab('pending')}>Waiting</button>
        <button role="tab" aria-selected={tab === 'done'} className={`tab${tab === 'done' ? ' on' : ''}`} onClick={() => setTab('done')}>Done</button>
      </div>
      <Notice tone="info">Erasing the data is a manual step for now, and how long payment records must be kept is a legal question. Mark a request done only once that has been handled.</Notice>
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead><tr><th>Customer</th><th>Requested</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.data?.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong><div className="muted small">VIBE ID {r.vibeId}</div></td>
                  <td className="small">{showDateTime(r.requestedAt)}</td>
                  <td><Badge tone={r.status === 'done' ? 'success' : 'warning'}>{r.status === 'done' ? 'Done' : 'Waiting'}</Badge></td>
                  <td className="actions">{r.status === 'pending' ? <button className="btn primary sm" onClick={() => complete(r)}>Mark done</button> : null}</td>
                </tr>
              ))}
              {list.data?.length === 0 ? <tr><td colSpan={4} className="muted">None.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
