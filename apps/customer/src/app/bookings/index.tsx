import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { api } from '@/api';
import { Badge, Card, EmptyState, ErrorState, Icon, LoadingState, Screen, T, TopBar } from '@/components/ui';
import { formatDay, formatTime } from '@/lib/dates';
import { useAsync } from '@/lib/useAsync';
import { colors } from '@/theme/tokens';

/** Courts, turfs and classes booked through VIBE, latest first. */
export default function MyBookings() {
  const list = useAsync(() => api.getMySlotBookings(), []);
  const [now] = useState(() => Date.now());
  return (
    <Screen>
      <TopBar title="My bookings" subtitle="Courts, turfs and classes" />
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <LoadingState rows={3} /> : list.data?.length === 0 ? (
        <EmptyState icon="calendar" title="No bookings yet" message="Book a badminton court, a football turf or a yoga class from Fitness & Wellness." actionLabel="Find a venue" onAction={() => router.push('/category/fitness')} />
      ) : (
        <View style={{ paddingHorizontal: 16, gap: 12, marginTop: 6 }}>
          {list.data?.map((b) => {
            const first = b.items[0];
            const past = Date.parse(b.items[b.items.length - 1].endsAt) < now;
            return (
              <Pressable key={b.id} onPress={() => router.push(`/booking/${b.id}`)} accessibilityRole="button" accessibilityLabel={`${first.sport} at ${b.businessName}`}>
                <Card style={{ padding: 16, gap: 6, opacity: past ? 0.6 : 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <T variant="bodyStrong" style={{ flex: 1 }}>{first.sport} · {b.businessName}</T>
                    {b.checkedInAt ? <Badge label="Checked in" tone="muted" /> : past ? <Badge label="Done" tone="muted" /> : <Badge label="Upcoming" tone="pinkSoft" />}
                    <Icon name="chevronRight" size={16} />
                  </View>
                  <T variant="caption" color={colors.mutedGrey}>{formatDay(first.startsAt)} · {formatTime(first.startsAt)}–{formatTime(first.endsAt)} · {first.resourceName}{b.items.length > 1 ? ` + ${b.items.length - 1} more` : ''}</T>
                </Card>
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
