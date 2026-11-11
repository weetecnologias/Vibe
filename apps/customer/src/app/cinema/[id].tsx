import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { api } from '@/api';
import { DateStrip, ShowChip } from '@/components/movies';
import { Badge, Card, EmptyState, ErrorState, Icon, LoadingState, Photo, Screen, T, TopBar } from '@/components/ui';
import { upcomingDays } from '@/lib/dates';
import { useAsync } from '@/lib/useAsync';
import { colors } from '@/theme/tokens';

/** One cinema: the films it runs on the chosen day, with showtimes. */
export default function CinemaScreen() {
  const { id, meet } = useLocalSearchParams<{ id: string; meet?: string }>();
  const days = useMemo(() => upcomingDays(6), []);
  const [day, setDay] = useState(days[0].key);
  const cinema = useAsync(() => api.getBusiness(id), [id]);
  const shows = useAsync(() => api.getCinemaShows(id, day), [id, day]);
  const c = cinema.data;

  return (
    <Screen>
      <TopBar title={c?.name ?? 'Cinema'} subtitle={c ? `${c.area} · ${c.distanceKm} km` : undefined} right={c ? <Pressable accessibilityRole="link" onPress={() => router.push(`/business/${c.id}`)} hitSlop={8} style={{ paddingHorizontal: 12 }}><T variant="captionStrong" color={colors.pinkDeep}>About</T></Pressable> : null} />
      <DateStrip days={days} value={day} onChange={setDay} />

      <View style={{ paddingHorizontal: 20, gap: 14, marginTop: 16 }}>
        {cinema.error ? <ErrorState message={cinema.error} onRetry={cinema.reload} /> : null}
        {shows.error ? <ErrorState message={shows.error} onRetry={shows.reload} /> : null}
        {shows.loading && !shows.data ? <LoadingState rows={2} /> : null}
        {shows.data && shows.data.length === 0 ? <EmptyState icon="ticket" title="No shows left this day" message="Try another day." /> : null}
        {shows.data?.map(({ movie, shows: list }) => (
          <Card key={movie.id} style={{ padding: 14, gap: 12 }}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${movie.title}. Film details`} onPress={() => router.push(`/movie/${movie.id}`)} style={styles.head}>
              <Photo uri={movie.posterUrl} seed={movie.id} radius={12} style={{ width: 58, height: 86 }} />
              <View style={{ flex: 1, gap: 3 }}>
                <T variant="bodyStrong">{movie.title}</T>
                <T variant="small" color={colors.mutedGrey}>{movie.genres.join(' · ')} · {movie.durationMin} min</T>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Badge label={movie.certificate} tone="muted" />
                  {movie.rating ? <T variant="small" color={colors.mutedGrey}>★ {movie.rating.toFixed(1)}</T> : null}
                </View>
              </View>
              <Icon name="chevronRight" size={18} strokeWidth={2} />
            </Pressable>
            <View style={styles.chips}>
              {list.map((s) => <ShowChip key={s.id} show={s} onPress={() => router.push(meet ? `/show/${s.id}?meet=${meet}` : `/show/${s.id}`)} />)}
            </View>
          </Card>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
