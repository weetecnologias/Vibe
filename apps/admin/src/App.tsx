import type { ReactElement } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { useEffect, useState } from 'react';

import { ChangePasswordPage, Loading, LoginPage, Notice, Shell, useAsync, useAuth, type AdminArea, type AdminMe, type NavItem, type TodoList, type WorkspaceList } from '@kit';

import { AccessContext } from './access';
import { WorkspaceProvider, WorkspaceSwitcher, useWorkspace } from './workspace';
import { BalancesPage } from './pages/BalancesPage';
import { MerchantProfilePage } from './pages/MerchantProfilePage';
import { MerchantsPage } from './pages/MerchantsPage';
import { TodoPage } from './pages/TodoPage';

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

/**
 * Each page, the area it belongs to and its menu group. allOnly pages are about VIBE as a whole (customers, setup), so they show only when looking at
 * all of VIBE, not inside one category. "team" is the VIBE team page: super admins and admins only.
 */
type Page = { path: string; label: string; area: AdminArea | 'team' | 'any'; group: string; element: ReactElement; allOnly?: boolean; fullOnly?: boolean };
const PAGES: Page[] = [
  { group: 'Daily', path: 'overview', label: 'Overview', area: 'reports', element: <OverviewPage /> },
  { group: 'Daily', path: 'todo', label: 'To do', area: 'any', element: <TodoPage /> },
  { group: 'Daily', path: 'reports', label: 'Reports', area: 'reports', element: <ReportsPage /> },
  { group: 'Partners', path: 'merchants', label: 'Merchants', area: 'partners', element: <MerchantsPage /> },
  { group: 'Partners', path: 'applications', label: 'Applications', area: 'partners', element: <ApplicationsPage /> },
  { group: 'Money', path: 'transactions', label: 'Sales and payments', area: 'money', element: <TransactionsPage /> },
  { group: 'Money', path: 'settlements', label: 'Settlements', area: 'money', element: <SettlementsPage /> },
  { group: 'Money', path: 'balances', label: 'Merchant balances', area: 'money', element: <BalancesPage /> },
  { group: 'Money', path: 'refunds', label: 'Refunds', area: 'money', element: <RefundsPage /> },
  { group: 'Money', path: 'disputes', label: 'Disputes', area: 'money', element: <DisputesPage /> },
  { group: 'Content', path: 'offers', label: 'Offer review', area: 'content', element: <OfferReviewPage /> },
  { group: 'Content', path: 'promotions', label: 'Promotion review', area: 'content', element: <PromotionReviewPage /> },
  { group: 'Content', path: 'events', label: 'Events', area: 'content', element: <EventsPage /> },
  { group: 'Content', path: 'reviews', label: 'Customer reviews', area: 'content', element: <ReviewsPage /> },
  { group: 'Customers', path: 'customers', label: 'Customers', area: 'customers', element: <CustomersPage />, allOnly: true },
  { group: 'Customers', path: 'members', label: 'Members', area: 'customers', element: <MembersPage />, allOnly: true },
  { group: 'Customers', path: 'deletions', label: 'Deletion requests', area: 'customers', element: <DeletionsPage />, allOnly: true },
  { group: 'Setup', path: 'categories', label: 'Categories', area: 'catalogue', element: <CategoriesPage />, allOnly: true },
  { group: 'Setup', path: 'home', label: 'Home content', area: 'catalogue', element: <HomePage />, allOnly: true },
  { group: 'Setup', path: 'plans', label: 'Membership plans', area: 'catalogue', element: <PlansPage />, allOnly: true },
  { group: 'Setup', path: 'coupons', label: 'Checkout coupons', area: 'catalogue', element: <CouponsPage />, allOnly: true },
  { group: 'Setup', path: 'rates', label: 'Rates and tax', area: 'money', element: <RatesPage />, allOnly: true },
  { group: 'Setup', path: 'agreement', label: 'Merchant agreement', area: 'partners', element: <AgreementsPage />, allOnly: true, fullOnly: true },
  { group: 'Setup', path: 'reconciliation', label: 'Reconciliation', area: 'money', element: <ReconciliationPage />, allOnly: true, fullOnly: true },
  { group: 'Setup', path: 'ledger', label: 'Accounting ledger', area: 'money', element: <LedgerPage />, allOnly: true, fullOnly: true },
  { group: 'Setup', path: 'team', label: 'VIBE team', area: 'team', element: <TeamPage />, allOnly: true },
  { group: 'Setup', path: 'staff', label: 'All logins', area: 'team', element: <StaffPage />, allOnly: true },
  { group: 'Setup', path: 'audit', label: 'Audit log', area: 'audit', element: <AuditPage />, allOnly: true },
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
  const ws = useAsync(() => client.get<WorkspaceList>('/v1/admin/workspaces'), [client]);
  // No menu until we know what this person may open, so staff never see pages they can't use.
  if (!me.data || !ws.data) {
    const error = me.error ?? ws.error;
    return (
      <div className="login"><div className="card login-card">{error ? <><Notice tone="error">{error}</Notice><button className="btn" onClick={() => { me.reload(); ws.reload(); }}>Try again</button><button className="btn ghost" onClick={signOut}>Sign out</button></> : <Loading />}</div></div>
    );
  }
  const access = me.data;
  return (
    <AccessContext.Provider value={access}>
      <WorkspaceProvider list={ws.data}>{(key) => <Pages key={key} access={access} />}</WorkspaceProvider>
    </AccessContext.Provider>
  );
}

