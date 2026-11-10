import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { api } from '@/api';
import { Badge, EmptyState, ErrorState, Icon, LoadingState, Photo, Screen, T, TopBar } from '@/components/ui';
import { formatDay, formatTime } from '@/lib/dates';
import { useAsync } from '@/lib/useAsync';
import { colors, radius } from '@/theme/tokens';

export default function MyTickets() {
  const list = useAsync(() => api.getMyTickets(), []);
  return (
    <Screen>
      <TopBar title="My tickets" />
      <View style={{ paddingHorizontal: 16, gap: 12, marginTop: 8 }}>
        {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
        {list.loading && !list.data ? <LoadingState rows={2} /> : null}
        {list.data && list.data.length === 0 ? (
          <EmptyState icon="ticket" title="No tickets yet" message="Tickets you buy for events appear here, ready for the gate." actionLabel="Browse events" onAction={() => router.push('/events')} />
        ) : null}
        {list.data?.map((t) => (
          <Pressable key={t.id} accessibilityRole="button" accessibilityLabel={`${t.eventTitle}, ${t.typeName}, ${t.attendeeName}`} onPress={() => router.push(`/ticket/${t.id}`)} style={styles.row}>
            <Photo uri={t.coverUrl} seed={t.eventId} style={{ width: 72, height: 72 }} radius={14} />
            <View style={{ flex: 1, gap: 3 }}>
              <T variant="bodyStrong">{t.eventTitle}</T>
              <T variant="small" color={colors.mutedGrey}>{formatDay(t.startsAt)} · {formatTime(t.startsAt)} · {t.venue}</T>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Badge label={t.typeName} tone="pinkSoft" />
                <Badge label={t.attendeeName} tone="muted" />
                {t.status === 'checked_in' ? <Badge label="Used" tone="muted" /> : null}
              </View>
            </View>
            <Icon name="chevronRight" size={18} strokeWidth={2} />
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.lg, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline },
});
