import { Link } from 'react-router-dom';

import { Loading, Notice, PageHead, formatINR, useAsync, useAuth, type AdminArea, type Overview } from '@kit';

import { useAccess } from '../access';

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** The first thing an admin sees: what happened, and what is waiting for them. */
export function OverviewPage() {
  const { client } = useAuth();
  const me = useAccess();
  const o = useAsync(() => client.get<Overview>('/v1/admin/overview'), [client]);
  const d = o.data;
  const max = Math.max(1, ...(d?.last14Days.map((x) => x.amount) ?? [1]));

  const waiting: { label: string; n: number; to: string; area: string; money?: number }[] = d ? [
    { label: 'Business applications to review', n: d.pendingApplications, to: '/applications', area: 'partners' },
    { label: 'Offers waiting for review', n: d.pendingOffers, to: '/offers', area: 'content' },
    { label: 'Promotions waiting for review', n: d.pendingPromotions, to: '/promotions', area: 'content' },
    { label: 'Events waiting for review', n: d.pendingEvents, to: '/events', area: 'content' },
    { label: 'Refunds to send', n: d.refundsDue, to: '/refunds', area: 'money', money: d.refundsDueAmount },
    { label: 'Account deletion requests', n: d.pendingDeletions, to: '/deletions', area: 'customers' },
  ].filter((w) => me.can(w.area as AdminArea)) : [];

  return (
    <>
      <PageHead title="Overview" sub="What is happening across VIBE, and what is waiting for you." actions={<button className="btn" onClick={o.reload}>Refresh</button>} />
      {o.error ? <Notice tone="error">{o.error}</Notice> : null}
      {o.loading && !d ? <Loading /> : d ? (
        <div className="stack">
          <div className="kpis">
            <div className="card"><span className="muted small">Collected today</span><strong>{formatINR(d.collectedToday)}</strong><span className="muted small">{d.paidToday} payments</span></div>
            <div className="card"><span className="muted small">Collected, last 7 days</span><strong>{formatINR(d.collected7d)}</strong></div>
            <div className="card"><span className="muted small">Redemptions started today</span><strong>{d.redemptionsToday}</strong></div>
            <div className="card"><span className="muted small">Customers</span><strong>{d.customers}</strong><span className="muted small">{d.newCustomers7d} new this week</span></div>
            <div className="card"><span className="muted small">Active members</span><strong>{d.activeMembers}</strong><span className="muted small">{formatINR(d.membershipRevenue30d)} in 30 days</span></div>
            <div className="card"><span className="muted small">Saved by members, 30 days</span><strong>{formatINR(d.savedByMembers30d)}</strong></div>
            <div className="card"><span className="muted small">Live businesses</span><strong>{d.liveBusinesses}</strong><span className="muted small">{d.pendingApplications} applying</span></div>
            <div className="card"><span className="muted small">Failed payments, 7 days</span><strong>{d.failed7d}</strong><span className="muted small">Not charged</span></div>
            <div className="card"><span className="muted small">Owed to partners</span><strong>{formatINR(d.unsettledGross)}</strong><span className="muted small">Before commission, not yet settled</span></div>
            <div className="card"><span className="muted small">Lapsed members</span><strong>{d.lapsedMembers}</strong><span className="muted small">Membership ended</span></div>
          </div>

          <div className="card stack">
            <h2>Collected, last 14 days</h2>
            <div className="bars" role="img" aria-label={`Daily collections for the last 14 days, up to ${formatINR(max)}`}>
              {d.last14Days.map((x) => (
                <div key={x.day} className={`bar${x.amount === 0 ? ' zero' : ''}`} style={{ height: `${Math.max(3, (x.amount / max) * 100)}%` }} title={`${dayLabel(x.day)}: ${formatINR(x.amount)} (${x.count} payments)`} />
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'space-between' }}><span className="muted small">{dayLabel(d.last14Days[0].day)}</span><span className="muted small">{dayLabel(d.last14Days[13].day)}</span></div>
          </div>

          <div className="card stack">
            <h2>Waiting for you</h2>
            <div className="attention">
              {waiting.map((w) => <Link key={w.to} to={w.to} className={w.n > 0 ? 'hot' : ''}><span>{w.label}</span><span>{w.n}{w.money ? ` · ${formatINR(w.money)}` : ''}</span></Link>)}
            </div>
          </div>

          {me.can('reports') ? (
            <div className="card stack">
              <h2>Reports and downloads</h2>
              <div className="attention">
                <Link to="/reports"><span>By category: partners, payments, failures, refunds and fees</span><span>Open</span></Link>
                {me.can('customers') ? <Link to="/reports"><span>Members: joined, active, lapsed, never joined</span><span>Open</span></Link> : null}
                {me.can('money') ? <Link to="/transactions"><span>Every transaction, with an Excel download</span><span>Open</span></Link> : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
