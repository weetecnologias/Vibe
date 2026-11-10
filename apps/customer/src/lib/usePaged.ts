import { useState } from 'react';

import type { Page } from '@/api';

import { errorMessage, useAsync } from './useAsync';

export const EMPTY_PAGE: Page<never> = { items: [], total: 0, nextOffset: null };

type Extra<T> = { key: string; items: T[]; nextOffset: number | null };

/**
 * A long list loaded one page at a time. The first page loads whenever `deps`
 * change; `loadMore` appends the next page. Pages loaded for an older search
 * are ignored, so a slow response can never mix into new results.
 */
export function usePaged<T>(fetchPage: (offset: number) => Promise<Page<T>>, deps: unknown[]) {
  const first = useAsync(() => fetchPage(0), deps);
  const key = JSON.stringify(deps);
  const [extra, setExtra] = useState<Extra<T> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const mine = extra && extra.key === key ? extra : null;
  const items = first.data ? [...first.data.items, ...(mine?.items ?? [])] : undefined;
  const nextOffset = mine ? mine.nextOffset : first.data?.nextOffset ?? null;

  async function loadMore() {
    if (nextOffset === null || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const p = await fetchPage(nextOffset);
      setExtra((prev) => ({ key, items: [...(prev && prev.key === key ? prev.items : []), ...p.items], nextOffset: p.nextOffset }));
    } catch (e) {
      setMoreError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  }

  return {
    data: items,
    total: first.data?.total,
    loading: first.loading,
    loadingMore,
    error: first.error ?? moreError,
    reload: first.reload,
    loadMore,
    hasMore: nextOffset !== null,
  };
}
