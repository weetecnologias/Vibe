import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { ChangePasswordPage, Loading, LoginPage, Notice, Shell, useAsync, useAuth, type AdminArea, type AdminMe, type NavItem } from '@kit';

import { AccessContext } from './access';

import { ApplicationsPage } from './pages/ApplicationsPage';
import { AuditPage } from './pages/AuditPage';
import { BusinessEditPage } from './pages/BusinessEditPage';
import { BusinessesPage } from './pages/BusinessesPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { AgreementsPage } from './pages/AgreementsPage';
import { CouponsPage } from './pages/CouponsPage';
import { DisputesPage } from './pages/DisputesPage';
import { KycPage } from './pages/KycPage';
import { LedgerPage } from './pages/LedgerPage';
import { RatesPage } from './pages/RatesPage';
import { ReconciliationPage } from './pages/ReconciliationPage';
import { CustomersPage } from './pages/CustomersPage';
import { DeletionsPage } from './pages/DeletionsPage';
import { EventEditPage } from './pages/EventEditPage';
import { EventSalesPage, EventsPage } from './pages/EventsPage';
import { HomePage } from './pages/HomePage';
import { MembersPage } from './pages/MembersPage';
import { OfferReviewPage } from './pages/OfferReviewPage';
import { PromotionReviewPage } from './pages/PromotionReviewPage';
import { OverviewPage } from './pages/OverviewPage';
import { PlansPage } from './pages/PlansPage';
import { RefundsPage } from './pages/RefundsPage';
import { ReportsPage } from './pages/ReportsPage';
import { TeamPage } from './pages/TeamPage';
import { ReviewsPage } from './pages/ReviewsPage';
import { SettlementsPage } from './pages/SettlementsPage';
import { StaffPage } from './pages/StaffPage';
import { TransactionsPage } from './pages/TransactionsPage';

/** Each page and the area it belongs to. "team" is the VIBE team page: super admins and admins only. */
type Page = { path: string; label: string; area: AdminArea | 'team'; group: string; element: ReactElement };
const PAGES: Page[] = [
  { group: '', path: 'overview', label: 'Overview', area: 'reports', element: <OverviewPage /> },
  { group: '', path: 'reports', label: 'Reports', area: 'reports', element: <ReportsPage /> },
  { group: 'Money', path: 'transactions', label: 'Transactions', area: 'money', element: <TransactionsPage /> },
  { group: 'Money', path: 'refunds', label: 'Refunds', area: 'money', element: <RefundsPage /> },
  { group: 'Money', path: 'disputes', label: 'Disputes', area: 'money', element: <DisputesPage /> },
  { group: 'Money', path: 'settlements', label: 'Settlements', area: 'money', element: <SettlementsPage /> },
  { group: 'Money', path: 'rates', label: 'Rates and tax', area: 'money', element: <RatesPage /> },
  { group: 'Money', path: 'ledger', label: 'Ledger', area: 'money', element: <LedgerPage /> },
  { group: 'Money', path: 'reconciliation', label: 'Reconciliation', area: 'money', element: <ReconciliationPage /> },
  { group: 'Customers', path: 'customers', label: 'Customers', area: 'customers', element: <CustomersPage /> },
  { group: 'Customers', path: 'members', label: 'Members', area: 'customers', element: <MembersPage /> },
  { group: 'Customers', path: 'deletions', label: 'Deletion requests', area: 'customers', element: <DeletionsPage /> },
  { group: 'Partners', path: 'applications', label: 'Applications', area: 'partners', element: <ApplicationsPage /> },
  { group: 'Partners', path: 'businesses', label: 'Businesses', area: 'partners', element: <BusinessesPage /> },
  { group: 'Partners', path: 'kyc', label: 'KYC and bank', area: 'partners', element: <KycPage /> },
  { group: 'Partners', path: 'agreement', label: 'Merchant agreement', area: 'partners', element: <AgreementsPage /> },
  { group: 'Reviews', path: 'offers', label: 'Offer review', area: 'content', element: <OfferReviewPage /> },
  { group: 'Reviews', path: 'promotions', label: 'Promotion review', area: 'content', element: <PromotionReviewPage /> },
  { group: 'Reviews', path: 'events', label: 'Events', area: 'content', element: <EventsPage /> },
  { group: 'Reviews', path: 'reviews', label: 'Customer reviews', area: 'content', element: <ReviewsPage /> },
  { group: 'Catalogue', path: 'categories', label: 'Categories', area: 'catalogue', element: <CategoriesPage /> },
  { group: 'Catalogue', path: 'home', label: 'Home content', area: 'catalogue', element: <HomePage /> },
  { group: 'Catalogue', path: 'plans', label: 'Membership plans', area: 'catalogue', element: <PlansPage /> },
  { group: 'Catalogue', path: 'coupons', label: 'Checkout coupons', area: 'catalogue', element: <CouponsPage /> },
  { group: 'Admin', path: 'team', label: 'VIBE team', area: 'team', element: <TeamPage /> },
  { group: 'Admin', path: 'staff', label: 'All logins', area: 'team', element: <StaffPage /> },
  { group: 'Admin', path: 'audit', label: 'Audit log', area: 'audit', element: <AuditPage /> },
];

export function App() {
  const { staff } = useAuth();
  if (!staff) return <LoginPage title="Admin" hint="For VIBE staff. Merchants sign in to the merchant dashboard." />;
  if (staff.mustChangePassword) return <ChangePasswordPage />;
  return <SignedIn />;
}

const ROLE_TITLE = { super_admin: 'Super admin', admin: 'Admin', staff: 'Staff' } as const;

function SignedIn() {
  const { client, signOut } = useAuth();
  const me = useAsync(() => client.get<AdminMe>('/v1/admin/access'), [client]);
  // No menu until we know what this person may open, so staff never see pages they can't use.
  if (!me.data) {
    return (
      <div className="login"><div className="card login-card">{me.error ? <><Notice tone="error">{me.error}</Notice><button className="btn" onClick={me.reload}>Try again</button><button className="btn ghost" onClick={signOut}>Sign out</button></> : <Loading />}</div></div>
    );
  }
  const access = me.data;
  const full = access.role === 'super_admin' || access.role === 'admin';
  const can = (area: AdminArea | 'team') => (area === 'team' ? full : full || access.areas.includes(area));
  const pages = PAGES.filter((p) => can(p.area));
  const nav: NavItem[] = [];
  for (const p of pages) {
    if (p.group && !nav.some((n) => 'heading' in n && n.heading === p.group)) nav.push({ heading: p.group });
    nav.push({ to: `/${p.path}`, label: p.label });
  }
  const home = pages.length ? `/${pages[0].path}` : '/nothing';
  const scope = access.categories.length ? ` · ${access.categories.map((c) => c.name).join(', ')}` : '';
  return (
    <AccessContext.Provider value={access}>
      <Routes>
        <Route element={<Shell title={`Admin · ${ROLE_TITLE[access.role]}${scope}`} nav={nav} />}>
          <Route index element={<Navigate to={home} replace />} />
          {pages.map((p) => <Route key={p.path} path={p.path} element={p.element} />)}
          {can('partners') ? <Route path="businesses/:id" element={<BusinessEditPage />} /> : null}
          {can('content') ? <Route path="events/:id" element={<EventEditPage />} /> : null}
          {can('content') ? <Route path="events/:id/sales" element={<EventSalesPage />} /> : null}
          <Route path="nothing" element={<Notice tone="info">Your access doesn’t include any part of this dashboard yet. Ask a VIBE admin.</Notice>} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Route>
      </Routes>
    </AccessContext.Provider>
  );
}
