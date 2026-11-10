import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Small key-value store. Native: Keychain / Keystore via expo-secure-store.
 * Web: localStorage (acceptable for development builds; production web should
 * use httpOnly cookies issued by the backend instead).
 */
const web = {
  get: async (k: string) => {
    try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; }
  },
  set: async (k: string, v: string) => {
    try { globalThis.localStorage?.setItem(k, v); } catch { /* storage unavailable */ }
  },
  del: async (k: string) => {
    try { globalThis.localStorage?.removeItem(k); } catch { /* storage unavailable */ }
  },
};

const native = {
  get: (k: string) => SecureStore.getItemAsync(k),
  set: (k: string, v: string) => SecureStore.setItemAsync(k, v),
  del: (k: string) => SecureStore.deleteItemAsync(k),
};

export const kv = Platform.OS === 'web' ? web : native;

const KEYS = { access: 'vibe.accessToken', refresh: 'vibe.refreshToken', session: 'vibe.session' } as const;

export const tokenStore = {
  getAccessToken: () => kv.get(KEYS.access),
  async save(access: string, refresh: string) {
    await kv.set(KEYS.access, access);
    await kv.set(KEYS.refresh, refresh);
  },
  async clear() {
    await kv.del(KEYS.access);
    await kv.del(KEYS.refresh);
  },
};

export type PersistedSession = { onboarded: boolean; guest: boolean; area: string | null };

export const sessionStore = {
  async load(): Promise<PersistedSession | null> {
    const raw = await kv.get(KEYS.session);
    if (!raw) return null;
    try { return JSON.parse(raw) as PersistedSession; } catch { return null; }
  },
  save: (s: PersistedSession) => kv.set(KEYS.session, JSON.stringify(s)),
  clear: () => kv.del(KEYS.session),
};
