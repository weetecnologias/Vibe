import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import type { MovieSummary, ShowAvailability, ShowSummary } from '@/api';
import { formatTime } from '@/lib/dates';
import { colors, fonts, radius } from '@/theme/tokens';

import { Badge, Photo, T } from './ui';

/** A film poster. Until the film data provider supplies one, a branded placeholder carries the title. */
export function MoviePoster({ movie, width }: { movie: MovieSummary; width: number }) {
  return (
    <Photo uri={movie.posterUrl} seed={movie.id} radius={16} style={{ width, height: Math.round(width * 1.5), justifyContent: 'flex-end' }}>
      <View style={styles.cert}><Badge label={movie.certificate} tone="dark" /></View>
      <View style={styles.posterText}>
        <T variant="title3" color={colors.white} numberOfLines={2}>{movie.title}</T>
        <T variant="small" color={colors.onDarkMuted} numberOfLines={1}>{movie.genres.join(' · ')}</T>
      </View>
    </Photo>
  );
}

export const availabilityNote = (a: ShowAvailability): string | null =>
  a === 'filling_fast' ? 'Filling fast' : a === 'almost_full' ? 'Almost full' : a === 'sold_out' ? 'Sold out' : null;

/** A tappable showtime. Green = plenty of seats, amber = filling up, grey = sold out. */
export function ShowChip({ show, onPress, subtitle }: { show: ShowSummary; onPress: () => void; subtitle?: string }) {
  const sold = show.availability === 'sold_out';
  const tone = sold ? colors.mutedGrey : show.availability === 'available' ? colors.success : colors.warning;
  const note = availabilityNote(show.availability);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${formatTime(show.startsAt)}, ${show.format}, ${show.language}${note ? `, ${note}` : ''}`}
      disabled={sold}
      onPress={onPress}
      style={[styles.chip, { borderColor: tone, opacity: sold ? 0.55 : 1 }]}>
      <T variant="captionStrong" color={tone}>{formatTime(show.startsAt)}</T>
      <T variant="small" color={colors.mutedGrey}>{subtitle ?? `${show.format} · ${show.language}`}</T>
      {note ? <T variant="small" color={tone} style={{ fontFamily: fonts.semibold, fontSize: 10 }}>{note}</T> : null}
    </Pressable>
  );
}

export function DateStrip({ days, value, onChange }: { days: { key: string; dow: string; day: string }[]; value: string; onChange: (key: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }} accessibilityRole="tablist">
      {days.map((d) => {
        const on = d.key === value;
        return (
          <Pressable
            key={d.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            aria-selected={on}
            accessibilityLabel={`${d.dow} ${d.day}`}
            onPress={() => onChange(d.key)}
            style={[styles.day, on && { backgroundColor: colors.pink, borderColor: colors.pink }]}>
            <T variant="small" color={on ? colors.white : colors.mutedGrey} style={{ fontFamily: fonts.semibold, fontSize: 11 }}>{d.dow}</T>
            <T style={{ fontFamily: fonts.display, fontSize: 17, color: on ? colors.white : colors.nearBlack }}>{d.day}</T>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  cert: { position: 'absolute', top: 10, left: 10 },
  posterText: { padding: 12, gap: 2, backgroundColor: 'rgba(23,21,27,0.62)' },
  chip: { minWidth: 88, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1.5, backgroundColor: colors.white, gap: 1 },
  day: { width: 54, height: 64, borderRadius: 16, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', gap: 2 },
});
