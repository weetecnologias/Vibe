import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type CategoryNode, type NearbyOffer, type NearbyOfferQuery, type OfferSort, type Promotion } from '@/api';
import { Badge, Button, EmptyState, ErrorState, Icon, LoadingState, Photo, T } from '@/components/ui';
import { Chip } from '@/components/ui/Chip';
import { daysUntil } from '@/lib/dates';
import { useAsync } from '@/lib/useAsync';
import { usePaged } from '@/lib/usePaged';
import { useSession } from '@/state/session';
import { colors, fonts, radius } from '@/theme/tokens';

type Section = 'offers' | 'promotions';
const SORTS: { key: OfferSort; label: string }[] = [{ key: 'nearest', label: 'Nearest' }, { key: 'saving', label: 'Biggest saving' }, { key: 'ending', label: 'Ending soon' }];
/** VIBE Social has its own tab. */
const HIDDEN = new Set(['social']);
/**
 * "Offers & Benefits" isn't a kind of place: it cuts every offer a different way. Its subcategories become presets here (all places, nearest, biggest
 * saving, newest, ending soon, members only), and in Promotions it shows the promotions that lead to an offer.
 */
const OFFER_PRESETS: Record<string, { sort?: OfferSort; members?: boolean }> = {
  'offers.all': {}, 'offers.nearby': { sort: 'nearest' }, 'offers.trending': { sort: 'saving' }, 'offers.new': { sort: 'new' }, 'offers.ending': { sort: 'ending' }, 'offers.member': { members: true },
};
type Filters = { openNow: boolean; near: boolean; members: boolean };
const NO_FILTERS: Filters = { openNow: false, near: false, members: false };

/**
 * Discover has two parts. Offers near you: every offer at places around you, by category (Food & Dining, then Cafés; Fitness, then Sports…),
 * nearest first, with filters for open now, distance and member offers. Promotions: places promoting themselves, reviewed by VIBE.
 */
