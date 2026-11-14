import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge, DownloadButton, Loading, Notice, PageHead, formatINR, showDateTime, useAsync, useAuth, type CustomerPage, type MembershipSummary } from '@kit';

import { useWorkspace } from '../workspace';
import { CustomerModal } from './CustomersPage';
import { PERIODS, range, type Period } from './OverviewPage';

type Who = 'member' | 'never' | 'lapsed' | '';
const WHO: { key: Who; label: string }[] = [{ key: 'member', label: 'Members now' }, { key: 'never', label: 'Registered, not members' }, { key: 'lapsed', label: 'Membership ended' }, { key: '', label: 'Everyone registered' }];
const PAGE = 25;
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : '–');

/**
 * VIBE Membership: how many customers registered, how many hold a membership, how many never took one, and the membership fees. The fees
 * are VIBE's own income: they belong to no business, never go into a settlement, and are the same whichever category you're looking at.
 */
export function MembershipPage() {
  const { client } = useAuth();
  const { current } = useWorkspace();
  const [period, setPeriod] = useState<Period>('30d');
  const { from, to } = range(period);
  const s = useAsync(() => client.get<MembershipSummary>(`/v1/admin/membership/summary?from=${from}&to=${to}`), [client, from, to]);
  const [who, setWho] = useState<Who>('member');
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [offset, setOffset] = useState(0);
  const people = useAsync(
    () => client.get<CustomerPage>(`/v1/admin/customers?limit=${PAGE}&offset=${offset}${who ? `&membership=${who}` : ''}${term ? `&q=${encodeURIComponent(term)}` : ''}`),
    [client, who, term, offset],
  );
  const [open, setOpen] = useState<string | null>(null);
  const d = s.data;
  const periodLabel = PERIODS.find((p) => p.key === period)!.label.toLowerCase();
  const total = people.data?.total ?? 0;

  return (
    <>
      <PageHead
        title="VIBE Membership"
        sub="Who registered, who took a membership and who didn’t, and the membership fees. These fees are VIBE’s own income: they never go to a business."
        actions={<DownloadButton path={`/v1/admin/membership/summary.csv?from=${from}&to=${to}`} filename={`vibe-membership-${from}-to-${to}.csv`} label="Download Excel" />}
      />
      {current.id ? <Notice tone="info">Membership is VIBE-wide, so these numbers are the same whichever category you’re looking at.</Notice> : null}
      <div className="tabs" role="tablist" aria-label="Period">
        {PERIODS.map((p) => <button key={p.key} role="tab" aria-selected={period === p.key} className={`tab${period === p.key ? ' on' : ''}`} onClick={() => setPeriod(p.key)}>{p.label}</button>)}
      </div>
      {s.error ? <Notice tone="error">{s.error}</Notice> : null}
      {s.loading && !d ? <Loading /> : d ? (
        <div className="stack">
          <div className="kpis">
            <button type="button" className="card" style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer' }} onClick={() => { setWho(''); setOffset(0); }}>
              <span className="muted small">Registered customers</span><strong>{d.registered.toLocaleString('en-IN')}</strong><span className="muted small">{d.registeredInPeriod} new, {periodLabel}</span>
            </button>
            <button type="button" className="card" style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer' }} onClick={() => { setWho('member'); setOffset(0); }}>
              <span className="muted small">Members now</span><strong>{d.membersNow.toLocaleString('en-IN')}</strong><span className="muted small">{pct(d.membersNow, d.registered)} of registered · {d.autoRenewing} renewing, {d.cancelledStillValid} cancelled with time left</span>
            </button>
            <button type="button" className="card" style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer' }} onClick={() => { setWho('never'); setOffset(0); }}>
              <span className="muted small">Registered, never a member</span><strong>{d.neverJoined.toLocaleString('en-IN')}</strong><span className="muted small">{pct(d.neverJoined, d.registered)} of registered</span>
            </button>
            <button type="button" className="card" style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer' }} onClick={() => { setWho('lapsed'); setOffset(0); }}>
              <span className="muted small">Membership ended</span><strong>{d.lapsed.toLocaleString('en-IN')}</strong><span className="muted small">Were members, didn’t renew</span>
            </button>
          </div>

          <div className="card stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>Membership fees: VIBE’s income</h2>
              <Badge tone="pink">Not paid to any business</Badge>
            </div>
            <div className="kpis">
              <div><span className="muted small">Collected, {periodLabel}</span><strong style={{ display: 'block', fontSize: 22 }}>{formatINR(d.feesInPeriod)}</strong><span className="muted small">{d.paymentsInPeriod} payments</span></div>
              <div><span className="muted small">Collected, all time</span><strong style={{ display: 'block', fontSize: 22 }}>{formatINR(d.feesAllTime)}</strong></div>
              <div><span className="muted small">Joined, {periodLabel}</span><strong style={{ display: 'block', fontSize: 22 }}>{d.joined}</strong><span className="muted small">{d.renewed} renewed · {d.granted} given free</span></div>
              <div><span className="muted small">Members saved, {periodLabel}</span><strong style={{ display: 'block', fontSize: 22 }}>{formatINR(d.savedInPeriod)}</strong></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Plan</th><th>Price</th><th>Members now</th><th>Paid, {periodLabel}</th><th>Fees, {periodLabel}</th></tr></thead>
                <tbody>
                  {d.plans.map((p) => (
                    <tr key={p.name} className={p.onSale ? '' : 'dim'}>
                      <td><strong>{p.name}</strong>{p.onSale ? null : <div className="muted small">Not on sale</div>}</td>
                      <td>{formatINR(p.price)} / {p.period === 'year' ? 'year' : 'month'}</td>
                      <td>{p.membersNow}</td>
                      <td>{p.paidInPeriod}</td>
                      <td><strong>{formatINR(p.feesInPeriod)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small" style={{ margin: 0 }}>Each membership payment is booked to VIBE’s membership income in the accounts. Plans and prices are set under <Link to="/plans">Membership plans</Link> (in All of VIBE).</p>
          </div>

          <div className="card stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>The people</h2>
              <DownloadButton small path={`/v1/admin/exports/customers?x=1${who ? `&membership=${who}` : ''}${term ? `&q=${encodeURIComponent(term)}` : ''}`} filename={`vibe-customers-${who || 'all'}.csv`} label="Download Excel" />
            </div>
            <div className="tabs" role="tablist" aria-label="Who">
              {WHO.map((w) => <button key={w.label} role="tab" aria-selected={who === w.key} className={`tab${who === w.key ? ' on' : ''}`} onClick={() => { setWho(w.key); setOffset(0); }}>{w.label}</button>)}
            </div>
            <form className="row" onSubmit={(e) => { e.preventDefault(); setOffset(0); setTerm(q.trim()); }}>
              <input style={{ maxWidth: 300 }} placeholder="Name, VIBE ID or phone digits" aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
              <button className="btn">Search</button>
              {term ? <button type="button" className="btn ghost" onClick={() => { setQ(''); setTerm(''); setOffset(0); }}>Clear</button> : null}
            </form>
            {people.error ? <Notice tone="error">{people.error}</Notice> : null}
            {people.loading && !people.data ? <Loading /> : (
              <>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Customer</th><th>Area</th><th>Registered</th><th>Member</th><th>Paid through VIBE</th><th /></tr></thead>
                    <tbody>
                      {people.data?.items.map((c) => (
                        <tr key={c.id}>
                          <td><strong>{c.name}</strong><div className="muted small">VIBE ID {c.vibeId} · {c.phoneMasked}</div></td>
                          <td>{c.area ?? '—'}</td>
                          <td className="small">{showDateTime(c.joinedAt)}</td>
                          <td>{c.member ? <Badge tone="success">Member</Badge> : <Badge>Not a member</Badge>}</td>
                          <td>{formatINR(c.totalPaid)}</td>
                          <td className="actions"><button className="btn ghost sm" onClick={() => setOpen(c.id)}>Open</button></td>
                        </tr>
                      ))}
                      {people.data && people.data.items.length === 0 ? <tr><td colSpan={6} className="muted">Nobody here.</td></tr> : null}
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
          </div>
        </div>
      ) : null}
      {open ? <CustomerModal id={open} onClose={() => setOpen(null)} onChanged={() => { people.reload(); s.reload(); }} /> : null}
    </>
  );
}
