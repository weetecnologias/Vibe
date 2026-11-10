import type { MenuItem } from '@/api';

export type MenuGroup = { title: string | null; items: MenuItem[] };

/**
 * Groups a menu into its sections ("Starters", "Mains"…) in the order the
 * merchant listed them, after filtering by a search text. A menu with no
 * sections comes back as one untitled group; items without a section that sit
 * beside sectioned ones go under "Other".
 */
export function groupMenu(menu: MenuItem[], query = ''): MenuGroup[] {
  const q = query.trim().toLowerCase();
  const items = q ? menu.filter((m) => `${m.name} ${m.note} ${m.section ?? ''}`.toLowerCase().includes(q)) : menu;
  if (items.length === 0) return [];
  if (!items.some((m) => m.section)) return [{ title: null, items }];
  const groups = new Map<string, MenuItem[]>();
  for (const m of items) {
    const key = m.section ?? 'Other';
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups].map(([title, list]) => ({ title, items: list }));
}
