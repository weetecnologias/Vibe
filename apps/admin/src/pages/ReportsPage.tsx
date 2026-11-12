import { useState } from 'react';

import { DownloadButton, Loading, Notice, PageHead, formatINR, useAsync, useAuth, type CategoryReport, type CategoryReportRow, type MembersReport } from '@kit';

import { useAccess } from '../access';

type Tab = 'categories' | 'members';
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : '—');

/**
 * Reports for running VIBE: by category (partners onboarded, applications waiting, payments, failures, refunds, VIBE's fees) for every category
 * and subcategory, and members (joined, active, lapsed, never joined). Everything downloads as an Excel-ready file.
 */
export function ReportsPage() {
  const me = useAccess();
  const [tab, setTab] = useState<Tab>('categories');
  return (
    <>
      <PageHead title="Reports" sub={me.categories.length ? `For your categories: ${me.categories.map((c) => c.name).join(', ')}.` : 'Numbers by category and for members, ready to download for Excel.'} />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'categories'} className={`tab${tab === 'categories' ? ' on' : ''}`} onClick={() => setTab('categories')}>By category</button>
        {me.can('customers') ? <button role="tab" aria-selected={tab === 'members'} className={`tab${tab === 'members' ? ' on' : ''}`} onClick={() => setTab('members')}>Members</button> : null}
      </div>
      {tab === 'categories' ? <ByCategory /> : <Members />}
    </>
  );
}

function ByCategory() {
  const { client } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [depth, setDepth] = useState(2);
  const qs = `${from ? `from=${from}` : ''}${to ? `${from ? '&' : ''}to=${to}` : ''}`;
  const r = useAsync(() => client.get<CategoryReport>(`/v1/admin/reports/categories${qs ? `?${qs}` : ''}`), [client, qs]);
  const rows = (r.data?.rows ?? []).filter((x) => x.level <= depth);

  const Row = ({ x, strong }: { x: CategoryReportRow; strong?: boolean }) => (
    <tr className={x.active ? '' : 'dim'} style={strong ? { fontWeight: 700, background: 'var(--soft-white)' } : undefined}>
      <td><span className={`indent-${Math.max(1, x.level)}`}>{x.level > 1 ? '↳ ' : ''}{strong || x.level === 1 ? <strong>{x.name}</strong> : x.name}</span></td>
      <td>{x.partners}<div className="muted small">{x.livePartners} live</div></td>
      <td>{x.pendingApplications || '—'}</td>
      <td>{x.payments}</td>
      <td>{formatINR(x.collected)}</td>
      <td>{x.failed ? <span style={{ color: 'var(--warning, #b45309)' }}>{x.failed}</span> : '—'}</td>
      <td>{x.refundsDue ? <>{x.refundsDue}<div className="muted small">{formatINR(x.refundDueAmount)}</div></> : '—'}</td>
      <td>{x.refunded ? <>{x.refunded}<div className="muted small">{formatINR(x.refundedAmount)}</div></> : '—'}</td>
      <td>{formatINR(x.vibeFees)}</td>
    </tr>
  );

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="row">
          <label className="small">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="small">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <select aria-label="Levels shown" value={depth} onChange={(e) => setDepth(Number(e.target.value))} style={{ maxWidth: 200 }}>
            <option value={1}>Categories only</option><option value={2}>With subcategories</option><option value={3}>Every level</option>
          </select>
          {from || to ? <button className="btn ghost sm" onClick={() => { setFrom(''); setTo(''); }}>All time</button> : null}
        </div>
        <DownloadButton path={`/v1/admin/reports/categories.csv${qs ? `?${qs}` : ''}`} filename="vibe-report-categories.csv" />
      </div>
      {r.error ? <Notice tone="error">{r.error}</Notice> : null}
      {r.loading && !r.data ? <Loading /> : r.data ? (
        <>
          <div className="kpis">
            <div className="card"><span className="muted small">Partners</span><strong>{r.data.total.partners}</strong><span className="muted small">{r.data.total.livePartners} live · {r.data.total.pendingApplications} applying</span></div>
            <div className="card"><span className="muted small">Collected for partners</span><strong>{formatINR(r.data.total.collected)}</strong><span className="muted small">{r.data.total.payments} payments</span></div>
            <div className="card"><span className="muted small">Failed payments</span><strong>{r.data.total.failed}</strong><span className="muted small">{pct(r.data.total.failed, r.data.total.failed + r.data.total.payments)} of attempts</span></div>
            <div className="card"><span className="muted small">Refunds due</span><strong>{r.data.total.refundsDue}</strong><span className="muted small">{formatINR(r.data.total.refundDueAmount)}</span></div>
            <div className="card"><span className="muted small">VIBE fees</span><strong>{formatINR(r.data.total.vibeFees)}</strong><span className="muted small">VIBE-funded discounts {formatINR(r.data.total.vibeFunded)}</span></div>
            <div className="card"><span className="muted small">VIBE Membership sales</span><strong>{formatINR(r.data.membership.collected)}</strong><span className="muted small">{r.data.membership.payments} payments</span></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Category</th><th>Partners</th><th>Applying</th><th>Payments</th><th>Collected</th><th>Failed</th><th>Refunds due</th><th>Refunded</th><th>VIBE fees</th></tr></thead>
              <tbody>
                {rows.map((x) => <Row key={x.id} x={x} />)}
                <Row x={r.data.membership} />
                <Row x={r.data.total} strong />
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ margin: 0 }}>A business counts in its main category and every category above it. Payments are counted by when they were started; collected is what customers paid. Failed payments weren’t charged.</p>
        </>
      ) : null}
    </div>
  );
}

