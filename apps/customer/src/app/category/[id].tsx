import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type BusinessSummary, type CategoryNode, type OfferSummary, type OfferView } from '@/api';
import { BusinessCard, OfferCard } from '@/components/cards';
import { BackButton, Button, Chip, EmptyState, ErrorState, Icon, IconButton, LoadingState, Photo, T } from '@/components/ui';
import { useAsync } from '@/lib/useAsync';
import { EMPTY_PAGE, usePaged } from '@/lib/usePaged';
import { useSession } from '@/state/session';
import { colors } from '@/theme/tokens';

/**
 * Finds a node and its ancestors in the admin-managed category tree, by id or by slug. Links inside the app use slugs (`/category/offers`,
 * `/category/movies`); the demo's ids are those slugs, while the live API's ids are opaque, so both have to match.
 */
function locate(tree: CategoryNode[], id: string): CategoryNode[] | null {
  for (const n of tree) {
    if (n.id === id || n.slug === id) return [n];
    const sub = locate(n.children, id);
    if (sub) return [n, ...sub];
  }
  return null;
}

type Results = { kind: 'offers'; items: OfferSummary[] } | { kind: 'places'; items: BusinessSummary[] } | null;

const OFFER_VIEWS: Record<string, OfferView> = {
  'offers.all': 'all', 'offers.nearby': 'nearby', 'offers.trending': 'trending', 'offers.new': 'new', 'offers.ending': 'ending', 'offers.member': 'member',
};

