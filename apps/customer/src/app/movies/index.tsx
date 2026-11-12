import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { api } from '@/api';
import { MoviePoster } from '@/components/movies';
import { Rating } from '@/components/cards';
import { Badge, Chip, EmptyState, ErrorState, Icon, LoadingState, Screen, T, TopBar } from '@/components/ui';
import { formatDate } from '@/lib/dates';
import { useAsync } from '@/lib/useAsync';
import { colors } from '@/theme/tokens';

type Tab = 'now' | 'soon' | 'cinemas';

/** Movies landing: what's running, what's coming, and the cinemas. Tapping a film shows which cinemas play it. */
export default function Movies() {
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>('now');
  const [language, setLanguage] = useState('All');
  const films = useAsync(() => api.getMovies(), []);
  const cinemas = useAsync(() => api.searchBusinesses({ categoryId: 'movies.cinemas', sort: 'nearest' }), []);

  const cardW = Math.floor((Math.min(width, 560) - 40 - 12) / 2);
  const languages = useMemo(() => ['All', ...new Set((films.data ?? []).filter((m) => m.status === 'now_showing').flatMap((m) => m.languages))], [films.data]);
  const list = (films.data ?? []).filter((m) => m.status === (tab === 'now' ? 'now_showing' : 'coming_soon') && (language === 'All' || m.languages.includes(language)));

  return (
    <Screen>
      <TopBar title="Movies" subtitle="Book tickets and pick your seats" />
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
                  <View style={styles.meta}>
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
        <View style={{ paddingHorizontal: 20, gap: 12, marginTop: 14 }}>
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
          <Pressable accessibilityRole="link" onPress={() => router.push('/category/movies')} style={{ paddingVertical: 8 }}>
            <T variant="captionStrong" color={colors.pinkDeep}>Private theatres, open-air screenings and film clubs</T>
          </Pressable>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingTop: 4 },
  langs: { gap: 8, paddingHorizontal: 20, paddingTop: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 20, paddingTop: 16 },
  meta: { gap: 2 },
  cinema: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 20, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline },
});
