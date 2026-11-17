import type { ReactNode } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';

import { ChangePasswordPage, Loading, LoginPage, Notice, NotificationBell, Shell, useAsync, useAuth, type MerchantFeature, type MerchantSettings, type NavItem } from '@kit';

import { AgreementPage } from './pages/AgreementPage';
import { ApplyPage } from './pages/ApplyPage';
import { KycPage } from './pages/KycPage';
import { BillsPage } from './pages/BillsPage';
import { EventEditPage } from './pages/EventEditPage';
import { EventSalesPage, EventsPage } from './pages/EventsPage';
import { MenuPage } from './pages/MenuPage';
import { OffersPage } from './pages/OffersPage';
import { PromotionsPage } from './pages/PromotionsPage';
import { ProfilePage } from './pages/ProfilePage';
import { ReservationsPage } from './pages/ReservationsPage';
import { CinemaPage } from './pages/CinemaPage';
import { DashboardPage } from './pages/DashboardPage';
import { ResultsPage } from './pages/ResultsPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { SettlementsPage } from './pages/SettlementsPage';
import { TeamPage } from './pages/TeamPage';
import { VenuePage } from './pages/VenuePage';
import { SettingsContext } from './settings';
import { useWaitingBills } from './waiting';

export function App() {
  const { staff } = useAuth();
  if (!staff) {
    return (
      <Routes>
        <Route path="/apply" element={<ApplyPage />} />
        <Route
          path="*"
          element={<LoginPage title="Merchant" hint="Your login is created by the VIBE team once your business is approved. Forgotten your password? Ask them to reset it." footer={<Link to="/apply" className="small">New to VIBE? Apply to join</Link>} />}
        />
      </Routes>
    );
  }
  if (staff.mustChangePassword) return <ChangePasswordPage />;
  return <SignedIn />;
}

type Page = { path: string; label: string; area: string | 'team'; element: ReactNode; group: string; when?: boolean };

