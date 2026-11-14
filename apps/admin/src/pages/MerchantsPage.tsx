import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import {
  Badge, DownloadButton, Loading, Notice, PageHead, formatINR, showDateTime, useAsync, useAuth, type KycStatus, type MerchantCategories, type MerchantCategory, type MerchantPage, type MerchantRow,
} from '@kit';

import { useWorkspace } from '../workspace';

const PAGE = 50;
const KYC_TABS: { key: KycStatus | ''; label: string }[] = [
  { key: '', label: 'All' }, { key: 'verified', label: 'KYC and bank verified' }, { key: 'submitted', label: 'Sent, to check' }, { key: 'rejected', label: 'Sent back' }, { key: 'not_submitted', label: 'Not sent yet' },
];

export function KycBadge({ status }: { status: KycStatus | '' }) {
  if (status === 'verified') return <Badge tone="success">Verified</Badge>;
  if (status === 'submitted') return <Badge tone="warning">Sent, to check</Badge>;
  if (status === 'rejected') return <Badge tone="warning">Sent back</Badge>;
  return <Badge>Not sent</Badge>;
}

export function AgreementBadge({ m }: { m: MerchantRow }) {
  if (m.currentAgreement === null) return <span className="muted small">None published</span>;
  if (m.agreementVersion === m.currentAgreement) return <Badge tone="success">v{m.agreementVersion} accepted</Badge>;
  return <Badge tone="warning">{m.agreementVersion ? `Only v${m.agreementVersion}` : 'Not accepted'}</Badge>;
}

/**
 * Merchants, category by category. It opens on the categories (Movies, Food & Dining, Sports, Events...) with how many businesses each has,
 * how many have verified KYC and bank details, and the money: received through VIBE, paid out, waiting for the bank transfer, still owed.
 * Open a category for its merchants; open a merchant for everything about it, including each payment and whether it's been settled.
 */
export function MerchantsPage() {
  const [params, setParams] = useSearchParams();
  const category = params.get('category');
  const name = params.get('name') ?? '';
  return category
    ? <MerchantList category={category === 'all' ? null : category} name={category === 'all' ? 'All merchants' : name} onBack={() => setParams({})} onCategory={(id, n) => setParams({ category: id, name: n })} />
    : <ByCategory onOpen={(id, n) => setParams({ category: id, name: n })} />;
}

function ByCategory({ onOpen }: { onOpen: (id: string, name: string) => void }) {
  const { client } = useAuth();
  const { current } = useWorkspace();
  const c = useAsync(() => client.get<MerchantCategories>('/v1/admin/merchants/categories'), [client]);
  const d = c.data;
  const row = (r: MerchantCategory, total = false) => (
    <tr key={r.id} style={total ? { fontWeight: 700 } : { cursor: 'pointer' }} onClick={total ? undefined : () => onOpen(r.id, r.name)}>
      <td>{total ? r.name : <button type="button" className="link-btn" onClick={() => onOpen(r.id, r.name)}><strong>{r.name}</strong></button>}<div className="muted small" style={{ fontWeight: 400 }}>{r.live} live of {r.merchants}</div></td>
      <td><strong>{r.merchants}</strong></td>
      <td>{r.kycVerified ? <Badge tone="success">{r.kycVerified} verified</Badge> : <span className="muted">0 verified</span>}</td>
      <td>{r.kycToCheck ? <Badge tone="warning">{r.kycToCheck} to check</Badge> : null}{r.kycSentBack ? <> <Badge tone="warning">{r.kycSentBack} sent back</Badge></> : null}{r.kycNotSent ? <> <Badge>{r.kycNotSent} not sent</Badge></> : null}{!r.kycToCheck && !r.kycSentBack && !r.kycNotSent ? <span className="muted small">—</span> : null}</td>
      <td>{formatINR(r.received)}</td>
      <td>{formatINR(r.paidOut)}</td>
      <td>{r.awaitingPayout ? formatINR(r.awaitingPayout) : '—'}</td>
      <td><strong>{formatINR(r.owed)}</strong></td>
    </tr>
  );
  return (
    <>
      <PageHead
        title="Merchants"
        sub={`Every business${current.id ? ` in ${current.name}` : ''}, by category: KYC and bank details, and what VIBE has received, paid out and still owes. Open a category to see its merchants.`}
        actions={<><DownloadButton path="/v1/admin/merchants/categories.csv" filename="vibe-merchants-by-category.csv" label="Download Excel" /><button className="btn" onClick={() => onOpen('all', 'All merchants')}>All merchants</button><Link className="btn primary" to="/businesses/new" style={{ textDecoration: 'none' }}>Add business</Link></>}
      />
      {c.error ? <Notice tone="error">{c.error}</Notice> : null}
      {c.loading && !d ? <Loading /> : d ? (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th style={{ minWidth: 170 }}>Category</th><th>Merchants</th><th>KYC + bank verified</th><th>Not verified</th><th>Received</th><th>Paid out</th><th>Awaiting transfer</th><th>VIBE owes</th></tr></thead>
              <tbody>
                {d.rows.map((r) => row(r))}
                {d.rows.length > 1 ? row(d.total, true) : null}
              </tbody>
            </table>
          </div>
          <p className="muted small">A business can only be paid out once its KYC and bank details are verified. Received is everything customers paid that business through VIBE; owed now is its share not yet paid out.</p>
        </>
      ) : null}
    </>
  );
}

