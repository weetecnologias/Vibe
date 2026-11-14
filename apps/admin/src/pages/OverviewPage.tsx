import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Badge, DownloadButton, Loading, Notice, PageHead, formatINR, useAsync, useAuth, type CategoryCard, type Overview, type WorkspaceOverview } from '@kit';

import { useAccess } from '../access';
import { useWorkspace } from '../workspace';

const KIND: Record<string, string> = { redemption: 'bills', tickets: 'event tickets', movie: 'movie tickets', slots: 'bookings', pass: 'memberships', membership: 'VIBE memberships' };
export type Period = 'today' | '7d' | '30d' | 'month';
export const PERIODS: { key: Period; label: string }[] = [{ key: 'today', label: 'Today' }, { key: '7d', label: 'Last 7 days' }, { key: '30d', label: 'Last 30 days' }, { key: 'month', label: 'This month' }];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function range(p: Period): { from: string; to: string } {
  const now = new Date();
  const to = ymd(now);
  if (p === 'today') return { from: to, to };
  if (p === 'month') return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to };
  const d = new Date(now);
  d.setDate(d.getDate() - (p === '7d' ? 6 : 29));
  return { from: ymd(d), to };
}

/** "1,240 bills · 30 bookings" */
export function soldText(c: CategoryCard): string {
  const parts = Object.entries(c.salesByKind).filter(([, n]) => n > 0).map(([k, n]) => `${n.toLocaleString('en-IN')} ${KIND[k] ?? k}`);
  return parts.length ? parts.join(' · ') : 'No sales';
}

/**
 * The first page. In "All of VIBE": one card per category with what was sold, what VIBE still owes its businesses and what is waiting; open a
 * card to work inside that category. Inside a category the cards are its subcategories (Cafes, Restaurants...). Everything downloads to Excel.
 */
export function OverviewPage() {
  const { client } = useAuth();
  const me = useAccess();
  const { current, choose } = useWorkspace();
  const [period, setPeriod] = useState<Period>('today');
  const { from, to } = range(period);
  const o = useAsync(() => client.get<WorkspaceOverview>(`/v1/admin/workspaces/overview?from=${from}&to=${to}`), [client, from, to]);
  const vibe = useAsync(() => (current.id === null && me.full ? client.get<Overview>('/v1/admin/overview') : Promise.resolve(null)), [client, current.id]);
  const d = o.data;
  const t = d?.total;
  const periodLabel = PERIODS.find((p) => p.key === period)!.label.toLowerCase();

  return (
    <>
      <PageHead
        title={current.id ? current.name : 'All of VIBE'}
        sub={current.id ? `Only ${current.name}: its businesses, sales, settlements and approvals.` : 'Every category at a glance. Open one to work inside it.'}
        actions={<><DownloadButton path={`/v1/admin/workspaces/overview.csv?from=${from}&to=${to}`} filename={`vibe-overview-${from}-to-${to}.csv`} label="Download Excel" /><button className="btn" onClick={o.reload}>Refresh</button></>}
      />
      <div className="tabs" role="tablist" aria-label="Period">
        {PERIODS.map((p) => <button key={p.key} role="tab" aria-selected={period === p.key} className={`tab${period === p.key ? ' on' : ''}`} onClick={() => setPeriod(p.key)}>{p.label}</button>)}
      </div>
      {o.error ? <Notice tone="error">{o.error}</Notice> : null}
      {o.loading && !d ? <Loading /> : d && t ? (
        <div className="stack">
          <div className="kpis">
            <div className="card"><span className="muted small">Sales, {periodLabel}</span><strong>{t.sales.toLocaleString('en-IN')}</strong><span className="muted small">{soldText(t)}</span></div>
            <div className="card"><span className="muted small">Collected, {periodLabel}</span><strong>{formatINR(t.collected)}</strong><span className="muted small">{t.liveOutlets} live of {t.outlets} businesses</span></div>
            <div className="card"><span className="muted small">VIBE owes businesses now</span><strong>{formatINR(t.toSettle)}</strong><span className="muted small">{t.awaitingPayout > 0 ? `${formatINR(t.awaitingPayout)} ready to transfer` : 'Nothing drawn up yet'}</span></div>
            <div className="card"><span className="muted small">Paid out, {periodLabel}</span><strong>{formatINR(t.paidOut)}</strong><span className="muted small">{t.payoutsHeld > 0 ? `${t.payoutsHeld} held: KYC not verified` : 'None held'}</span></div>
            <Link to="/todo" className="card" style={{ textDecoration: 'none', color: 'inherit' }}><span className="muted small">Waiting for VIBE</span><strong>{t.waiting}</strong><span className="muted small">Open the to-do list</span></Link>
          </div>

          {current.id === null && vibe.data ? (
            <div className="card stack">
              <h2>Customers and VIBE Membership <span className="muted small" style={{ fontWeight: 400 }}>· membership fees are VIBE’s own income</span></h2>
              <div className="kpis">
                <div><span className="muted small">Customers</span><strong style={{ display: 'block', fontSize: 20 }}>{vibe.data.customers.toLocaleString('en-IN')}</strong><span className="muted small">{vibe.data.newCustomers7d} new this week</span></div>
                <div><span className="muted small">Active members</span><strong style={{ display: 'block', fontSize: 20 }}>{vibe.data.activeMembers.toLocaleString('en-IN')}</strong><span className="muted small">{vibe.data.lapsedMembers} lapsed</span></div>
                <div><span className="muted small">Membership sales, 30 days</span><strong style={{ display: 'block', fontSize: 20 }}>{formatINR(vibe.data.membershipRevenue30d)}</strong></div>
                <div><span className="muted small">Members saved, 30 days</span><strong style={{ display: 'block', fontSize: 20 }}>{formatINR(vibe.data.savedByMembers30d)}</strong></div>
              </div>
              <div className="row"><Link className="btn sm primary" to="/membership">Open VIBE Membership</Link><Link className="btn sm" to="/customers">Customers</Link><Link className="btn sm" to="/reports">Reports</Link></div>
            </div>
          ) : null}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>{current.id ? `Inside ${current.name}` : 'By category'}</h2>
            {current.id ? <button className="btn ghost sm" onClick={() => choose({ id: null, name: 'All of VIBE' })} hidden={!me.full && me.categories.length > 0}>Back to all of VIBE</button> : null}
          </div>
          <div className="cards">
            {d.cards.map((c) => <CategoryTile key={c.id} c={c} onOpen={c.id === current.id ? undefined : () => choose({ id: c.id, name: c.name })} />)}
            {d.cards.length === 0 ? <p className="muted">No categories with businesses yet.</p> : null}
          </div>

        </div>
      ) : null}
    </>
  );
}