export default function CategoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { area } = useSession();
  const tree = useAsync(() => api.getCategories(), []);

  const path = useMemo(() => (tree.data ? locate(tree.data, id) : null), [tree.data, id]);
  const root = path?.[0];
  // `undefined` = follow the deep link (e.g. /category/fitness.sports) until the user picks something.
  const [sel, setSel] = useState<{ sub: string | null; leaf: string | null }>();
  const [openNow, setOpenNow] = useState(false);
  const [memberOffers, setMemberOffers] = useState(false);

  const effectiveSub = sel ? sel.sub : path?.[1]?.id ?? null;
  const effectiveLeaf = sel ? sel.leaf : path?.[2]?.id ?? null;
  const setSub = (sub: string | null) => setSel({ sub, leaf: null });
  const setLeaf = (leaf: string | null) => setSel({ sub: effectiveSub, leaf });
  const subNode = root?.children.find((c) => c.id === effectiveSub) ?? null;
  const target = effectiveLeaf ?? effectiveSub ?? root?.id ?? id;
  const isOffers = root?.id === 'offers' || root?.slug === 'offers';
  // Which offers list a subcategory shows: the demo keys by id (offers.all), the live API by slug (offers.all).
  const targetNode = tree.data ? locate(tree.data, target)?.at(-1) : undefined;
  const offerView = OFFER_VIEWS[target] ?? (targetNode ? OFFER_VIEWS[targetNode.slug] : undefined) ?? 'all';

  const places = usePaged<BusinessSummary>(
    (offset) => (!root || isOffers
      ? Promise.resolve(EMPTY_PAGE)
      : api.searchBusinessesPage({ categoryId: target, openNow: openNow || undefined, memberOffers: memberOffers || undefined, sort: 'popular' }, offset)),
    [root?.id, target, openNow, memberOffers, isOffers],
  );
  const results = useAsync<Results>(
    () => (!root || !isOffers ? Promise.resolve(null) : api.getOffers(offerView).then((o) => ({ kind: 'offers' as const, items: o }))),
    [root?.id, target, isOffers, offerView],
  );
  const loading = isOffers ? results.loading : places.loading;
  const error = isOffers ? results.error : places.error;
  const reload = isOffers ? results.reload : places.reload;

  const label = (subNode && effectiveLeaf ? subNode.children.find((c) => c.id === effectiveLeaf)?.name : subNode?.name) ?? root?.name ?? '';
  const count = isOffers ? results.data?.items.length ?? 0 : places.total ?? 0;
  const shown = places.data?.length ?? 0;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.softWhite }} contentContainerStyle={{ paddingBottom: 32 }}>
      <Photo uri={subNode?.imageUrl ?? root?.imageUrl} seed={root?.id ?? id} scrim={0.58} style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <View style={styles.headerRow}>
          <View style={{ marginLeft: -10 }}><BackButton tone="dark" fallback="/home" /></View>
          <IconButton icon="search" label="Search" tone="dark" onPress={() => router.push('/discover')} />
        </View>
        <T variant="label" color={colors.onDarkMuted}>Category</T>
        <T variant="display" color={colors.white} accessibilityRole="header">{root?.name ?? ' '}</T>
        <T variant="caption" color={colors.onDarkMuted}>{subNode ? `${subNode.name} · ` : ''}Near {area}</T>
      </Photo>

      {root && root.children.length && !effectiveSub && !isOffers ? (
        <View style={{ gap: 12, paddingTop: 20 }}>
          <T variant="headline" style={{ paddingHorizontal: 20 }}>Browse by type</T>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 20 }}>
            {root.children.map((c) => (
              <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={c.name} onPress={() => setSub(c.id)}>
                <Photo uri={c.imageUrl} seed={c.id} scrim={0.42} radius={18} style={styles.typeTile}>
                  <T variant="captionStrong" color={colors.white} numberOfLines={2}>{c.name}</T>
                </Photo>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {tree.error ? <ErrorState message={tree.error} onRetry={tree.reload} /> : null}
      {tree.data && !root ? <EmptyState title="Category not found" message="It may have been renamed or removed." /> : null}

      {root && root.children.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist">
          <Chip label="All" tone="pink" selected={!effectiveSub} onPress={() => setSub(null)} />
          {root.children.map((c) => (
            <Chip key={c.id} label={c.name} tone="pink" selected={effectiveSub === c.id} onPress={() => setSub(c.id)} />
          ))}
        </ScrollView>
      ) : null}

      {subNode && subNode.children.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.leaves}>
          {[{ id: null as string | null, name: `All ${subNode.name.toLowerCase()}` }, ...subNode.children].map((c) => {
            const on = effectiveLeaf === c.id;
            return (
              <Pressable key={c.id ?? 'all'} accessibilityRole="button" accessibilityState={{ selected: on }} aria-selected={on} onPress={() => setLeaf(c.id)} style={[styles.leaf, on && styles.leafOn]}>
                <T variant="captionStrong" color={on ? colors.nearBlack : colors.mutedGrey}>{c.name}</T>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {!isOffers && root ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, { paddingTop: 14 }]}>
          <Chip label="Open now" selected={openNow} onPress={() => setOpenNow((v) => !v)} />
          <Chip label="Member offers" selected={memberOffers} onPress={() => setMemberOffers((v) => !v)} />
        </ScrollView>
      ) : null}

      {!isOffers && root ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/membership')} style={styles.memberBanner}>
          <View style={styles.memberIcon}><Icon name="offer" size={18} color={colors.white} strokeWidth={2} /></View>
          <T variant="caption" style={{ flex: 1 }}><T variant="captionStrong">Member-exclusive offers</T> in {label}. Pay through VIBE to apply them.</T>
          <Icon name="chevronRight" size={18} color={colors.pinkDeep} strokeWidth={2} />
        </Pressable>
      ) : null}

      {root ? (
        <View style={styles.countRow}>
          <T variant="caption" color={colors.mutedGrey}><T variant="captionStrong">{loading ? '…' : count} {isOffers ? (count === 1 ? 'offer' : 'offers') : count === 1 ? 'place' : 'places'}</T> · {label}</T>
        </View>
      ) : null}

      <View style={{ paddingHorizontal: 20, gap: 14 }}>
        {error ? <ErrorState message={error} onRetry={reload} /> : null}
        {loading && !(isOffers ? results.data : places.data) ? <LoadingState rows={2} /> : null}
        {!loading && (isOffers ? results.data : places.data) && count === 0 ? (
          <EmptyState icon="search" title={`No ${isOffers ? 'offers' : 'places'} here yet`} message="We’re adding new businesses every week. Try another subcategory." />
        ) : null}
        {!isOffers ? places.data?.map((b) => <BusinessCard key={b.id} b={b} />) : null}
        {!isOffers && places.hasMore ? <Button label={`Show more (${Math.max(0, count - shown)} left)`} variant="outline" onPress={places.loadMore} loading={places.loadingMore} /> : null}
        {results.data?.kind === 'offers' ? results.data.items.map((o) => <OfferCard key={o.id} o={o} width="100%" />) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingBottom: 22, gap: 6, minHeight: 210 },
  typeTile: { width: 132, height: 96, padding: 12, justifyContent: 'flex-end' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  chips: { gap: 8, paddingHorizontal: 20, paddingTop: 16 },
  leaves: { gap: 18, paddingHorizontal: 20, paddingTop: 14, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  leaf: { paddingTop: 4, paddingBottom: 12, borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  leafOn: { borderBottomColor: colors.nearBlack },
  memberBanner: { marginHorizontal: 20, marginTop: 16, padding: 14, borderRadius: 18, backgroundColor: colors.pinkTint, flexDirection: 'row', alignItems: 'center', gap: 12 },
  memberIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center' },
  countRow: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
});
