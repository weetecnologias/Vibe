import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { api } from '@/api';
import { Badge, Card, EmptyState, ErrorState, Icon, LoadingState, Screen, T, TopBar } from '@/components/ui';
import { formatDay, formatTime } from '@/lib/dates';
import { useAsync } from '@/lib/useAsync';
import { colors } from '@/theme/tokens';

/** Memberships (gyms, studios, trainers) and the courts, turfs and classes booked through VIBE, latest first. */
export default function MyBookings() {
  const list = useAsync(() => api.getMySlotBookings(), []);
  const passes = useAsync(() => api.getMyVenuePasses(), []);
  const [now] = useState(() => Date.now());
  return (
    <Screen>
      <TopBar title="My bookings" subtitle="Memberships, courts, turfs and classes" />
      {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : list.loading && !list.data ? <LoadingState rows={3} /> : list.data?.length === 0 && passes.data?.length === 0 ? (
        <EmptyState icon="calendar" title="No bookings yet" message="Book a badminton court or a football turf, or join a gym or yoga studio monthly, from Fitness & Wellness." actionLabel="Find a venue" onAction={() => router.push('/category/fitness')} />
      ) : (
        <View style={{ paddingHorizontal: 16, gap: 12, marginTop: 6 }}>
          {passes.data?.length ? <T variant="label" color={colors.mutedGrey}>Memberships</T> : null}
          {passes.data?.map((p) => (
            <Pressable key={p.id} onPress={() => router.push(`/pass/${p.id}`)} accessibilityRole="button" accessibilityLabel={`${p.planName} at ${p.businessName}`}>
              <Card style={{ padding: 16, gap: 6, opacity: p.activeNow || p.daysLeft > 0 ? 1 : 0.6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T variant="bodyStrong" style={{ flex: 1 }}>{p.planName} · {p.businessName}</T>
                  <Badge label={p.activeNow ? `${p.daysLeft} days left` : p.daysLeft > 0 ? 'Starts soon' : 'Ended'} tone={p.activeNow ? 'pinkSoft' : 'muted'} />
                  <Icon name="chevronRight" size={16} />
                </View>
                <T variant="caption" color={colors.mutedGrey}>Valid {p.startsOn.split('-').reverse().join('/')} – {p.endsOn.split('-').reverse().join('/')} · {p.checkIns} visits</T>
              </Card>
            </Pressable>
          ))}
          {passes.data?.length && list.data?.length ? <T variant="label" color={colors.mutedGrey}>Courts and classes</T> : null}
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
