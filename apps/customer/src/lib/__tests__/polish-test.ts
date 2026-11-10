import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { MenuItem, Page } from '@/api';
import { createDemoApi } from '@/api/demo/demoApi';
import { initialsOf } from '@/components/BusinessLogo';
import { iconPaths, resolveIconName } from '@/components/ui/Icon';

import { groupMenu } from '../menu';
import { usePaged } from '../usePaged';

describe('resolveIconName', () => {
  it('keeps built-in icon names', () => {
    expect(resolveIconName('food')).toBe('food');
    expect(resolveIconName('ticket')).toBe('ticket');
  });

  it('falls back to a default icon for unknown, empty or missing names', () => {
    for (const bad of ['pet-care', '', undefined, null, 'toString', '__proto__']) {
      const name = resolveIconName(bad);
      expect(name).toBe('sparkle');
      expect(iconPaths[name]).toBeTruthy(); // never renders blank
    }
  });
});

describe('initialsOf', () => {
  it('uses up to two initials', () => {
    expect(initialsOf('Saffron Courtyard')).toBe('SC');
    expect(initialsOf('Brew & Bloom Café')).toBe('BB');
    expect(initialsOf('pulse')).toBe('P');
    expect(initialsOf('  ')).toBe('');
  });
});

describe('groupMenu', () => {
  const item = (id: string, name: string, section?: string, note = ''): MenuItem => ({ id, name, note, price: 10000, section });

  it('returns one untitled group when nothing has a section', () => {
    const g = groupMenu([item('1', 'A'), item('2', 'B')]);
    expect(g).toHaveLength(1);
    expect(g[0].title).toBeNull();
  });

  it('groups by section in the order the merchant listed them', () => {
    const g = groupMenu([item('1', 'Soup', 'Starters'), item('2', 'Biryani', 'Mains'), item('3', 'Kebab', 'Starters'), item('4', 'Water')]);
    expect(g.map((x) => x.title)).toEqual(['Starters', 'Mains', 'Other']);
    expect(g[0].items.map((i) => i.name)).toEqual(['Soup', 'Kebab']);
  });

  it('searches names, notes and section names, ignoring case', () => {
    const menu = [item('1', 'Dum biryani', 'Mains', 'Chicken'), item('2', 'Gulab jamun', 'Desserts'), item('3', 'Paneer', 'Mains', 'Spicy')];
    expect(groupMenu(menu, 'BIRYANI').flatMap((g) => g.items.map((i) => i.id))).toEqual(['1']);
    expect(groupMenu(menu, 'spicy').flatMap((g) => g.items.map((i) => i.id))).toEqual(['3']);
    expect(groupMenu(menu, 'dessert').flatMap((g) => g.items.map((i) => i.id))).toEqual(['2']);
    expect(groupMenu(menu, 'zzz')).toEqual([]);
  });

  it('handles a very large menu', () => {
    const menu = Array.from({ length: 5000 }, (_, i) => item(String(i), `Dish ${i}`, `Section ${i % 25}`));
    const g = groupMenu(menu);
    expect(g).toHaveLength(25);
    expect(g.reduce((n, x) => n + x.items.length, 0)).toBe(5000);
    expect(groupMenu(menu, 'dish 4999').flatMap((x) => x.items)).toHaveLength(1);
  });
});

describe('paged business search (demo backend)', () => {
  it('returns pages that add up to the full result, with no duplicates', async () => {
    const api = createDemoApi({ latency: 0 });
    const all = await api.searchBusinesses({ sort: 'popular' });
    const first = await api.searchBusinessesPage({ sort: 'popular' }, 0, 12);
    expect(first.items).toHaveLength(12);
    expect(first.total).toBe(all.length);
    expect(first.nextOffset).toBe(12);

    const ids = [...first.items.map((b) => b.id)];
    let next = first.nextOffset;
    let guard = 0;
    while (next !== null && guard++ < 50) {
      const p = await api.searchBusinessesPage({ sort: 'popular' }, next, 12);
      ids.push(...p.items.map((b) => b.id));
      next = p.nextOffset;
    }
    expect(ids).toEqual(all.map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('marks the last page and handles paging past the end', async () => {
    const api = createDemoApi({ latency: 0 });
    const total = (await api.searchBusinesses({})).length;
    const last = await api.searchBusinessesPage({}, Math.floor((total - 1) / 12) * 12, 12);
    expect(last.nextOffset).toBeNull();
    expect((await api.searchBusinessesPage({}, 9999, 12)).items).toEqual([]);
  });

  it('applies filters before paging', async () => {
    const api = createDemoApi({ latency: 0 });
    const p = await api.searchBusinessesPage({ categoryId: 'shopping.footwear.kids-footwear' }, 0, 12);
    expect(p.total).toBe(1);
    expect(p.items[0].name).toBe('Little Steps');
    expect(p.nextOffset).toBeNull();
  });
});

describe('usePaged', () => {
  const numbers = Array.from({ length: 25 }, (_, i) => i);
  const fetchPage = (q: string) => async (offset: number): Promise<Page<number>> => {
    const list = q === 'none' ? [] : numbers;
    const items = list.slice(offset, offset + 10);
    return { items, total: list.length, nextOffset: offset + 10 < list.length ? offset + 10 : null };
  };

  it('loads the first page, then appends more until the end', async () => {
    const { result } = await renderHook(() => usePaged(fetchPage('all'), ['all']));
    await waitFor(() => expect(result.current.data).toHaveLength(10));
    expect(result.current.total).toBe(25);
    expect(result.current.hasMore).toBe(true);

    await act(async () => { await result.current.loadMore(); });
    expect(result.current.data).toHaveLength(20);
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.data).toEqual(numbers);
    expect(result.current.hasMore).toBe(false);

    await act(async () => { await result.current.loadMore(); }); // no-op past the end
    expect(result.current.data).toHaveLength(25);
  });

  it('starts over when the search changes', async () => {
    const { result, rerender } = await renderHook(({ q }: { q: string }) => usePaged(fetchPage(q), [q]), { initialProps: { q: 'all' } });
    await waitFor(() => expect(result.current.data).toHaveLength(10));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.data).toHaveLength(20);

    await rerender({ q: 'none' });
    await waitFor(() => expect(result.current.total).toBe(0));
    expect(result.current.data).toEqual([]);
    expect(result.current.hasMore).toBe(false);
  });
});
