import { Navigate, Route, Routes } from 'react-router-dom';

import { LoginPage, Shell, useAuth } from '@kit';

import { BillsPage } from './pages/BillsPage';
import { EventEditPage } from './pages/EventEditPage';
import { EventsPage } from './pages/EventsPage';
import { MenuPage } from './pages/MenuPage';
import { OffersPage } from './pages/OffersPage';
import { ProfilePage } from './pages/ProfilePage';
import { ReservationsPage } from './pages/ReservationsPage';
import { TeamPage } from './pages/TeamPage';

const NAV = [
  { to: '/bills', label: 'Bills' },
  { to: '/profile', label: 'My business' },
  { to: '/menu', label: 'Menu' },
  { to: '/offers', label: 'Offers' },
  { to: '/events', label: 'Events' },
  { to: '/reservations', label: 'Reservations' },
  { to: '/team', label: 'Team' },
];

export function App() {
  const { staff } = useAuth();
  if (!staff) return <LoginPage title="Merchant" hint="Your login is created by the VIBE team. Forgotten your password? Ask them to reset it." />;
  return (
    <Routes>
      <Route element={<Shell title="Merchant" nav={NAV} />}>
        <Route index element={<Navigate to="/bills" replace />} />
        <Route path="bills" element={<BillsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="menu" element={<MenuPage />} />
        <Route path="offers" element={<OffersPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/:id" element={<EventEditPage />} />
        <Route path="reservations" element={<ReservationsPage />} />
        <Route path="team" element={<TeamPage />} />
        <Route path="*" element={<Navigate to="/bills" replace />} />
      </Route>
    </Routes>
  );
}
