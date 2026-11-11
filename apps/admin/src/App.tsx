import { Navigate, Route, Routes } from 'react-router-dom';

import { LoginPage, Shell, useAuth } from '@kit';

import { AuditPage } from './pages/AuditPage';
import { BusinessEditPage } from './pages/BusinessEditPage';
import { BusinessesPage } from './pages/BusinessesPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { StaffPage } from './pages/StaffPage';

const NAV = [
  { to: '/categories', label: 'Categories' },
  { to: '/businesses', label: 'Businesses' },
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
        <Route path="staff" element={<StaffPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="*" element={<Navigate to="/categories" replace />} />
      </Route>
    </Routes>
  );
}
