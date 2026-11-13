import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge, DownloadButton, Loading, Notice, PageHead, formatINR, showDateTime, useAsync, useAuth, type KycStatus, type MerchantPage, type MerchantRow } from '@kit';

import { useWorkspace } from '../workspace';

const PAGE = 50;
const KYC_TABS: { key: KycStatus | ''; label: string }[] = [
  { key: '', label: 'All' }, { key: 'submitted', label: 'KYC to check' }, { key: 'not_submitted', label: 'No KYC yet' }, { key: 'rejected', label: 'KYC sent back' }, { key: 'verified', label: 'Verified' },
];

export function KycBadge({ status }: { status: KycStatus | '' }) {
  if (status === 'verified') return <Badge tone="success">Verified</Badge>;
  if (status === 'submitted') return <Badge tone="warning">To check</Badge>;
  if (status === 'rejected') return <Badge tone="warning">Sent back</Badge>;
  return <Badge>Not sent</Badge>;
}

export function AgreementBadge({ m }: { m: MerchantRow }) {
  if (m.currentAgreement === null) return <span className="muted small">None published</span>;
  if (m.agreementVersion === m.currentAgreement) return <Badge tone="success">v{m.agreementVersion} accepted</Badge>;
  return <Badge tone="warning">{m.agreementVersion ? `Only v${m.agreementVersion}` : 'Not accepted'}</Badge>;
}

/**
 * Every business in the category being looked at, with the things that decide whether VIBE can pay it: KYC and bank, the merchant agreement,
 * and what VIBE owes it. Open a business for everything about it in one place.
 */
export function MerchantsPage() {
  const { client } = useAuth();
  const { current } = useWorkspace();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [kyc, setKyc] = useState<KycStatus | ''>('');
  const [missing, setMissing] = useState(false);
  const [live, setLive] = useState<'' | 'true' | 'false'>('');
  const [offset, setOffset] = useState(0);
  const params = new URLSearchParams();
  if (term) params.set('q', term);
  if (kyc) params.set('kyc', kyc);
  if (missing) params.set('agreement', 'missing');
  if (live) params.set('live', live);
  const qs = params.toString();
  const list = useAsync(() => client.get<MerchantPage>(`/v1/admin/merchants?limit=${PAGE}&offset=${offset}${qs ? `&${qs}` : ''}`), [client, qs, offset]);
  const total = list.data?.total ?? 0;
  const reset = () => setOffset(0);

  return (
    <>
      <PageHead
        title="Merchants"
        sub={`Every business${current.id ? ` in ${current.name}` : ''}: KYC and bank, agreement, and what VIBE owes them.`}
        actions={<><DownloadButton path={`/v1/admin/merchants.csv${qs ? `?${qs}` : ''}`} filename="vibe-merchants.csv" label="Download Excel" /><Link className="btn primary" to="/businesses/new" style={{ textDecoration: 'none' }}>Add business</Link></>}
      />
      <div className="tabs" role="tablist" aria-label="KYC and bank">
        {KYC_TABS.map((t) => <button key={t.label} role="tab" aria-selected={kyc === t.key} className={`tab${kyc === t.key ? ' on' : ''}`} onClick={() => { setKyc(t.key); reset(); }}>{t.label}</button>)}
      </div>
      <form className="row" style={{ marginBottom: 14 }} onSubmit={(e) => { e.preventDefault(); reset(); setTerm(q.trim()); }}>
        <input style={{ maxWidth: 280 }} placeholder="Search name or area" aria-label="Search merchants" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn">Search</button>
        <select aria-label="Listing" style={{ maxWidth: 160 }} value={live} onChange={(e) => { setLive(e.target.value as typeof live); reset(); }}>
          <option value="">Live and hidden</option><option value="true">Live only</option><option value="false">Hidden only</option>
        </select>
        <label className="check"><input type="checkbox" checked={missing} onChange={(e) => { setMissing(e.target.checked); reset(); }} /> Agreement not accepted</label>
        {term || kyc || missing || live ? <button type="button" className="btn ghost" onClick={() => { setQ(''); setTerm(''); setKyc(''); setMissing(false); setLive(''); reset(); }}>Clear</button> : null}
      </form>
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Business</th><th>KYC and bank</th><th>Agreement</th><th>Sales, 30 days</th><th>VIBE owes them</th><th>Last sale</th><th /></tr></thead>
              <tbody>
                {list.data?.rows.map((m) => (
                  <tr key={m.id} className={m.live ? '' : 'dim'}>
                    <td><Link to={`/merchants/${m.id}`}><strong>{m.name}</strong></Link><div className="muted small">{m.category} · {m.area}{m.live ? '' : ' · hidden'}</div></td>
                    <td><KycBadge status={m.kycStatus} /></td>
                    <td><AgreementBadge m={m} /></td>
                    <td>{formatINR(m.sales30d)}</td>
                    <td><strong>{formatINR(m.owed)}</strong></td>
                    <td className="small">{m.lastSaleAt ? showDateTime(m.lastSaleAt) : '—'}</td>
                    <td className="actions"><Link className="btn ghost sm" to={`/merchants/${m.id}`} style={{ textDecoration: 'none' }}>Open</Link></td>
                  </tr>
                ))}
                {list.data && list.data.rows.length === 0 ? <tr><td colSpan={7} className="muted">No businesses match.</td></tr> : null}
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