export default function Discover() {
  const insets = useSafeAreaInsets();
  const { area } = useSession();
  const [section, setSection] = useState<Section>('offers');
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [top, setTop] = useState<CategoryNode | null>(null);
  const [sub, setSub] = useState<CategoryNode | null>(null);
  const [sort, setSort] = useState<OfferSort>('nearest');
  const [f, setF] = useState<Filters>(NO_FILTERS);

  useEffect(() => {
    const t = setTimeout(() => setQ(text), 300);
    return () => clearTimeout(t);
  }, [text]);

  const cats = useAsync(() => api.getCategories(), []);
  const tops = (cats.data ?? []).filter((c) => !HIDDEN.has(c.slug));
  const isOffersCat = top?.slug === 'offers';
  const preset = isOffersCat && sub ? OFFER_PRESETS[sub.slug] ?? OFFER_PRESETS[sub.id] ?? {} : {};
  // Offers & Benefits looks across every kind of place, so it doesn't narrow to a category.
  const category = isOffersCat ? undefined : sub?.id ?? top?.id;

  const query: NearbyOfferQuery = { category, q: q.trim() || undefined, sort: preset.sort ?? sort, openNow: f.openNow || undefined, maxDistanceKm: f.near ? 3 : undefined, memberOnly: f.members || preset.members || undefined };
  const offers = usePaged<NearbyOffer>((offset) => api.getNearbyOffers(query, offset), [JSON.stringify(query)]);
  const promos = useAsync(async () => {
    if (section !== 'promotions') return [] as Promotion[];
    const list = await api.getPromotions(category);
    return isOffersCat ? list.filter((p) => p.offerId) : list; // under Offers & Benefits: the promotions that lead to an offer
  }, [section, category, isOffersCat]);

  const active = Object.values(f).filter(Boolean).length;
  const toggle = (k: keyof Filters) => setF((s) => ({ ...s, [k]: !s[k] }));
  const nextSort = () => setSort((s) => SORTS[(SORTS.findIndex((x) => x.key === s) + 1) % SORTS.length].key);
  const pickTop = (c: CategoryNode | null) => { setTop(c); setSub(null); };
  const where = sub?.name ?? top?.name;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.softWhite }} stickyHeaderIndices={[0]} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.titleRow}>
          <T variant="title1" accessibilityRole="header">Discover</T>
          <Pressable accessibilityRole="button" accessibilityLabel={`Area: ${area}. Change`} onPress={() => router.push('/location')} style={styles.area} hitSlop={8}>
            <Icon name="pin" size={16} color={colors.pink} strokeWidth={2} />
            <T variant="captionStrong">{area}</T>
          </Pressable>
        </View>

        <View style={styles.segment} accessibilityRole="tablist">
          {([['offers', 'Offers near you'], ['promotions', 'Promotions']] as const).map(([k, label]) => (
            <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: section === k }} aria-selected={section === k} onPress={() => setSection(k)} style={[styles.segBtn, section === k && styles.segOn]}>
              <T variant="bodyStrong" color={section === k ? colors.white : colors.nearBlack} style={{ fontSize: 14 }}>{label}</T>
            </Pressable>
          ))}
        </View>

        {section === 'offers' ? (
          <View style={styles.search}>
            <Icon name="search" size={20} />
            <TextInput value={text} onChangeText={setText} placeholder="Search places, offers or areas" placeholderTextColor={colors.mutedGrey} accessibilityLabel="Search offers" returnKeyType="search" style={styles.input} />
            {text ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setText('')} hitSlop={10}><Icon name="close" size={18} color={colors.mutedGrey} /></Pressable>
            ) : null}
          </View>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: top?.children.length ? 0 : 12 }} accessibilityLabel="Categories">
          <Chip label="All" tone="pink" selected={!top} onPress={() => pickTop(null)} />
          {tops.map((c) => <Chip key={c.id} label={c.name} tone="pink" selected={top?.id === c.id} onPress={() => pickTop(c)} />)}
        </ScrollView>
        {top?.children.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }} accessibilityLabel={`${top.name} categories`}>
            <Chip label={`All ${top.name}`} selected={!sub} onPress={() => setSub(null)} />
            {top.children.map((c) => <Chip key={c.id} label={c.name} selected={sub?.id === c.id} onPress={() => setSub(c)} />)}
          </ScrollView>
        ) : null}
      </View>

      {section === 'offers' ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingTop: 14 }}>
            <Chip label={`Sort: ${SORTS.find((s) => s.key === sort)!.label}`} icon="chevronDown" onPress={nextSort} />
            <Chip label="Open now" selected={f.openNow} onPress={() => toggle('openNow')} />
            <Chip label="Within 3 km" selected={f.near} onPress={() => toggle('near')} />
            <Chip label="Member offers" selected={f.members} onPress={() => toggle('members')} />
          </ScrollView>
          <View style={styles.resultsRow}>
            <T variant="caption" color={colors.mutedGrey}>
              <T variant="captionStrong">{offers.loading && !offers.data ? 'Finding offers…' : `${offers.total ?? 0} ${offers.total === 1 ? 'offer' : 'offers'}`}</T>
              {where ? ` in ${where}` : ' near you'}{active ? ` · ${active} filter${active > 1 ? 's' : ''}` : ''}
            </T>
          </View>
          <View style={{ paddingHorizontal: 20, gap: 12 }}>
            {offers.error ? <ErrorState message={offers.error} onRetry={offers.reload} /> : null}
            {offers.loading && !offers.data ? <LoadingState rows={3} /> : null}
            {!offers.loading && !offers.error && offers.data?.length === 0 ? (
              <EmptyState icon="offer" title="No offers here yet" message={active || q ? 'Try removing a filter or searching for something broader.' : 'Try another category, or check back soon.'}
                actionLabel={active ? 'Clear filters' : undefined} onAction={() => setF(NO_FILTERS)} />
            ) : null}
            {offers.data?.map((o) => <NearbyOfferRow key={o.id} o={o} />)}
            {offers.hasMore ? <Button label={`Show more (${Math.max(0, (offers.total ?? 0) - (offers.data?.length ?? 0))} left)`} variant="outline" onPress={offers.loadMore} loading={offers.loadingMore} /> : null}
          </View>
        </>
      ) : (
        <View style={{ paddingHorizontal: 20, gap: 14, paddingTop: 16 }}>
          <T variant="caption" color={colors.mutedGrey}>Places near you, telling you what’s new.{where ? ` In ${where}.` : ''}</T>
          {promos.error ? <ErrorState message={promos.error} onRetry={promos.reload} /> : null}
          {promos.loading && !promos.data ? <LoadingState rows={2} /> : null}
          {promos.data?.length === 0 ? <EmptyState icon="sparkle" title="No promotions here right now" message="Try another category, or see Offers near you." actionLabel="See offers" onAction={() => setSection('offers')} /> : null}
          {promos.data?.map((p) => <PromotionCard key={p.id} p={p} />)}
        </View>
      )}
    </ScrollView>
  );
}

