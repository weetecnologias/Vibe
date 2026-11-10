import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/api';

import { secondsUntil } from './dates';

export type AsyncState<T> = {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (updater: (prev: T | undefined) => T | undefined) => void;
};

type Result<T> = { key: string; data: T | undefined; error: string | null };

/**
 * Loads data on mount and whenever `deps` change; ignores stale responses.
 * Keeps the previous data visible while a refresh is in flight.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([deps, tick]);
  const [result, setResult] = useState<Result<T>>({ key: '', data: undefined, error: null });

  useEffect(() => {
    let current = true;
    fn().then(
      (data) => { if (current) setResult({ key, data, error: null }); },
      (e) => { if (current) setResult((r) => ({ key, data: r.data, error: errorMessage(e) })); },
    );
    return () => { current = false; };
    // `key` already encodes deps and reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const setData = useCallback((u: (prev: T | undefined) => T | undefined) => setResult((r) => ({ ...r, data: u(r.data) })), []);
  const fresh = result.key === key;
  return { data: result.data, error: fresh ? result.error : null, loading: !fresh, reload, setData };
}

/** Seconds left until `iso`, ticking every second. */
export function useCountdown(iso: string | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!iso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [iso]);
  return iso ? secondsUntil(iso, now) : null;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong.';
}

/** A fresh idempotency key per payment attempt. */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'idem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}
