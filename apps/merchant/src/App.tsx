import { Navigate, Route, Routes } from 'react-router-dom';

import { LoginPage, Shell, useAuth } from '@kit';

import { MenuPage } from './pages/MenuPage';
import { OffersPage } from './pages/OffersPage';
import { ProfilePage } from './pages/ProfilePage';

const NAV = [
  { to: '/profile', label: 'My business' },
  { to: '/menu', label: 'Menu' },
  { to: '/offers', label: 'Offers' },
];

export function App() {
  const { staff } = useAuth();
  if (!staff) return <LoginPage title="Merchant" hint="Your login is created by the VIBE team. Forgotten your password? Ask them to reset it." />;
  return (
    <Routes>
      <Route element={<Shell title="Merchant" nav={NAV} />}>
        <Route index element={<Navigate to="/profile" replace />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="menu" element={<MenuPage />} />
        <Route path="offers" element={<OffersPage />} />
        <Route path="*" element={<Navigate to="/profile" replace />} />
      </Route>
    </Routes>
  );
}
