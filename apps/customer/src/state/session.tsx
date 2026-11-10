import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, ApiError, type OtpChallenge, type User } from '@/api';
import { sessionStore, tokenStore, type PersistedSession } from '@/lib/storage';

export type SessionStatus = 'loading' | 'signedOut' | 'guest' | 'signedIn';

type SessionValue = {
  status: SessionStatus;
  user: User | null;
  area: string | null;
  onboarded: boolean;
  challenge: (OtpChallenge & { phone: string }) | null;
  completeOnboarding(): Promise<void>;
  continueAsGuest(): Promise<void>;
  requestOtp(phone: string): Promise<OtpChallenge>;
  verifyOtp(code: string): Promise<User>;
  setArea(area: string): Promise<void>;
  refreshUser(): Promise<void>;
  signOut(): Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

const empty: PersistedSession = { onboarded: false, guest: false, area: null };

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [persisted, setPersisted] = useState<PersistedSession>(empty);
  const [challenge, setChallenge] = useState<SessionValue['challenge']>(null);

  const persist = useCallback(async (next: PersistedSession) => {
    setPersisted(next);
    await sessionStore.save(next);
  }, []);

  // Restore on launch: a stored token is only trusted if the backend accepts it.
  useEffect(() => {
    (async () => {
      const saved = (await sessionStore.load()) ?? empty;
      setPersisted(saved);
      const token = await tokenStore.getAccessToken();
      if (token) {
        try {
          const me = await api.me();
          setUser(me);
          setStatus('signedIn');
          return;
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) await tokenStore.clear();
        }
      }
      setStatus(saved.guest ? 'guest' : 'signedOut');
    })();
  }, []);

  const value = useMemo<SessionValue>(() => ({
    status,
    user,
    area: persisted.area ?? user?.area ?? null,
    onboarded: persisted.onboarded,
    challenge,
    async completeOnboarding() {
      await persist({ ...persisted, onboarded: true });
    },
    async continueAsGuest() {
      await persist({ ...persisted, onboarded: true, guest: true });
      setStatus('guest');
    },
    async requestOtp(phone) {
      const c = await api.requestOtp(phone);
      setChallenge({ ...c, phone });
      return c;
    },
    async verifyOtp(code) {
      if (!challenge) throw new ApiError('Request a new code first.', 400, 'no_challenge');
      const res = await api.verifyOtp(challenge.requestId, code);
      await tokenStore.save(res.accessToken, res.refreshToken);
      await persist({ ...persisted, onboarded: true, guest: false });
      setChallenge(null);
      setUser(res.user);
      setStatus('signedIn');
      return res.user;
    },
    async setArea(area) {
      await persist({ ...persisted, area });
      if (status === 'signedIn') {
        try { setUser(await api.updateMe({ area })); } catch { /* area is kept locally; synced next time */ }
      }
    },
    async refreshUser() {
      if (status === 'signedIn') setUser(await api.me());
    },
    async signOut() {
      try { await api.logout(); } catch { /* sign out locally regardless */ }
      await tokenStore.clear();
      await persist({ onboarded: true, guest: false, area: persisted.area });
      setUser(null);
      setStatus('signedOut');
    },
  }), [status, user, persisted, challenge, persist]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