function Members() {
  const { client } = useAuth();
  const m = useAsync(() => client.get<MembersReport>('/v1/admin/reports/members'), [client]);
  const d = m.data;
  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: 'flex-end' }}><DownloadButton path="/v1/admin/reports/members.csv" filename="vibe-report-members.csv" /></div>
      {m.error ? <Notice tone="error">{m.error}</Notice> : null}
      {m.loading && !d ? <Loading /> : d ? (
        <>
          <div className="kpis">
            <div className="card"><span className="muted small">Customers</span><strong>{d.customers}</strong><span className="muted small">{d.newCustomers30d} new in 30 days</span></div>
            <div className="card"><span className="muted small">Members now</span><strong>{d.activeMembers}</strong><span className="muted small">{pct(d.activeMembers, d.customers)} of customers</span></div>
            <div className="card"><span className="muted small">Cancelled, still valid</span><strong>{d.cancelledStillValid}</strong><span className="muted small">Won’t renew</span></div>
            <div className="card"><span className="muted small">Lapsed</span><strong>{d.lapsed}</strong><span className="muted small">Membership ended</span></div>
            <div className="card"><span className="muted small">Never joined</span><strong>{d.neverJoined}</strong><span className="muted small">{pct(d.neverJoined, d.customers)} of customers</span></div>
            <div className="card"><span className="muted small">Joined or renewed, 30 days</span><strong>{d.joined30d}</strong><span className="muted small">{formatINR(d.revenue30d)} revenue</span></div>
            <div className="card"><span className="muted small">Saved by members, 30 days</span><strong>{formatINR(d.savedByMembers30d)}</strong></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Plan</th><th>Members now</th><th>Joined or renewed, 30 days</th><th>Revenue, 30 days</th></tr></thead>
              <tbody>
                {d.plans.map((p) => <tr key={p.plan}><td><strong>{p.plan}</strong></td><td>{p.active}</td><td>{p.joined30d}</td><td>{formatINR(p.revenue30d)}</td></tr>)}
                {d.plans.length === 0 ? <tr><td colSpan={4} className="muted">No plans yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
