import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { api, type BusinessSummary } from '@/api';
import { EventRow, Rating } from '@/components/cards';
import { MoviePoster } from '@/components/movies';
import { Badge, Button, Chip, EmptyState, ErrorState, Icon, LoadingState, Photo, Screen, T, TopBar } from '@/components/ui';
import { formatDate } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { useAsync } from '@/lib/useAsync';
import { colors, fonts, radius } from '@/theme/tokens';

type Section = 'movies' | 'private' | 'openair';
type Tab = 'now' | 'soon' | 'cinemas';
const SECTIONS: [Section, string][] = [['movies', 'Movies'], ['private', 'Private theatres'], ['openair', 'Open-air theatres']];

/**
 * Movies has three parts. Movies: what's running and coming at cinemas, and the cinemas (book seats). Private theatres: a screen of your own for
 * birthdays, dates and groups, booked by the hour. Open-air theatres: weekend screenings under the sky, ticketed like events.
 */
export default function Movies() {
  const [section, setSection] = useState<Section>('movies');
  return (
    <Screen>
      <TopBar title="Movies" subtitle={section === 'movies' ? 'Book tickets and pick your seats' : section === 'private' ? 'A screen of your own, by the hour' : 'Screenings under the sky'} />
      <View style={styles.segment} accessibilityRole="tablist">
        {SECTIONS.map(([k, label]) => (
          <Pressable key={k} accessibilityRole="tab" accessibilityState={{ selected: section === k }} aria-selected={section === k} onPress={() => setSection(k)} style={[styles.segBtn, section === k && styles.segOn]}>
            <T variant="captionStrong" color={section === k ? colors.white : colors.nearBlack} align="center">{label}</T>
          </Pressable>
        ))}
      </View>
      {section === 'movies' ? <NowShowing /> : section === 'private' ? <PrivateTheatres /> : <OpenAir />}
    </Screen>
  );
}

