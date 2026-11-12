import { Navigate, Route, Routes } from 'react-router-dom';

import { ChangePasswordPage, LoginPage, Shell, useAuth, type NavItem } from '@kit';

import { ApplicationsPage } from './pages/ApplicationsPage';
import { AuditPage } from './pages/AuditPage';
import { BusinessEditPage } from './pages/BusinessEditPage';
import { BusinessesPage } from './pages/BusinessesPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { CouponsPage } from './pages/CouponsPage';
import { CustomersPage } from './pages/CustomersPage';
import { DeletionsPage } from './pages/DeletionsPage';
import { EventEditPage } from './pages/EventEditPage';
import { EventSalesPage, EventsPage } from './pages/EventsPage';
import { HomePage } from './pages/HomePage';
import { MembersPage } from './pages/MembersPage';
import { OfferReviewPage } from './pages/OfferReviewPage';
import { OverviewPage } from './pages/OverviewPage';
import { PlansPage } from './pages/PlansPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { SettlementsPage } from './pages/SettlementsPage';
import { StaffPage } from './pages/StaffPage';
import { TransactionsPage } from './pages/TransactionsPage';

const NAV: NavItem[] = [
  { to: '/overview', label: 'Overview' },
  { heading: 'Money' },
  { to: '/transactions', label: 'Transactions' },
  { to: '/settlements', label: 'Settlements' },
  { to: '/members', label: 'Members' },
  { heading: 'People' },
  { to: '/customers', label: 'Customers' },
  { heading: 'Merchants' },
  { to: '/applications', label: 'Applications' },
  { to: '/businesses', label: 'Businesses' },
  { to: '/offers', label: 'Offer review' },
  { to: '/events', label: 'Events' },
  { to: '/reviews', label: 'Reviews' },
  { heading: 'What customers see' },
  { to: '/home', label: 'Home content' },
  { to: '/categories', label: 'Categories' },
  { to: '/plans', label: 'Membership plans' },
  { to: '/coupons', label: 'Checkout coupons' },
  { heading: 'Admin' },
  { to: '/deletions', label: 'Deletion requests' },
  { to: '/staff', label: 'Staff accounts' },
  { to: '/audit', label: 'Audit log' },
];

export function App() {
  const { staff } = useAuth();
  if (!staff) return <LoginPage title="Admin" hint="For VIBE staff. Merchants sign in to the merchant dashboard." />;
  if (staff.mustChangePassword) return <ChangePasswordPage />;
  return (
    <Routes>
      <Route element={<Shell title="Admin" nav={NAV} />}>
        <Route index element={<Navigate to="/overview" replace />} />
        <Route path="overview" element={<OverviewPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="members" element={<MembersPage />} />
        <Route path="settlements" element={<SettlementsPage />} />
        <Route path="reviews" element={<ReviewsPage />} />
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="businesses" element={<BusinessesPage />} />
        <Route path="businesses/:id" element={<BusinessEditPage />} />
        <Route path="offers" element={<OfferReviewPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="events/:id" element={<EventEditPage />} />
        <Route path="events/:id/sales" element={<EventSalesPage />} />
        <Route path="home" element={<HomePage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="coupons" element={<CouponsPage />} />
        <Route path="deletions" element={<DeletionsPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Route>
    </Routes>
  );
}
