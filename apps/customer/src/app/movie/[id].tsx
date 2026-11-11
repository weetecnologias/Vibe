import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api';
import { DateStrip, ShowChip } from '@/components/movies';
import { Rating } from '@/components/cards';
import { Badge, BackButton, Card, Chip, EmptyState, ErrorState, Icon, LoadingState, Notice, Photo, Screen, T } from '@/components/ui';
import { formatDate, upcomingDays } from '@/lib/dates';
import { useAsync } from '@/lib/useAsync';
import { colors } from '@/theme/tokens';

/** A film: details, then the cinemas playing it on the chosen day with showtimes. */
export default function MovieScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const days = useMemo(() => upcomingDays(6), []);
  const [day, setDay] = useState(days[0].key);
  const [lang, setLang] = useState<string | null>(null);
  const movie = useAsync(() => api.getMovie(id), [id]);
  const shows = useAsync(() => api.getMovieShows(id, day), [id, day]);

  const m = movie.data;
  const soon = m?.status === 'coming_soon';
  const languages = useMemo(() => [...new Set((shows.data ?? []).flatMap((c) => c.shows.map((s) => s.language)))], [shows.data]);
  const cinemas = (shows.data ?? [])
    .map((c) => ({ ...c, shows: c.shows.filter((s) => !lang || s.language === lang) }))
    .filter((c) => c.shows.length > 0);

  if (movie.error) return <View style={{ flex: 1, paddingTop: insets.top }}><BackButton /><ErrorState message={movie.error} onRetry={movie.reload} /></View>;
  if (!m) return <View style={{ flex: 1, paddingTop: insets.top + 48, backgroundColor: colors.softWhite }}><LoadingState rows={2} /></View>;

  return (
    <Screen edgeToEdge>
      <Photo uri={m.posterUrl} seed={m.id} scrim={0.4} style={{ height: 300, justifyContent: 'flex-end' }}>
        <View style={{ position: 'absolute', top: insets.top + 8, left: 16 }}><BackButton tone="light" fallback="/movies" /></View>
        <View style={styles.heroText}>
          <View style={{ flexDirection: 'row', gap: 6 }}><Badge label={m.certificate} tone="white" /><Badge label={`${m.durationMin} min`} tone="dark" />{soon ? <Badge label="Coming soon" tone="pink" /> : null}</View>
          <T variant="display" color={colors.white} accessibilityRole="header">{m.title}</T>
          <T variant="caption" color={colors.onDarkMuted}>{m.genres.join(' · ')}</T>
        </View>
      </Photo>

      <View style={{ paddingHorizontal: 20, gap: 18, marginTop: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {m.rating !== null ? <><Rating value={m.rating / 2} /><T variant="captionStrong">{m.rating.toFixed(1)}/10</T><T variant="caption" color={colors.mutedGrey}>({m.votes.toLocaleString('en-IN')} votes)</T></> : null}
          <T variant="caption" color={colors.mutedGrey}>{m.languages.join(', ')} · {m.formats.join(', ')}</T>
        </View>
        <T variant="body" color={colors.mutedGrey}>{m.synopsis}</T>
        <Card style={{ padding: 14, gap: 4 }}>
          <T variant="small" color={colors.mutedGrey}>Directed by <T variant="captionStrong">{m.director}</T></T>
          <T variant="small" color={colors.mutedGrey}>Cast <T variant="captionStrong">{m.cast.join(', ')}</T></T>
        </Card>
      </View>

      {soon ? (
        <View style={{ paddingHorizontal: 20, marginTop: 20 }}>
          <Notice tone="info" icon="calendar"><T variant="caption">Releases {formatDate(m.releaseDate)}. Bookings open a few days before.</T></Notice>
        </View>
      ) : (
        <View style={{ gap: 14, marginTop: 24 }}>
          <T variant="title2" style={{ paddingHorizontal: 20 }} accessibilityRole="header">Book tickets</T>
          <DateStrip days={days} value={day} onChange={(d) => { setDay(d); setLang(null); }} />
          {languages.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}>
              <Chip label="All languages" selected={!lang} onPress={() => setLang(null)} />
              {languages.map((l) => <Chip key={l} label={l} selected={lang === l} onPress={() => setLang(l)} />)}
            </ScrollView>
          ) : null}

          <View style={{ paddingHorizontal: 20, gap: 12 }}>
            {shows.error ? <ErrorState message={shows.error} onRetry={shows.reload} /> : null}
            {shows.loading && !shows.data ? <LoadingState rows={2} /> : null}
            {shows.data && cinemas.length === 0 ? <EmptyState icon="ticket" title="No shows left this day" message="Try another day or language." /> : null}
            {cinemas.map((c) => (
              <Card key={c.cinema.id} style={{ padding: 16, gap: 12 }}>
                <Pressable accessibilityRole="link" accessibilityLabel={`${c.cinema.name}, ${c.cinema.area}. Open cinema`} onPress={() => router.push(`/business/${c.cinema.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <T variant="bodyStrong">{c.cinema.name}</T>
                    <T variant="small" color={colors.mutedGrey}>{c.cinema.area} · {c.cinema.distanceKm} km</T>
                  </View>
                  <Icon name="chevronRight" size={18} strokeWidth={2} />
                </Pressable>
                <View style={styles.chips}>
                  {c.shows.map((s) => <ShowChip key={s.id} show={s} onPress={() => router.push(`/show/${s.id}`)} />)}
                </View>
              </Card>
            ))}
            <T variant="small" color={colors.mutedGrey}>Showtimes and seat availability come from each cinema and change as seats sell.</T>
          </View>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroText: { padding: 20, gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
