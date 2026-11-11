import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { AuthProvider } from '@kit';

import '../../../packages/backoffice-kit/src/styles.css';
import { App } from './App';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider role="ADMIN" baseUrl={baseUrl}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
