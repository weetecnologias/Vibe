import { Loading, Notice, PageHead, useAsync, useAuth, type AuditEntry } from '@kit';

const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });

export function AuditPage() {
  const { client } = useAuth();
  const list = useAsync(() => client.get<AuditEntry[]>('/v1/admin/audit?limit=100'), [client]);
  return (
    <>
      <PageHead title="Audit log" sub="Who changed what, newest first. Times are India time." actions={<button className="btn" onClick={list.reload}>Refresh</button>} />
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>What</th><th>Detail</th></tr></thead>
            <tbody>
              {list.data?.map((a) => (
                <tr key={a.id}>
                  <td className="small">{when(a.at)}</td>
                  <td className="small">{a.actorRole.toLowerCase()}</td>
                  <td>{a.action.replace('_', ' ')}</td>
                  <td>{a.entity.replace('_', ' ')}</td>
                  <td className="muted small">{a.detail}</td>
                </tr>
              ))}
              {list.data?.length === 0 ? <tr><td colSpan={5} className="muted">Nothing yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
