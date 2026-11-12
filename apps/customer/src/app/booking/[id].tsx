import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { api } from '@/api';
import { TicketQr } from '@/components/TicketQr';
import { Badge, Button, Card, ErrorState, LoadingState, Notice, Screen, T, TopBar } from '@/components/ui';
import { formatDay, formatTime } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { useAsync } from '@/lib/useAsync';
import { colors, fonts } from '@/theme/tokens';

/** A court or class booking: what, when and where, and the entry code (with a QR) to show at the front desk. */
export default function BookingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const b = useAsync(() => api.getSlotBooking(id), [id]);
  const d = b.data;

  return (
    <Screen>
      <TopBar title="Your booking" subtitle={d ? `${d.businessName} · ${d.area}` : undefined} right={d?.checkedInAt ? <Badge label="Checked in" tone="muted" /> : null} />
      {b.error ? <ErrorState message={b.error} onRetry={b.reload} /> : !d ? <LoadingState rows={3} /> : (
        <View style={{ paddingHorizontal: 16, gap: 16, marginTop: 6 }}>
          {d.status === 'paid' && d.entryCode ? (
            <Card style={{ padding: 20, gap: 12, alignItems: 'center' }}>
              <T variant="label" color={colors.mutedGrey}>Show this at the front desk</T>
              <TicketQr token={d.entryCode} size={180} />
              <T style={styles.code} accessibilityLabel={`Entry code ${d.entryCode.split('').join(' ')}`}>{d.entryCode}</T>
              <T variant="small" color={colors.mutedGrey}>Booking {d.bookingRef}</T>
            </Card>
          ) : d.status === 'held' ? (
            <Notice tone="warning"><T variant="caption">Not paid yet. Your slots are held until {formatTime(d.expiresAt)}.</T></Notice>
          ) : (
            <Notice tone="info"><T variant="caption">This booking wasn’t completed, so the slots were released.</T></Notice>
          )}

          <Card style={{ padding: 16, gap: 12 }}>
            {d.items.map((i) => (
              <View key={`${i.resourceId}-${i.startsAt}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <T variant="bodyStrong">{i.sport} · {i.resourceName}{i.spots > 1 ? ` × ${i.spots}` : ''}</T>
                  <T variant="caption" color={colors.mutedGrey}>{formatDay(i.startsAt)} · {formatTime(i.startsAt)}–{formatTime(i.endsAt)}</T>
                </View>
                <T variant="captionStrong">{formatINR(i.price)}</T>
              </View>
            ))}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: colors.hairline, paddingTop: 10 }}>
              <T variant="bodyStrong">{d.status === 'paid' ? 'Paid' : 'Total'}</T>
              <T variant="title2">{formatINR(d.total)}</T>
            </View>
          </Card>

          <Card style={{ padding: 16, gap: 6 }}>
            <T variant="bodyStrong">{d.businessName}</T>
            <T variant="caption" color={colors.mutedGrey}>{d.address || d.area}</T>
            <Button label="Venue details" variant="outline" size="md" onPress={() => router.push(`/business/${d.businessId}`)} />
          </Card>
          <T variant="small" color={colors.mutedGrey} align="center">Reach 10 minutes early. Cancellations and changes are handled by the venue.</T>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { fontFamily: fonts.display, fontSize: 32, letterSpacing: 4, color: colors.nearBlack },
});