function MerchantList({ category, name, onBack, onCategory }: { category: string | null; name: string; onBack: () => void; onCategory: (id: string, name: string) => void }) {
  const { client } = useAuth();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [kyc, setKyc] = useState<KycStatus | ''>('');
  const [missing, setMissing] = useState(false);
  const [owedOnly, setOwedOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const subs = useAsync(() => (category ? client.get<MerchantCategories>(`/v1/admin/merchants/categories?parent=${category}`) : Promise.resolve(null)), [client, category]);
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (term) params.set('q', term);
  if (kyc) params.set('kyc', kyc);
  if (missing) params.set('agreement', 'missing');
  const qs = params.toString();
  const list = useAsync(() => client.get<MerchantPage>(`/v1/admin/merchants?limit=${PAGE}&offset=${offset}${qs ? `&${qs}` : ''}`), [client, qs, offset]);
  const total = list.data?.total ?? 0;
  const rows = (list.data?.rows ?? []).filter((m) => !owedOnly || m.owed !== 0);
  const reset = () => setOffset(0);
  const sum = subs.data?.total;
  const childRows = (subs.data?.rows ?? []).filter((r) => r.id !== category);

  return (
    <>
      <p className="small" style={{ margin: '0 0 8px' }}><button type="button" className="link-btn" onClick={onBack}>← Merchants by category</button></p>
      <PageHead
        title={name}
        sub={sum ? `${sum.merchants} businesses · ${sum.kycVerified} with KYC and bank verified · received ${formatINR(sum.received)} · paid out ${formatINR(sum.paidOut)} · VIBE owes ${formatINR(sum.owed)}` : 'Every business, with its KYC and bank details and money.'}
        actions={<><DownloadButton path={`/v1/admin/merchants.csv${qs ? `?${qs}` : ''}`} filename={`vibe-merchants-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`} label="Download Excel" /><Link className="btn primary" to="/businesses/new" style={{ textDecoration: 'none' }}>Add business</Link></>}
      />
      {childRows.length > 0 ? (
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="muted small">Inside {name}:</span>
          {childRows.map((r) => <button key={r.id} type="button" className="btn sm" onClick={() => onCategory(r.id, r.name)}>{r.name} · {r.merchants}</button>)}
        </div>
      ) : null}
      <div className="tabs" role="tablist" aria-label="KYC and bank">
        {KYC_TABS.map((t) => <button key={t.label} role="tab" aria-selected={kyc === t.key} className={`tab${kyc === t.key ? ' on' : ''}`} onClick={() => { setKyc(t.key); reset(); }}>{t.label}</button>)}
      </div>
      <form className="row" style={{ marginBottom: 14 }} onSubmit={(e) => { e.preventDefault(); reset(); setTerm(q.trim()); }}>
        <input style={{ maxWidth: 280 }} placeholder="Search name or area" aria-label="Search merchants" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn">Search</button>
        <label className="check"><input type="checkbox" checked={owedOnly} onChange={(e) => setOwedOnly(e.target.checked)} /> VIBE owes them money</label>
        <label className="check"><input type="checkbox" checked={missing} onChange={(e) => { setMissing(e.target.checked); reset(); }} /> Agreement not accepted</label>
        {term || kyc || missing || owedOnly ? <button type="button" className="btn ghost" onClick={() => { setQ(''); setTerm(''); setKyc(''); setMissing(false); setOwedOnly(false); reset(); }}>Clear</button> : null}
      </form>
      {list.error ? <Notice tone="error">{list.error}</Notice> : null}
      {list.loading && !list.data ? <Loading /> : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th style={{ minWidth: 220 }}>Business</th><th>KYC and bank</th><th>Agreement</th><th>Received</th><th>Paid out</th><th>VIBE owes</th><th>Last sale / payout</th><th /></tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id} className={m.live ? '' : 'dim'}>
                    <td><Link to={`/merchants/${m.id}`}><strong>{m.name}</strong></Link><div className="muted small">{category || m.topCategory === m.category ? m.category : `${m.topCategory} › ${m.category}`} · {m.area}{m.live ? '' : ' · hidden'}</div></td>
                    <td><KycBadge status={m.kycStatus} /></td>
                    <td><AgreementBadge m={m} /></td>
                    <td>{formatINR(m.received)}<div className="muted small">{formatINR(m.sales30d)} in 30 days</div></td>
                    <td>{formatINR(m.paidOut)}</td>
                    <td><strong>{formatINR(m.owed)}</strong>{m.awaitingPayout ? <div className="muted small">{formatINR(m.awaitingPayout)} waiting for bank transfer</div> : m.owed > 0 && m.kycStatus !== 'verified' ? <div className="muted small">Held: KYC not verified</div> : null}</td>
                    <td className="small">{m.lastSaleAt ? showDateTime(m.lastSaleAt) : 'No sales'}<div className="muted">{m.lastPaidAt ? `Paid ${showDateTime(m.lastPaidAt)}` : 'Never paid out'}</div></td>
                    <td className="actions"><Link className="btn ghost sm" to={`/merchants/${m.id}`} style={{ textDecoration: 'none' }}>Open</Link></td>
                  </tr>
                ))}
                {list.data && rows.length === 0 ? <tr><td colSpan={8} className="muted">No businesses match.</td></tr> : null}
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
