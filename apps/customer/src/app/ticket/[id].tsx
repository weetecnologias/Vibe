import { useLocalSearchParams } from 'expo-router';
import { Linking, Platform, StyleSheet, View } from 'react-native';

import { api } from '@/api';
import { TicketQr } from '@/components/TicketQr';
import { Badge, Button, ErrorState, LoadingState, Photo, Screen, T, TopBar } from '@/components/ui';
import { formatDay, formatTime } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { useAsync } from '@/lib/useAsync';
import { colors, fonts } from '@/theme/tokens';

export default function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: t, error, reload } = useAsync(() => api.getTicket(id), [id]);

  const directions = () => {
    if (!t) return;
    const q = encodeURIComponent(`${t.venue}, ${t.area}, Hyderabad`);
    Linking.openURL(Platform.select({ ios: `maps:0,0?q=${q}`, android: `geo:0,0?q=${q}`, default: `https://www.google.com/maps/search/?api=1&query=${q}` })!);
  };

  const statusBadge = t?.status === 'valid'
    ? <Badge label="Valid · not checked in" tone="success" />
    : t?.status === 'checked_in' ? <Badge label="Checked in" tone="muted" /> : <Badge label="Cancelled" tone="error" />;

  return (
    <Screen dark>
      <TopBar dark title="Your ticket" right={t ? <T variant="caption" color={colors.onDarkMuted} style={{ marginRight: 12 }}>{t.index} of {t.of}</T> : null} />
      {error ? <ErrorState message={error} onRetry={reload} /> : null}
      {!t && !error ? <LoadingState rows={2} dark /> : null}
      {t ? (
        <View style={{ paddingHorizontal: 16, gap: 14 }}>
          <View style={styles.ticket}>
            <Photo uri={t.coverUrl} scrim seed={t.eventId} style={{ height: 140, justifyContent: 'flex-end' }}>
              <View style={{ position: 'absolute', top: 16, left: 16 }}><Badge label={t.typeName} tone="pink" uppercase /></View>
              <View style={{ padding: 16 }}>
                <T variant="label" color="rgba(255,255,255,0.75)">{t.eventKind}</T>
                <T variant="title2" color={colors.white}>{t.eventTitle}</T>
              </View>
            </Photo>
            <View style={styles.facts}>
              <Fact k="Date" v={formatDay(t.startsAt)} />
              <Fact k="Time" v={`${formatTime(t.startsAt)} · gates ${formatTime(t.gatesOpenAt)}`} />
              <Fact k="Venue" v={t.venue} />
              <Fact k="Area" v={t.area} />
              <Fact k={t.seatLabel ? 'Seat' : 'Ticket'} v={t.seatLabel ? `${t.seatLabel} · ${t.typeName}` : `${t.typeName} · ${t.index} of ${t.of}`} />
              <Fact k="Attendee" v={t.attendeeName} />
            </View>
            <View style={styles.tear} aria-hidden>
              <View style={[styles.notch, { left: -12 }]} />
              <View style={styles.dash} />
              <View style={[styles.notch, { right: -12 }]} />
            </View>
            <View style={styles.qrArea}>
              <TicketQr token={t.qrToken} />
              <T variant="label" color={colors.mutedGrey}>Admission code</T>
              <T style={styles.code} accessibilityLabel={`Admission code ${t.admissionCode.split('').join(' ')}`}>{t.admissionCode}</T>
              {statusBadge}
              <T variant="small" color={colors.mutedGrey} align="center">Show this at the gate. Each ticket admits one person and can be scanned only once.</T>
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button label="Directions" icon="directions" variant="light" style={{ flex: 1 }} onPress={directions} />
          </View>

          <View style={styles.booking}>
            <T variant="headline" color={colors.white}>Booking</T>
            <Row k="Booking ID" v={t.bookingId} />
            <Row k="Tickets in booking" v={String(t.of)} />
            <Row k="Paid" v={formatINR(t.paidTotal, { decimals: 'always' })} />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ width: '50%', paddingRight: 8, gap: 2 }}>
      <T variant="label" color={colors.mutedGrey}>{k}</T>
      <T variant="captionStrong">{v}</T>
    </View>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <T variant="caption" color={colors.onDarkMuted}>{k}</T>
      <T variant="captionStrong" color={colors.white}>{v}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  ticket: { backgroundColor: colors.white, borderRadius: 26, overflow: 'hidden' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, padding: 20 },
  tear: { height: 24, justifyContent: 'center' },
  notch: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: colors.nearBlack },
  dash: { marginHorizontal: 20, borderTopWidth: 2, borderStyle: 'dashed', borderColor: colors.hairline },
  qrArea: { alignItems: 'center', gap: 10, padding: 20, paddingTop: 12 },
  code: { fontFamily: fonts.display, fontSize: 24, letterSpacing: 3.4, color: colors.nearBlack },
  booking: { backgroundColor: colors.darkSurface, borderRadius: 20, padding: 18, gap: 10 },
});
