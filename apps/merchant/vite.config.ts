import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const here = import.meta.dirname;
const mod = (p: string) => path.resolve(here, 'node_modules', p);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@kit': path.resolve(here, '../../packages/backoffice-kit/src/index.ts'),
      // The shared kit lives outside this app, so make it use this app's copy of React.
      react: mod('react'),
      'react-dom': mod('react-dom'),
      'react-router-dom': mod('react-router-dom'),
    },
  },
  server: { fs: { allow: [path.resolve(here, '../..')] } },
  test: {
    // Also runs the shared kit's tests (money, form drafts) from here.
    include: ['src/**/*.test.{ts,tsx}', '../../packages/backoffice-kit/src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