/** The menu and pages for the category being looked at. Remounted when the category changes, so every page reloads its data for it. */
function Pages({ access }: { access: AdminMe }) {
  const { client } = useAuth();
  const { current } = useWorkspace();
  const full = access.role === 'super_admin' || access.role === 'admin';
  const scoped = !full && access.categories.length > 0;
  const can = (p: Page) => {
    if (p.allOnly && (current.id !== null || scoped)) return false;
    if (p.fullOnly && !full) return false;
    if (p.area === 'any') return true;
    return p.area === 'team' ? full : full || access.areas.includes(p.area);
  };
  const pages = PAGES.filter(can);
  const canArea = (area: AdminArea) => full || access.areas.includes(area);

  // The number of things waiting, on the To do item. Refreshed every minute.
  const [waiting, setWaiting] = useState<number | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const load = () => client.get<TodoList>('/v1/admin/todo').then((t) => { if (live) setWaiting(t.items.length); }, () => undefined);
    load();
    const t = setInterval(load, 60000);
    return () => { live = false; clearInterval(t); };
  }, [client]);

  const nav: NavItem[] = [];
  for (const p of pages) {
    if (p.group && !nav.some((n) => 'heading' in n && n.heading === p.group)) nav.push({ heading: p.group });
    nav.push({ to: '/' + p.path, label: p.label, badge: p.path === 'todo' && waiting ? waiting : undefined });
  }
  const home = pages.length ? '/' + pages[0].path : '/nothing';
  return (
    <Routes>
      <Route element={<Shell title={'Admin · ' + ROLE_TITLE[access.role]} nav={nav} switcher={<WorkspaceSwitcher />} />}>
        <Route index element={<Navigate to={home} replace />} />
        {pages.map((p) => <Route key={p.path} path={p.path} element={p.element} />)}
        {canArea('partners') ? <Route path="merchants/:id" element={<MerchantProfilePage />} /> : null}
        {canArea('partners') ? <Route path="businesses" element={<BusinessesPage />} /> : null}
        {canArea('partners') ? <Route path="businesses/:id" element={<BusinessEditPage />} /> : null}
        {canArea('partners') ? <Route path="kyc" element={<KycPage />} /> : null}
        {canArea('content') ? <Route path="events/:id" element={<EventEditPage />} /> : null}
        {canArea('content') ? <Route path="events/:id/sales" element={<EventSalesPage />} /> : null}
        <Route path="nothing" element={<Notice tone="info">Your access doesn’t include any part of this dashboard yet. Ask a VIBE admin.</Notice>} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
