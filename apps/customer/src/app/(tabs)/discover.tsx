import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type BusinessQuery, type BusinessSummary, type SearchScope, type SortKey } from '@/api';
import { BusinessRow, EventRow } from '@/components/cards';
import { Button, EmptyState, ErrorState, Icon, LoadingState, T } from '@/components/ui';
import { Chip } from '@/components/ui/Chip';
import { useAsync } from '@/lib/useAsync';
import { EMPTY_PAGE, usePaged } from '@/lib/usePaged';
import { useSession } from '@/state/session';
import { colors, fonts } from '@/theme/tokens';

const SCOPES: { key: SearchScope; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'places', label: 'Places' }, { key: 'services', label: 'Services' },
  { key: 'experiences', label: 'Experiences' }, { key: 'events', label: 'Events' },
];
const SORTS: { key: SortKey; label: string }[] = [{ key: 'nearest', label: 'Nearest' }, { key: 'rating', label: 'Top rated' }, { key: 'popular', label: 'Popular' }];

type Filters = { openNow: boolean; memberOffers: boolean; rating4: boolean; budget: boolean; near: boolean };

export default function Discover() {
  const insets = useSafeAreaInsets();
  const { area } = useSession();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const [sort, setSort] = useState<SortKey>('nearest');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [f, setF] = useState<Filters>({ openNow: false, memberOffers: false, rating4: false, budget: false, near: false });

  useEffect(() => {
    const t = setTimeout(() => setQ(text), 300);
    return () => clearTimeout(t);
  }, [text]);

  const eventScope = scope === 'events' || scope === 'experiences';
  const query: BusinessQuery = {
    q, scope, sort,
    openNow: f.openNow || undefined, memberOffers: f.memberOffers || undefined,
    minRating: f.rating4 ? 4 : undefined, maxPriceLevel: f.budget ? 2 : undefined, maxDistanceKm: f.near ? 3 : undefined,
  };
  const places = usePaged<BusinessSummary>((offset) => (eventScope ? Promise.resolve(EMPTY_PAGE) : api.searchBusinessesPage(query, offset)), [JSON.stringify(query), eventScope]);
  const events = useAsync(async () => {
    if (!eventScope) return [];
    const list = await api.getEvents({});
    const t = q.trim().toLowerCase();
    return list.filter((e) => (scope === 'events' || ['Workshops', 'Experiences', 'Tours'].includes(e.kind)) && (!t || `${e.title} ${e.venue} ${e.area}`.toLowerCase().includes(t)));
  }, [scope, q]);

  const active = Object.values(f).filter(Boolean).length;
  const toggle = (k: keyof Filters) => setF((s) => ({ ...s, [k]: !s[k] }));
  const nextSort = () => setSort((s) => SORTS[(SORTS.findIndex((x) => x.key === s) + 1) % SORTS.length].key);
  const state = eventScope ? events : places;
  const count = eventScope ? events.data?.length ?? 0 : places.data?.length ?? 0;

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
        <View style={styles.search}>
          <Icon name="search" size={20} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Businesses, services, events…"
            placeholderTextColor={colors.mutedGrey}
            accessibilityLabel="Search"
            returnKeyType="search"
            style={styles.input}
          />
          {text ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setText('')} hitSlop={10}>
              <Icon name="close" size={18} color={colors.mutedGrey} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 20 }} accessibilityRole="tablist">
          {SCOPES.map((s) => (
            <Pressable key={s.key} accessibilityRole="tab" accessibilityState={{ selected: scope === s.key }} aria-selected={scope === s.key} onPress={() => setScope(s.key)} style={[styles.scope, scope === s.key && styles.scopeOn]}>
              <T variant="bodyStrong" color={scope === s.key ? colors.nearBlack : colors.mutedGrey} style={{ fontSize: 14 }}>{s.label}</T>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {!eventScope ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 20, paddingTop: 14 }}>
          <Chip label={`Sort: ${SORTS.find((s) => s.key === sort)!.label}`} icon="chevronDown" onPress={nextSort} />
          <Chip label="Open now" selected={f.openNow} onPress={() => toggle('openNow')} />
          <Chip label="Member offers" selected={f.memberOffers} onPress={() => toggle('memberOffers')} />
          <Chip label="Rating 4.0+" selected={f.rating4} onPress={() => toggle('rating4')} />
          <Chip label="₹₹ and under" selected={f.budget} onPress={() => toggle('budget')} />
          <Chip label="Within 3 km" selected={f.near} onPress={() => toggle('near')} />
        </ScrollView>
      ) : null}

      <View style={styles.resultsRow}>
        <T variant="caption" color={colors.mutedGrey}>
          <T variant="captionStrong">{state.loading ? 'Searching…' : `${eventScope ? count : places.total ?? count} ${eventScope ? 'events' : 'places'}`}</T>
          {active && !eventScope ? ` · ${active} filter${active > 1 ? 's' : ''}` : ''}
        </T>
        {!eventScope ? (
          <View style={styles.toggle} accessibilityRole="radiogroup">
            {(['list', 'map'] as const).map((v) => (
              <Pressable key={v} accessibilityRole="radio" accessibilityState={{ checked: view === v }} aria-checked={view === v} onPress={() => setView(v)} style={[styles.toggleBtn, view === v && { backgroundColor: colors.nearBlack }]}>
                <Icon name={v} size={14} color={view === v ? colors.white : colors.mutedGrey} strokeWidth={2} />
                <T variant="small" color={view === v ? colors.white : colors.mutedGrey} style={{ fontFamily: fonts.semibold }}>{v === 'list' ? 'List' : 'Map'}</T>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {view === 'map' && !eventScope ? (
        <View style={styles.map}>
          <Icon name="map" size={28} color={colors.mutedGrey} />
          <T variant="captionStrong" align="center">Map view needs a maps provider</T>
          <T variant="small" color={colors.mutedGrey} align="center">Google Maps or Mappls will be connected once a provider and API key are chosen. Results are listed below.</T>
        </View>
      ) : null}

      <View style={{ paddingHorizontal: 20, gap: 12 }}>
        {state.error ? <ErrorState message={state.error} onRetry={state.reload} /> : null}
        {state.loading && !state.data ? <LoadingState rows={2} /> : null}
        {!state.loading && !state.error && count === 0 ? (
          <EmptyState icon="search" title="Nothing matches yet" message="Try removing a filter or searching for something broader." actionLabel={active ? 'Clear filters' : undefined} onAction={() => setF({ openNow: false, memberOffers: false, rating4: false, budget: false, near: false })} />
        ) : null}
        {eventScope ? events.data?.map((e) => <EventRow key={e.id} e={e} />) : places.data?.map((b) => <BusinessRow key={b.id} b={b} />)}
        {!eventScope && places.hasMore ? <Button label={`Show more (${Math.max(0, (places.total ?? 0) - count)} left)`} variant="outline" onPress={places.loadMore} loading={places.loadingMore} /> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.white, paddingHorizontal: 20, gap: 14, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  area: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8 },
  search: { height: 52, borderRadius: 16, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.softWhite, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  input: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.nearBlack, height: '100%' },
  scope: { paddingTop: 4, paddingBottom: 12, borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  scopeOn: { borderBottomColor: colors.pink },
  resultsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  toggle: { flexDirection: 'row', backgroundColor: colors.white, borderRadius: 999, padding: 3, borderWidth: 1, borderColor: colors.hairline },
  toggleBtn: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  map: { marginHorizontal: 20, marginBottom: 16, height: 180, borderRadius: 24, backgroundColor: colors.hairline, alignItems: 'center', justifyContent: 'center', gap: 6, padding: 24 },
});
