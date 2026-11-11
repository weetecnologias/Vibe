import { Link, Navigate, Route, Routes } from 'react-router-dom';

import { ChangePasswordPage, LoginPage, Shell, useAsync, useAuth, type MerchantSettings, type NavItem } from '@kit';

import { ApplyPage } from './pages/ApplyPage';
import { BillsPage } from './pages/BillsPage';
import { EventEditPage } from './pages/EventEditPage';
import { EventsPage } from './pages/EventsPage';
import { MenuPage } from './pages/MenuPage';
import { OffersPage } from './pages/OffersPage';
import { ProfilePage } from './pages/ProfilePage';
import { ReservationsPage } from './pages/ReservationsPage';
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

function SignedIn() {
  const { client } = useAuth();
  const s = useAsync(() => client.get<MerchantSettings>('/v1/merchant/settings'), [client]);
  const settings: MerchantSettings = s.data ?? { payRedeem: true, menuLabel: 'Menu' };
  const home = settings.payRedeem ? '/bills' : '/events';

  const nav: NavItem[] = [
    ...(settings.payRedeem ? [{ to: '/bills', label: 'Bills' }] : []),
    { to: '/events', label: 'Events' },
    { heading: 'My business' },
    { to: '/profile', label: 'Profile and photos' },
    { to: '/menu', label: settings.menuLabel },
    ...(settings.payRedeem ? [{ to: '/offers', label: 'Offers' }] : []),
    { to: '/reservations', label: 'Reservations' },
    { to: '/team', label: 'Team' },
  ];

  return (
    <SettingsContext.Provider value={settings}>
      <Routes>
        <Route element={<Shell title="Merchant" nav={nav} />}>
          <Route index element={<Navigate to={home} replace />} />
          <Route path="bills" element={settings.payRedeem ? <BillsPage /> : <Navigate to="/events" replace />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="menu" element={<MenuPage />} />
          <Route path="offers" element={settings.payRedeem ? <OffersPage /> : <Navigate to="/events" replace />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="events/:id" element={<EventEditPage />} />
          <Route path="reservations" element={<ReservationsPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Route>
      </Routes>
    </SettingsContext.Provider>
  );
}