function NowShowing() {
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>('now');
  const [language, setLanguage] = useState('All');
  const films = useAsync(() => api.getMovies(), []);
  const cinemas = useAsync(() => api.searchBusinesses({ categoryId: 'movies.cinemas', sort: 'nearest' }), []);

  const cardW = Math.floor((Math.min(width, 560) - 40 - 12) / 2);
  const languages = useMemo(() => ['All', ...new Set((films.data ?? []).filter((m) => m.status === 'now_showing').flatMap((m) => m.languages))], [films.data]);
  const list = (films.data ?? []).filter((m) => m.status === (tab === 'now' ? 'now_showing' : 'coming_soon') && (language === 'All' || m.languages.includes(language)));

  return (
    <>
      <View style={styles.tabs} accessibilityRole="tablist">
        {([['now', 'Now showing'], ['soon', 'Coming soon'], ['cinemas', 'Cinemas']] as const).map(([k, label]) => (
          <Chip key={k} label={label} tone="pink" selected={tab === k} onPress={() => setTab(k)} />
        ))}
      </View>

      {tab !== 'cinemas' ? (
        <>
          {tab === 'now' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.langs}>
              {languages.map((l) => <Chip key={l} label={l} selected={language === l} onPress={() => setLanguage(l)} />)}
            </ScrollView>
          ) : null}
          <View style={styles.grid}>
            {films.error ? <ErrorState message={films.error} onRetry={films.reload} /> : null}
            {films.loading && !films.data ? <LoadingState rows={2} /> : null}
            {films.data && list.length === 0 ? <EmptyState icon="ticket" title="No films here yet" message="Try another language, or see the Cinemas tab for places near you." /> : null}
            {list.map((m) => (
              <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`${m.title}, ${m.genres.join(', ')}, ${m.certificate}`} onPress={() => router.push(`/movie/${m.id}`)} style={{ width: cardW, gap: 8 }}>
                <MoviePoster movie={m} width={cardW} />
                {m.status === 'now_showing' ? (
                  <View style={{ gap: 2 }}>
                    <Rating value={(m.rating ?? 0) / 2} />
                    <T variant="small" color={colors.mutedGrey}>{m.rating?.toFixed(1)}/10 · {m.durationMin} min</T>
                  </View>
                ) : (
                  <Badge label={`Releases ${formatDate(m.releaseDate)}`} tone="pinkSoft" />
                )}
              </Pressable>
            ))}
          </View>
        </>
      ) : (
        <View style={styles.list}>
          {cinemas.error ? <ErrorState message={cinemas.error} onRetry={cinemas.reload} /> : null}
          {cinemas.loading && !cinemas.data ? <LoadingState rows={2} /> : null}
          {cinemas.data?.map((c) => (
            <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`${c.name}, ${c.area}, ${c.distanceKm} kilometres. See showtimes`} onPress={() => router.push(`/cinema/${c.id}`)} style={styles.cinema}>
              <View style={{ flex: 1, gap: 3 }}>
                <T variant="bodyStrong">{c.name}</T>
                <T variant="caption" color={colors.mutedGrey}>{c.categoryLabel} · {c.area} · {c.distanceKm} km</T>
                {c.offerBadge ? <Badge label={c.offerBadge} /> : null}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <T variant="captionStrong" color={colors.pinkDeep}>Showtimes</T>
                <Icon name="chevronRight" size={18} strokeWidth={2} />
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </>
  );
}

/** A private theatre or open-air place: photo, rating, distance and, for private screens, the hourly price and a Book button. */
function VenueCard({ b, action }: { b: BusinessSummary; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.venue}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${b.name}, ${b.area}, ${b.distanceKm} kilometres`} onPress={() => router.push(`/business/${b.id}`)}>
      <Photo uri={b.coverUrl} seed={b.id} style={{ height: 140 }} accessibilityLabel={`Photo of ${b.name}`} />
      <View style={{ padding: 14, paddingBottom: action ? 0 : 14, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <T variant="headline" style={{ flex: 1 }} numberOfLines={1}>{b.name}</T>
          {b.isNew ? <Badge label="New" tone="pinkSoft" /> : null}
        </View>
        <T variant="caption" color={colors.mutedGrey} numberOfLines={1}>{b.categoryLabel} · {b.area} · {b.distanceKm} km</T>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {b.rating ? <Rating value={b.rating} /> : null}
          <T variant="small" color={b.status.open ? colors.success : colors.mutedGrey} style={{ fontFamily: fonts.semibold }}>{b.status.open ? 'Open now' : b.status.label}</T>
          {b.offerBadge ? <Badge label={b.offerBadge} /> : null}
        </View>
      </View>
      </Pressable>
      {action ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, paddingTop: 8 }}>
          <View style={{ flex: 1 }}>
            {b.slotFromPrice ? <T variant="bodyStrong">From {formatINR(b.slotFromPrice)}<T variant="small" color={colors.mutedGrey}> an hour</T></T> : null}
          </View>
          <Button label={action.label} size="md" onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}

function PrivateTheatres() {
  const list = useAsync(() => api.searchBusinesses({ categoryId: 'movies.private-theatres', sort: 'nearest' }), []);
  return (
    <View style={styles.list}>
      <T variant="caption" color={colors.mutedGrey}>Birthdays, dates, proposals or a film marathon with friends. Choose a screen and how many hours, and pay through VIBE.</T>
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data ? <LoadingState rows={2} /> : null}
      {list.data?.length === 0 ? <EmptyState icon="film" title="No private theatres yet" message="Check back soon." /> : null}
      {list.data?.map((b) => <VenueCard key={b.id} b={b} action={{ label: 'Book a screen', onPress: () => router.push(`/book/${b.id}`) }} />)}
    </View>
  );
}

function OpenAir() {
  const screenings = useAsync(() => api.getEvents({ kind: 'Movies' }), []);
  const venues = useAsync(() => api.searchBusinesses({ categoryId: 'movies.open-air-screenings', sort: 'nearest' }), []);
  return (
    <View style={styles.list}>
      <T variant="headline">Coming screenings</T>
      {screenings.error ? <ErrorState message={screenings.error} onRetry={screenings.reload} /> : null}
      {screenings.loading && !screenings.data ? <LoadingState rows={2} /> : null}
      {screenings.data?.length === 0 ? <T variant="caption" color={colors.mutedGrey}>No screenings on sale right now. See the places below.</T> : null}
      {screenings.data?.map((e) => <EventRow key={e.id} e={e} />)}
      <T variant="headline" style={{ marginTop: 10 }}>Open-air theatres</T>
      {venues.error ? <ErrorState message={venues.error} onRetry={venues.reload} /> : null}
      {venues.loading && !venues.data ? <LoadingState rows={2} /> : null}
      {venues.data?.map((b) => <VenueCard key={b.id} b={b} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', marginHorizontal: 20, backgroundColor: colors.white, borderRadius: 999, padding: 4, gap: 4, borderWidth: 1, borderColor: colors.hairline },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, paddingHorizontal: 4, borderRadius: 999 },
  segOn: { backgroundColor: colors.nearBlack },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 14 },
  langs: { gap: 8, paddingHorizontal: 20, paddingTop: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 20, paddingTop: 16 },
  list: { paddingHorizontal: 20, gap: 12, marginTop: 14, paddingBottom: 24 },
  cinema: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline },
  venue: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
});
