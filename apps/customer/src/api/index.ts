import { createHttpApi, type VibeApi } from './client';
import { createDemoApi } from './demo/demoApi';
import { tokenStore } from '@/lib/storage';

export { ApiError } from './client';
export type { VibeApi } from './client';
export * from './types';

/**
 * API mode:
 *  - EXPO_PUBLIC_API_MODE=http with EXPO_PUBLIC_API_URL → the real backend.
 *  - otherwise demo in development builds only.
 * Release builds never fall back to demo silently.
 */
function resolveMode(): 'demo' | 'http' {
  const env = process.env.EXPO_PUBLIC_API_MODE;
  if (env === 'http' || env === 'demo') return env;
  return __DEV__ ? 'demo' : 'http';
}

export const apiMode = resolveMode();

export const api: VibeApi =
  apiMode === 'http'
    ? createHttpApi(process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8080', tokenStore)
    : createDemoApi({ tokens: tokenStore });
