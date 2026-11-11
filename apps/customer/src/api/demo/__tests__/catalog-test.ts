import type { CategoryNode } from '../../types';
import { businesses, categories, events, offers } from '../catalog';
import { imageKeys } from '../images';
import { socialActivities, socialGroups } from '../social';

const all: CategoryNode[] = [];
(function walk(nodes: CategoryNode[]) { for (const n of nodes) { all.push(n); walk(n.children); } })(categories);

const matches = (id: string) => businesses.filter((b) => b.categoryIds.some((c) => c === id || c.startsWith(id + '.')));

describe('demo catalogue', () => {
  const businessRoots = ['food', 'shopping', 'fitness', 'beauty', 'kids', 'movies'];

  it.each(all.filter((n) => businessRoots.includes(n.id.split('.')[0])).map((n) => [n.id, n.name]))(
    'has at least one business in %s (%s)', (id) => {
      expect(matches(id).length).toBeGreaterThan(0);
    },
  );

  it('has an event for every Events & Experiences subcategory', () => {
    const kinds = new Set(events.map((e) => e.kind));
    for (const k of ['Workshops', 'Meetups', 'Tours', 'Live Events', 'Experiences']) expect(kinds).toContain(k);
  });

  it('has something in every VIBE Social section', () => {
    expect(socialActivities.some((a) => a.section === 'activity')).toBe(true);
    expect(socialActivities.some((a) => a.section === 'social_event')).toBe(true);
    expect(socialGroups.some((g) => g.kind === 'group')).toBe(true);
    expect(socialGroups.some((g) => g.kind === 'community')).toBe(true);
  });

  it('gives every category, business, offer and event a photo', () => {
    expect(all.filter((n) => !n.imageUrl).map((n) => n.id)).toEqual([]);
    expect(businesses.filter((b) => !b.coverUrl || b.photos.length === 0).map((b) => b.id)).toEqual([]);
    expect(offers.filter((o) => !o.coverUrl).map((o) => o.id)).toEqual([]);
    expect(events.filter((e) => !e.coverUrl).map((e) => e.id)).toEqual([]);
    expect(imageKeys.length).toBeGreaterThan(80);
  });

  it('uses unique ids and points offers at real businesses', () => {
    const ids = businesses.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    const offerIds = offers.map((o) => o.id);
    expect(new Set(offerIds).size).toBe(offerIds.length);
    for (const o of offers) expect(ids).toContain(o.businessId);
  });

  it('marks every card offer badge with a redeemable offer', () => {
    const withOffer = new Set(offers.map((o) => o.businessId));
    expect(businesses.filter((b) => b.offerBadge && !withOffer.has(b.id)).map((b) => b.id)).toEqual([]);
  });

  it('adds parental-consent terms to every Kids & Family listing', () => {
    for (const b of businesses.filter((x) => x.primaryCategoryId.startsWith('kids'))) {
      expect(b.terms.join(' ')).toMatch(/consent/i);
    }
  });
});
