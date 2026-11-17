import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import { isWaiting } from '../waiting';
import { Badge, Loading, Notice, PageHead, formatINR, showDateTime, useAsync, useAuth, type BillBoard, type CinemaShow, type MeetupReservation, type MerchantResults, type MerchantSettings } from '@kit';

type Alert = { id: string; kind: string; title: string; body: string; link: string | null; createdAt: string; read: boolean };
type Todo = { text: string; to: string };

const todayIST = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

/**
 * The merchant's home: today at a glance, what needs doing, money owed and paid, recent alerts and quick actions. Each part loads only when this
 * person can open the page behind it, so a cashier sees bills and alerts, and an owner sees everything.
 */
export function DashboardPage({ open, settings, waiting }: { open: Set<string>; settings: MerchantSettings; waiting: number | null }) {
  const { client } = useAuth();
  const has = (path: string) => open.has(path);
  const none = Promise.resolve(null);
  const results = useAsync(() => (has('results') ? client.get<MerchantResults>('/v1/merchant/results?days=30') : none), [client]);
  const bills = useAsync(() => (has('bills') ? client.get<BillBoard>('/v1/merchant/bills?view=open') : none), [client]);
  const reservations = useAsync(() => (has('reservations') ? client.get<MeetupReservation[]>(`/v1/merchant/reservations?day=${todayIST()}`) : none), [client]);
  const shows = useAsync(() => (has('cinema') ? client.get<CinemaShow[]>(`/v1/merchant/cinema/shows?from=${todayIST()}&days=1`) : none), [client]);
  const alerts = useAsync(() => client.get<{ unread: number; items: Alert[] }>('/v1/staff/notifications?limit=6'), [client]);

  // Keeps itself up to date while it's open: the day's numbers every 15 seconds, money every minute.
  useEffect(() => {
    const fast = setInterval(() => { if (!document.hidden) { bills.reload(); reservations.reload(); shows.reload(); alerts.reload(); } }, 15_000);
    const slow = setInterval(() => { if (!document.hidden) results.reload(); }, 60_000);
    return () => { clearInterval(fast); clearInterval(slow); };
  }, [bills.reload, reservations.reload, shows.reload, alerts.reload, results.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  const r = results.data;
  const today = r?.lastDays?.[r.lastDays.length - 1];
  // The live count from the top bar when there is one (checked every few seconds), else this page's own.
  const waitingBills = waiting ?? bills.data?.rows.filter(isWaiting).length ?? 0;
  const booked = (reservations.data ?? []).filter((x) => x.status === 'confirmed');
  const liveShows = (shows.data ?? []).filter((x) => x.status === 'scheduled');

  const todo: Todo[] = [];
  if (has('kyc') && settings.kycStatus !== 'verified') todo.push({ text: settings.kycStatus === 'submitted' ? 'VIBE is checking your bank and KYC details. Payouts start once they’re verified.' : 'Add your bank and KYC details so VIBE can pay you.', to: '/kyc' });
  if (waitingBills) todo.push({ text: `${waitingBills} customer${waitingBills === 1 ? ' is' : 's are'} waiting for a bill or a code check`, to: '/bills' });
  if (booked.length) todo.push({ text: `${booked.length} VIBE Social table${booked.length === 1 ? '' : 's'} booked today`, to: '/reservations' });
  if (r?.offersPending) todo.push({ text: `${r.offersPending} offer${r.offersPending === 1 ? '' : 's'} waiting for VIBE’s review`, to: '/offers' });
  if (r?.eventsPending) todo.push({ text: `${r.eventsPending} event${r.eventsPending === 1 ? '' : 's'} waiting for VIBE’s review`, to: '/events' });

  return (
    <>
      <PageHead title="Dashboard" sub={`Today at ${settings.businessName ?? 'your business'}${settings.merchantId ? ` · Merchant ID ${settings.merchantId}` : ''}. Everything paid through VIBE carries this ID.`} />

      <div className="stack">
        {/* Today at a glance */}
        <div className="dash-grid">
          {r ? (
            <>
              <Link to="/results" className="dash-card"><span className="muted small">Sales today</span><strong>{formatINR(today?.sales ?? 0)}</strong><span className="muted small">{today?.bills ?? 0} payment{today?.bills === 1 ? '' : 's'} through VIBE</span></Link>
              <Link to="/settlements" className="dash-card"><span className="muted small">VIBE will pay you</span><strong>{formatINR(r.unsettled.payout)}</strong><span className="muted small">from {r.unsettled.count} payment{r.unsettled.count === 1 ? '' : 's'} not yet settled</span></Link>
              <Link to="/settlements" className="dash-card"><span className="muted small">On its way to your bank</span><strong>{formatINR(r.awaitingPayout)}</strong><span className="muted small">{formatINR(r.paidOut)} paid out so far</span></Link>
              <Link to="/results" className="dash-card"><span className="muted small">Last 30 days</span><strong>{formatINR(r.sales)}</strong><span className="muted small">{r.customers} customer{r.customers === 1 ? '' : 's'}{r.rating ? ` · ★ ${r.rating.toFixed(1)}` : ''}</span></Link>
            </>
          ) : results.loading && has('results') ? <Loading /> : null}
          {has('bills') ? <Link to="/bills" className="dash-card"><span className="muted small">Bills and codes</span><strong>{waitingBills}</strong><span className="muted small">waiting now · {bills.data?.summary.paidToday ?? 0} paid today</span></Link> : null}
          {has('reservations') ? <Link to="/reservations" className="dash-card"><span className="muted small">Reservations today</span><strong>{booked.length}</strong><span className="muted small">VIBE Social tables for two</span></Link> : null}
          {has('cinema') ? <Link to="/cinema" className="dash-card"><span className="muted small">Shows today</span><strong>{liveShows.length}</strong><span className="muted small">{liveShows.reduce((n, x) => n + x.sold, 0)} seats sold</span></Link> : null}
          {has('bookings') ? <Link to="/bookings" className="dash-card"><span className="muted small">Bookings</span><strong>Today</strong><span className="muted small">Courts, sessions and check-in</span></Link> : null}
        </div>

        <div className="dash-two">
          <div className="card stack">
            <h2 style={{ margin: 0 }}>To do</h2>
            {todo.length === 0 ? <div className="muted">Nothing waiting. New customers, payments and bookings show up here and in Alerts.</div> : todo.map((t) => (
              <Link key={t.text} to={t.to} className="todo-item"><span className="dot" aria-hidden /> <span style={{ flex: 1 }}>{t.text}</span><span className="muted">›</span></Link>
            ))}
            <h3 style={{ margin: '8px 0 0' }}>Quick actions</h3>
            <div className="quick">
              {has('bills') ? <Link to="/bills?raise=1" className="btn primary sm">Raise a bill</Link> : null}
              {has('offers') ? <Link to="/offers" className="btn sm">Create an offer</Link> : null}
              {has('events') ? <Link to="/events" className="btn sm">Create an event</Link> : null}
              {has('cinema') ? <Link to="/cinema" className="btn sm">Schedule a show</Link> : null}
              {has('promotions') ? <Link to="/promotions" className="btn sm">Promote your place</Link> : null}
              {has('settlements') ? <Link to="/settlements" className="btn sm">Settlement reports</Link> : null}
            </div>
          </div>

          <div className="card stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>Latest alerts</h2>
              {alerts.data?.unread ? <Badge tone="pink">{alerts.data.unread} new</Badge> : null}
            </div>
            {alerts.error ? <Notice tone="error">{alerts.error}</Notice> : null}
            {alerts.data && alerts.data.items.length === 0 ? <div className="muted">No alerts yet. Payments, bookings, reservations and reviews appear here.</div> : null}
            {alerts.data?.items.map((a) => (
              <Link key={a.id} to={a.link ?? '/dashboard'} className="todo-item" style={a.read ? undefined : { borderColor: 'var(--pink)', background: 'var(--pink-tint)' }}>
                <span style={{ flex: 1, display: 'grid', gap: 2 }}><strong className="small">{a.title}</strong><span className="small muted">{a.body}</span><span className="small muted">{showDateTime(a.createdAt)}</span></span>
                <span className="muted">›</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