function SignedIn() {
  const { client, signOut } = useAuth();
  const s = useAsync(() => client.get<MerchantSettings>('/v1/merchant/settings'), [client]);
  // Customers waiting at Bills and codes, kept live for the menu, the top bar and the dashboard (only for people who handle bills).
  const sd = s.data;
  const handlesBills = !!sd && sd.payRedeem && (!sd.features || sd.features.includes('bills')) && (!!sd.owner || (sd.permissions ?? []).includes('bills'))
    && !(sd.agreement?.required && !sd.agreement.accepted);
  const waiting = useWaitingBills(handlesBills);

  // Don't show any menu until we know what this person may do, so a cashier never sees pages they can't open.
  if (!s.data) {
    return (
      <div className="login">
        <div className="card login-card">{s.error ? <><Notice tone="error">{s.error}</Notice><button className="btn" onClick={s.reload}>Try again</button><button className="btn ghost" onClick={signOut}>Sign out</button></> : <Loading />}</div>
      </div>
    );
  }
  const settings = s.data;
  // Until the owner accepts VIBE's current merchant agreement, nothing else works: show it instead.
  if (settings.agreement?.required && !settings.agreement.accepted) {
    return <AgreementPage status={settings.agreement} owner={!!settings.owner} onAccepted={s.reload} />;
  }
  const can = (area: string) => (area === 'team' ? !!settings.owner : !!settings.owner || (settings.permissions ?? []).includes(area));
  // What this kind of business gets on VIBE (from the category it onboarded in): a café never sees court bookings, a venue never sees bills it doesn't use.
  const has = (f: MerchantFeature) => !settings.features || settings.features.includes(f);

  // The menu, top to bottom: Dashboard, then what happens today, selling on VIBE, money, and the business itself. Each page shows only to people whose role
  // includes it, and only for the kinds of business that use it (a café never sees court bookings).
  const pages: Page[] = [
    { group: '', path: 'dashboard', label: 'Dashboard', area: 'any', element: <></> },
    { group: 'Today', path: 'bills', label: 'Bills and codes', area: 'bills', element: <BillsPage />, when: settings.payRedeem && has('bills') },
    { group: 'Today', path: 'reservations', label: 'Reservations', area: 'reservations', element: <ReservationsPage />, when: has('reservations') },
    { group: 'Today', path: 'bookings', label: has('bookings') ? (has('memberships') ? 'Bookings & members' : 'Bookings') : 'Members', area: 'bookings', element: <VenuePage />, when: !!settings.slotBooking && (has('bookings') || has('memberships')) },
    { group: 'Today', path: 'cinema', label: 'Cinema', area: 'events', element: <CinemaPage />, when: has('events') && /movie/i.test(settings.topCategoryName ?? '') },
    { group: 'Sell on VIBE', path: 'offers', label: 'Offers', area: 'offers', element: <OffersPage />, when: settings.payRedeem && has('offers') },
    { group: 'Sell on VIBE', path: 'promotions', label: 'Promotions', area: 'offers', element: <PromotionsPage />, when: has('promotions') },
    { group: 'Sell on VIBE', path: 'events', label: 'Events', area: 'events', element: <EventsPage />, when: has('events') },
    { group: 'Money', path: 'results', label: 'Reports', area: 'money', element: <ResultsPage /> },
    { group: 'Money', path: 'settlements', label: 'Settlements', area: 'money', element: <SettlementsPage /> },
    { group: 'Money', path: 'kyc', label: settings.kycStatus === 'verified' ? 'Bank and KYC' : 'Bank and KYC (needed)', area: 'team', element: <KycPage /> },
    { group: 'Your business', path: 'profile', label: 'Profile and photos', area: 'profile', element: <ProfilePage /> },
    { group: 'Your business', path: 'menu', label: settings.menuLabel, area: 'menu', element: <MenuPage />, when: has('menu') },
    { group: 'Your business', path: 'reviews', label: 'Reviews', area: 'profile', element: <ReviewsPage /> },
    { group: 'Your business', path: 'team', label: 'Team', area: 'team', element: <TeamPage /> },
  ].filter((p) => p.when !== false && (p.area === 'any' || can(p.area)));
  const open = new Set(pages.map((p) => p.path));
  const dashboard = pages.find((p) => p.path === 'dashboard')!;
  dashboard.element = <DashboardPage open={open} settings={settings} waiting={waiting} />;

  const nav: NavItem[] = [];
  for (const p of pages) {
    if (p.group && !nav.some((n) => 'heading' in n && n.heading === p.group)) nav.push({ heading: p.group });
    nav.push({ to: `/${p.path}`, label: p.label, badge: p.path === 'bills' && waiting ? waiting : undefined });
  }
  const home = '/dashboard';

  return (
    <SettingsContext.Provider value={settings}>
      <Routes>
        <Route element={<Shell title={settings.topCategoryName ? `for ${settings.topCategoryName}` : 'Merchant'} nav={nav} topbar={<TopBar settings={settings} bills={open.has('bills')} waiting={waiting} />} />}>
          <Route index element={<Navigate to={home} replace />} />
          {pages.map((p) => <Route key={p.path} path={p.path} element={p.element} />)}
          {can('events') && has('events') ? <Route path="events/:id" element={<EventEditPage />} /> : null}
          {can('events') && has('events') ? <Route path="events/:id/sales" element={<EventSalesPage />} /> : null}
          <Route path="*" element={<Navigate to={home} replace />} />
        </Route>
      </Routes>
    </SettingsContext.Provider>
  );
}

/** Across the top of every page: the business and its Merchant ID on the left; bills, raising a bill and alerts on the right. */
function TopBar({ settings, bills, waiting }: { settings: MerchantSettings; bills: boolean; waiting: number | null }) {
  return (
    <>
      <div className="who">
        <strong>{settings.businessName ?? 'Your business'}</strong>
        <span className="mid">
          {settings.merchantId ? <>Merchant ID <code>{settings.merchantId}</code></> : null}
          {settings.categoryName ? <span>· {settings.categoryName}</span> : null}
        </span>
      </div>
      <div className="actions">
        {bills ? (
          <Link to="/bills" className="btn ghost sm" aria-label={waiting ? `Bills and codes, ${waiting} waiting` : 'Bills and codes'}>
            Bills and codes{waiting ? <span className="wait-count">{waiting} waiting</span> : null}
          </Link>
        ) : null}
        {bills ? <Link to="/bills?raise=1" className="btn primary sm">Raise a bill</Link> : null}
        <NotificationBell />
      </div>
    </>
  );
}
