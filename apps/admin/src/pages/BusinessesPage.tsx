import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge, Loading, Notice, PageHead, useAsync, useAuth, type BusinessList } from '@kit';

const PAGE = 25;

export function BusinessesPage() {
  const { client } = useAuth();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [offset, setOffset] = useState(0);
  const list = useAsync(() => client.get<BusinessList>(`/v1/admin/businesses?limit=${PAGE}&offset=${offset}${term ? `&q=${encodeURIComponent(term)}` : ''}`), [client, term, offset]);
  const total = list.data?.total ?? 0;

  return (
    <>
      <PageHead title="Businesses" sub="Every place listed in the customer app." actions={<Link className="btn primary" to="/businesses/new" style={{ textDecoration: 'none' }}>Add business</Link>} />
      <form className="row" style={{ marginBottom: 14 }} onSubmit={(e) => { e.preventDefault(); setOffset(0); setTerm(q.trim()); }}>
        <input style={{ maxWidth: 320 }} placeholder="Search by name" aria-label="Search businesses" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn">Search</button>
        {term ? <button type="button" className="btn ghost" onClick={() => { setQ(''); setTerm(''); setOffset(0); }}>Clear</button> : null}
      </form>
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Category</th><th>Area</th><th>Status</th><th>Merchant logins</th><th /></tr></thead>
              <tbody>
                {list.data?.items.map((b) => (
                  <tr key={b.id} className={b.active ? '' : 'dim'}>
                    <td><strong>{b.name}</strong></td>
                    <td>{b.categoryName}</td>
                    <td>{b.area}</td>
                    <td className="row">{b.active ? <Badge tone="success">Live</Badge> : <Badge>Hidden</Badge>}{b.verified ? <Badge tone="pink">Verified</Badge> : null}</td>
                    <td>{b.merchantAccounts}</td>
                    <td className="actions"><Link className="btn ghost sm" to={`/businesses/${b.id}`} style={{ textDecoration: 'none' }}>Edit</Link></td>
                  </tr>
                ))}
                {list.data && list.data.items.length === 0 ? <tr><td colSpan={6} className="muted">{term ? 'No businesses match that search.' : 'No businesses yet.'}</td></tr> : null}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="muted small">{total === 0 ? '' : `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total}`}</span>
            <div className="row">
              <button className="btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
              <button className="btn sm" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