function NearbyOfferRow({ o }: { o: NearbyOffer }) {
  const days = daysUntil(o.endsAt);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${o.headline} ${o.headlineSub}: ${o.title} at ${o.businessName}, ${o.distanceKm} kilometres, ${o.status.label}`}
      onPress={() => router.push(`/offer/${o.id}`)} style={styles.offer}>
      <View style={styles.offerLeft}>
        <T style={styles.offerBig}>{o.headline}</T>
        <T variant="label" color={colors.pinkDeep}>{o.headlineSub}</T>
      </View>
      <View style={{ flex: 1, padding: 12, gap: 3 }}>
        <T variant="bodyStrong" numberOfLines={2}>{o.title}</T>
        <T variant="caption" numberOfLines={1}>{o.businessName}</T>
        <T variant="small" color={colors.mutedGrey} numberOfLines={1}>{o.categoryLabel} · {o.area} · {o.distanceKm} km</T>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          <T variant="small" color={o.status.open ? colors.success : colors.mutedGrey} style={{ fontFamily: fonts.semibold }}>{o.status.open ? 'Open now' : o.status.label}</T>
          {o.memberOnly ? <Badge label="Members" tone="pinkSoft" /> : null}
          {days <= 7 ? <Badge label={`Ends in ${days} day${days === 1 ? '' : 's'}`} tone="warning" /> : null}
        </View>
      </View>
    </Pressable>
  );
}

function PromotionCard({ p }: { p: Promotion }) {
  const open = () => {
    void api.tapPromotion(p.id);
    router.push(p.offerId ? `/offer/${p.offerId}` : `/business/${p.businessId}`);
  };
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Promotion from ${p.businessName}: ${p.title}`} onPress={open} style={styles.promo}>
      <Photo uri={p.imageUrl} seed={p.id} style={{ height: 150 }} accessibilityLabel={`Photo from ${p.businessName}`}>
        <View style={styles.promoTag}><T variant="label" color={colors.white}>Promoted</T></View>
      </Photo>
      <View style={{ padding: 14, gap: 4 }}>
        <T variant="small" color={colors.mutedGrey} numberOfLines={1}>{p.businessName} · {p.categoryLabel} · {p.distanceKm} km</T>
        <T variant="headline" numberOfLines={2}>{p.title}</T>
        {p.message ? <T variant="caption" color={colors.mutedGrey} numberOfLines={3}>{p.message}</T> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
          {p.offerHeadline ? <Badge label={p.offerHeadline} tone="pinkSoft" /> : null}
          {p.status ? <T variant="small" color={p.status.open ? colors.success : colors.mutedGrey} style={{ fontFamily: fonts.semibold }}>{p.status.open ? 'Open now' : p.status.label}</T> : null}
          <View style={{ flex: 1 }} />
          <T variant="captionStrong" color={colors.pinkDeep}>{p.offerId ? 'See offer' : 'Visit'}</T>
          <Icon name="chevronRight" size={16} color={colors.pinkDeep} />
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.white, paddingHorizontal: 20, gap: 12, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  area: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 },
  segment: { flexDirection: 'row', backgroundColor: colors.softWhite, borderRadius: 999, padding: 4, gap: 4 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 999 },
  segOn: { backgroundColor: colors.nearBlack },
  search: { height: 48, borderRadius: 16, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.softWhite, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  input: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.nearBlack, height: '100%' },
  resultsRow: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 10 },
  offer: { flexDirection: 'row', backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
  offerLeft: { width: 84, backgroundColor: colors.pinkTint, alignItems: 'center', justifyContent: 'center', padding: 8 },
  offerBig: { fontFamily: fonts.display, fontSize: 24, color: colors.pinkDeep },
  promo: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
  promoTag: { position: 'absolute', top: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
});