function CategoryTile({ c, onOpen }: { c: CategoryCard; onOpen?: () => void }) {
  const chips: { text: string; tone: 'warning' | 'muted' }[] = [];
  if (c.kycWaiting) chips.push({ text: `${c.kycWaiting} KYC to check`, tone: 'warning' });
  if (c.applications) chips.push({ text: `${c.applications} applications`, tone: 'warning' });
  if (c.reviews) chips.push({ text: `${c.reviews} to review`, tone: 'warning' });
  if (c.disputes) chips.push({ text: `${c.disputes} disputes`, tone: 'warning' });
  if (c.refundsDue) chips.push({ text: `${c.refundsDue} refunds due`, tone: 'warning' });
  if (c.payoutsHeld) chips.push({ text: `${c.payoutsHeld} payouts held`, tone: 'muted' });
  const body = (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 17 }}>{c.name}</strong>
        <span className="muted small">{c.liveOutlets} live / {c.outlets} businesses</span>
      </div>
      <div className="figs">
        <div><span className="muted small">Sales</span><strong>{c.sales.toLocaleString('en-IN')}</strong></div>
        <div><span className="muted small">Collected</span><strong>{formatINR(c.collected)}</strong></div>
        <div><span className="muted small">To settle</span><strong>{formatINR(c.toSettle)}</strong></div>
      </div>
      <span className="muted small">{soldText(c)}</span>
      <div className="chips">{chips.length ? chips.map((x) => <Badge key={x.text} tone={x.tone}>{x.text}</Badge>) : <Badge tone="success">Nothing waiting</Badge>}</div>
      {onOpen ? <span className="small" style={{ color: 'var(--pink-deep)', fontWeight: 600 }}>Open {c.name} →</span> : null}
    </>
  );
  return onOpen ? <button type="button" className="cat-card" onClick={onOpen}>{body}</button> : <div className="cat-card" style={{ cursor: 'default' }}>{body}</div>;
}
