import { router, useLocalSearchParams } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { api } from '@/api';
import { TicketQr } from '@/components/TicketQr';
import { Badge, Button, Card, ErrorState, LoadingState, Notice, Screen, T, TopBar } from '@/components/ui';
import { formatTime } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { useAsync } from '@/lib/useAsync';
import { colors, fonts } from '@/theme/tokens';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (d: string) => { const [y, m, day] = d.split('-').map(Number); return `${day} ${MON[m - 1]} ${y}`; };

/** A gym, studio or trainer membership: the pass code (with a QR) for the front desk, and the dates it's valid. */
export default function PassScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const p = useAsync(() => api.getVenuePass(id), [id]);
  const d = p.data;
  const upcoming = d?.status === 'paid' && !d.activeNow && d.daysLeft > 0;

  return (
    <Screen>
      <TopBar title="Your membership" subtitle={d ? `${d.businessName} · ${d.area}` : undefined}
        right={d?.status === 'paid' ? <Badge label={d.activeNow ? 'Active' : upcoming ? 'Starts soon' : 'Ended'} tone={d.activeNow ? 'pinkSoft' : 'muted'} /> : null} />
      {p.error ? <ErrorState message={p.error} onRetry={p.reload} /> : !d ? <LoadingState rows={3} /> : (
        <View style={{ paddingHorizontal: 16, gap: 16, marginTop: 6 }}>
          {d.status === 'paid' && d.passCode ? (
            <Card style={{ padding: 20, gap: 12, alignItems: 'center' }}>
              <T variant="label" color={colors.mutedGrey}>Show this at the front desk</T>
              <TicketQr token={d.passCode} size={180} />
              <T style={styles.code} accessibilityLabel={`Pass code ${d.passCode.split('').join(' ')}`}>{d.passCode}</T>
              <T variant="small" color={colors.mutedGrey}>Membership {d.passRef}</T>
            </Card>
          ) : d.status === 'held' ? (
            <Notice tone="warning"><T variant="caption">Not paid yet. Held until {formatTime(d.expiresAt)}.</T></Notice>
          ) : (
            <Notice tone="info"><T variant="caption">This membership wasn’t completed. Nothing was charged.</T></Notice>
          )}

          <Card style={{ padding: 16, gap: 10 }}>
            <T variant="headline">{d.planName}</T>
            <Row k="Valid from" v={dayLabel(d.startsOn)} />
            <Row k="Valid until" v={dayLabel(d.endsOn)} />
            {d.activeNow ? <Row k="Days left" v={`${d.daysLeft} ${d.daysLeft === 1 ? 'day' : 'days'}`} /> : null}
            {d.status === 'paid' ? <Row k="Visits" v={String(d.checkIns)} /> : null}
            <Row k="Plan price" v={formatINR(d.total)} />
          </Card>

          <Card style={{ padding: 16, gap: 6 }}>
            <T variant="bodyStrong">{d.businessName}</T>
            <T variant="caption" color={colors.mutedGrey}>{d.address || d.area}</T>
            <Button label="Place details" variant="outline" size="md" onPress={() => router.push(`/business/${d.businessId}`)} />
          </Card>
          <T variant="small" color={colors.mutedGrey} align="center">Freezes, transfers and refunds are handled by the place.</T>
        </View>
      )}
    </Screen>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <T variant="caption" color={colors.mutedGrey}>{k}</T>
      <T variant="captionStrong">{v}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  code: { fontFamily: fonts.display, fontSize: 32, letterSpacing: 4, color: colors.nearBlack },
});
