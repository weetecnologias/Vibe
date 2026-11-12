import type { ReactNode } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';

import { ChangePasswordPage, Loading, LoginPage, Notice, Shell, useAsync, useAuth, type MerchantSettings, type NavItem } from '@kit';

import { ApplyPage } from './pages/ApplyPage';
import { BillsPage } from './pages/BillsPage';
import { EventEditPage } from './pages/EventEditPage';
import { EventSalesPage, EventsPage } from './pages/EventsPage';
import { MenuPage } from './pages/MenuPage';
import { OffersPage } from './pages/OffersPage';
import { ProfilePage } from './pages/ProfilePage';
import { ReservationsPage } from './pages/ReservationsPage';
import { ResultsPage } from './pages/ResultsPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { SettlementsPage } from './pages/SettlementsPage';
import { TeamPage } from './pages/TeamPage';
import { SettingsContext } from './settings';

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

  // Don't show any menu until we know what this person may do, so a cashier never sees pages they can't open.
  if (!s.data) {
    return (
      <div className="login">
        <div className="card login-card">{s.error ? <><Notice tone="error">{s.error}</Notice><button className="btn" onClick={s.reload}>Try again</button><button className="btn ghost" onClick={signOut}>Sign out</button></> : <Loading />}</div>
      </div>
    );
  }
  const settings = s.data;
  const can = (area: string) => (area === 'team' ? !!settings.owner : !!settings.owner || (settings.permissions ?? []).includes(area));

  // Grouped by what the owner is doing: serving customers today, selling on VIBE, money, and the business itself. Each page shows only to people whose role includes it.
  const pages: Page[] = [
    { group: 'Today', path: 'bills', label: 'Bills', area: 'bills', element: <BillsPage />, when: settings.payRedeem },
    { group: 'Sell on VIBE', path: 'offers', label: 'Offers', area: 'offers', element: <OffersPage />, when: settings.payRedeem },
    { group: 'Sell on VIBE', path: 'events', label: 'Events', area: 'events', element: <EventsPage /> },
    { group: 'Money', path: 'results', label: 'Your results', area: 'money', element: <ResultsPage /> },
    { group: 'Money', path: 'settlements', label: 'Settlements', area: 'money', element: <SettlementsPage /> },
    { group: 'My business', path: 'profile', label: 'Profile and photos', area: 'profile', element: <ProfilePage /> },
    { group: 'My business', path: 'menu', label: settings.menuLabel, area: 'menu', element: <MenuPage /> },
    { group: 'My business', path: 'reviews', label: 'Reviews', area: 'profile', element: <ReviewsPage /> },
    { group: 'My business', path: 'reservations', label: 'Reservations', area: 'reservations', element: <ReservationsPage /> },
    { group: 'My business', path: 'team', label: 'Team', area: 'team', element: <TeamPage /> },
  ].filter((p) => p.when !== false && can(p.area));

  const nav: NavItem[] = [];
  for (const p of pages) {
    if (!nav.some((n) => 'heading' in n && n.heading === p.group)) nav.push({ heading: p.group });
    nav.push({ to: `/${p.path}`, label: p.label });
  }
  const home = pages.length ? `/${pages[0].path}` : '/nothing';

  return (
    <SettingsContext.Provider value={settings}>
      <Routes>
        <Route element={<Shell title="Merchant" nav={nav} />}>
          <Route index element={<Navigate to={home} replace />} />
          {pages.map((p) => <Route key={p.path} path={p.path} element={p.element} />)}
          {can('events') ? <Route path="events/:id" element={<EventEditPage />} /> : null}
          {can('events') ? <Route path="events/:id/sales" element={<EventSalesPage />} /> : null}
          <Route path="nothing" element={<Notice tone="info">Your role doesn’t include any part of this dashboard yet. Ask the owner to give you access.</Notice>} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Route>
      </Routes>
    </SettingsContext.Provider>
  );
}
