import { Navigate, Route, Routes } from 'react-router-dom';

import { LoginPage, Shell, useAuth } from '@kit';

import { AuditPage } from './pages/AuditPage';
import { BusinessEditPage } from './pages/BusinessEditPage';
import { BusinessesPage } from './pages/BusinessesPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { CouponsPage } from './pages/CouponsPage';
import { EventEditPage } from './pages/EventEditPage';
import { EventsPage } from './pages/EventsPage';
import { HomePage } from './pages/HomePage';
import { OfferReviewPage } from './pages/OfferReviewPage';
import { PlansPage } from './pages/PlansPage';
import { StaffPage } from './pages/StaffPage';

const NAV = [
  { to: '/categories', label: 'Categories' },
  { to: '/businesses', label: 'Businesses' },
  { to: '/offers', label: 'Offer review' },
  { to: '/events', label: 'Events' },
  { to: '/home', label: 'Home content' },
  { to: '/plans', label: 'Membership plans' },
  { to: '/coupons', label: 'Checkout coupons' },
  { to: '/staff', label: 'Staff accounts' },
  { to: '/audit', label: 'Audit log' },
];

export function App() {
  const { staff } = useAuth();
  if (!staff) return <LoginPage title="Admin" hint="For VIBE staff. Merchants sign in to the merchant dashboard." />;
  return (
    <Routes>
      <Route element={<Shell title="Admin" nav={NAV} />}>
        <Route index element={<Navigate to="/categories" replace />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="businesses" element={<BusinessesPage />} />
        <Route path="businesses/:id" element={<BusinessEditPage />} />
        <Route path="offers" element={<OfferReviewPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/:id" element={<EventEditPage />} />
        <Route path="home" element={<HomePage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="coupons" element={<CouponsPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="*" element={<Navigate to="/categories" replace />} />
      </Route>
    </Routes>
  );
}
