import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { api, type SlotOption, type SlotPick, type SlotTime } from '@/api';
import { DateStrip } from '@/components/movies';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, Icon, LoadingState, Notice, Screen, T, TopBar } from '@/components/ui';
import { upcomingDays } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { errorMessage, useAsync } from '@/lib/useAsync';
import { useSession } from '@/state/session';
import { colors, radius } from '@/theme/tokens';

type CartItem = SlotPick & { key: string; sport: string; name: string; label: string; dayLabel: string; price: number };

const PARTS: { title: string; from: number; to: number }[] = [
  { title: 'Morning', from: 0, to: 12 },
  { title: 'Afternoon', from: 12, to: 17 },
  { title: 'Evening', from: 17, to: 24 },
];
const hourOf = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).getUTCHours();
const durationLabel = (m: number) => (m % 60 === 0 ? `${m / 60} hr` : `${m} min`);

/**
 * Book a court, turf, net or class by the slot (like Playo): pick the sport, the date and how long, then a start time, then which court
 * (or how many people for a class). Slots go into a booking; the total is held for a few minutes while you pay through VIBE.
 */
export default function BookSlots() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const { status } = useSession();
  const business = useAsync(() => api.getBusiness(businessId), [businessId]);
  const sports = useAsync(() => api.getVenueSports(businessId), [businessId]);
  const days = useMemo(() => upcomingDays(14), []);
  const [sport, setSport] = useState<string | null>(null);
  const [day, setDay] = useState(days[0].key);
  const [minutes, setMinutes] = useState<number | undefined>(undefined);
  const [time, setTime] = useState<SlotTime | null>(null);
  const [spots, setSpots] = useState(1);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenSport = sport ?? sports.data?.[0]?.sport ?? null;
  const grid = useAsync(() => (chosenSport ? api.getSlots(businessId, chosenSport, day, minutes) : Promise.resolve(null)), [businessId, chosenSport, day, minutes]);
  const g = grid.data;

  const dayLabel = days.find((d) => d.key === day);
  const add = (o: SlotOption) => {
    if (!g || !time) return;
    const key = `${o.resourceId}@${time.startsAt}`;
    if (cart.some((c) => c.key === key)) return;
    setCart([...cart, {
      key, resourceId: o.resourceId, startsAt: time.startsAt, minutes: g.minutes, spots: g.kind === 'spots' ? spots : undefined,
      sport: g.sport, name: o.name, label: `${time.label} · ${durationLabel(g.minutes)}`, dayLabel: dayLabel ? `${dayLabel.dow} ${dayLabel.day}` : day, price: o.price * (g.kind === 'spots' ? spots : 1),
    }]);
    setTime(null);
    setError(null);
  };
  const total = cart.reduce((n, c) => n + c.price, 0);

  const proceed = async () => {
    if (status !== 'signedIn') { router.push('/login'); return; }
    setBusy(true);
    setError(null);
    try {
      const b = await api.bookSlots(businessId, cart.map(({ resourceId, startsAt, minutes: m, spots: s }) => ({ resourceId, startsAt, minutes: m, spots: s })));
      router.push(`/checkout/${b.paymentRequestId}`);
    } catch (e) {
      setError(errorMessage(e));
      grid.reload();
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <View style={{ gap: 8 }}>
      {error ? <Notice tone="error"><T variant="caption">{error}</T></Notice> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View>
          <T variant="small" color={colors.mutedGrey}>{cart.length ? `${cart.length} slot${cart.length === 1 ? '' : 's'}` : 'No slots yet'}</T>
          <T variant="title2">{formatINR(total)}</T>
        </View>
        <Button label={status === 'signedIn' ? 'Proceed to pay' : 'Sign in to book'} style={{ flex: 1 }} disabled={!cart.length} loading={busy} onPress={proceed} />
      </View>
    </View>
  );

  if (sports.error) return <Screen><TopBar title="Book a slot" /><ErrorState message={sports.error} onRetry={sports.reload} /></Screen>;
  return (
    <Screen footer={footer}>
      <TopBar title="Book a slot" subtitle={business.data ? `${business.data.name} · ${business.data.area}` : undefined} />
      {sports.loading && !sports.data ? <LoadingState rows={3} /> : sports.data && sports.data.length === 0 ? (
        <EmptyState icon="calendar" title="No online booking here" message="This place doesn’t take slot bookings in the app yet." />
      ) : (
        <View style={{ gap: 18, paddingBottom: 16 }}>
          <View style={{ gap: 8 }}>
            <T variant="label" color={colors.mutedGrey} style={styles.pad}>Sport</T>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}>
              {sports.data?.map((s) => (
                <Chip key={s.sport} label={`${s.sport} · from ${formatINR(s.fromPrice)}`} selected={s.sport === chosenSport} onPress={() => { setSport(s.sport); setTime(null); }} />
              ))}
            </ScrollView>
          </View>

          <View style={{ gap: 8 }}>
            <T variant="label" color={colors.mutedGrey} style={styles.pad}>Date</T>
            <DateStrip days={days} value={day} onChange={(k) => { setDay(k); setTime(null); }} />
          </View>

          {g ? (
            <View style={{ gap: 8 }}>
              <T variant="label" color={colors.mutedGrey} style={styles.pad}>Duration</T>
              <View style={[styles.row, styles.pad]}>
                {g.durations.map((d) => <Chip key={d} label={durationLabel(d)} selected={g.minutes === d} onPress={() => { setMinutes(d); setTime(null); }} />)}
              </View>
            </View>
          ) : null}

          <View style={{ gap: 10, paddingHorizontal: 20 }}>
            <T variant="label" color={colors.mutedGrey}>Start time</T>
            {grid.error ? <ErrorState message={grid.error} onRetry={grid.reload} /> : grid.loading && !g ? <LoadingState rows={2} /> : g?.closedReason ? (
              <Notice tone="info"><T variant="caption">{g.closedReason}</T></Notice>
            ) : g && g.slots.every((s) => !s.available) ? (
              <Notice tone="warning"><T variant="caption">Nothing free on this day for {durationLabel(g.minutes)}. Try another day or a shorter time.</T></Notice>
            ) : g ? PARTS.map((p) => {
              const list = g.slots.filter((s) => hourOf(s.startsAt) >= p.from && hourOf(s.startsAt) < p.to);
              if (!list.length) return null;
              return (
                <View key={p.title} style={{ gap: 8 }}>
                  <T variant="captionStrong">{p.title}</T>
                  <View style={styles.grid}>
                    {list.map((s) => {
                      const on = time?.startsAt === s.startsAt;
                      return (
                        <Pressable key={s.startsAt} disabled={!s.available} onPress={() => setTime(s)} accessibilityRole="button" accessibilityState={{ disabled: !s.available, selected: on }}
                          accessibilityLabel={`${s.label}${s.available ? `, from ${formatINR(s.fromPrice)}` : ', not available'}`}
                          style={[styles.slot, on && styles.slotOn, !s.available && styles.slotOff]}>
                          <T variant="captionStrong" color={on ? colors.white : s.available ? colors.nearBlack : colors.mutedGrey}>{s.label}</T>
                          <T variant="small" color={on ? colors.white : colors.mutedGrey}>{s.available ? formatINR(s.fromPrice) : 'Full'}</T>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            }) : null}
          </View>

          {g && time ? (
            <Card style={{ marginHorizontal: 16, padding: 16, gap: 10 }}>
              <T variant="headline">{g.kind === 'court' ? `Choose a ${g.sport === 'Football' || g.sport === 'Box cricket' ? 'turf' : g.sport === 'Cricket' ? 'net' : 'court'}` : 'How many people?'} · {time.label}</T>
              {g.kind === 'spots' ? (
                <View style={[styles.row, { alignItems: 'center' }]}>
                  <Button label="−" variant="outline" size="md" disabled={spots <= 1} onPress={() => setSpots(spots - 1)} />
                  <T variant="title2">{spots}</T>
                  <Button label="+" variant="outline" size="md" disabled={spots >= Math.min(10, Math.max(...time.options.map((o) => o.spotsLeft)))} onPress={() => setSpots(spots + 1)} />
                </View>
              ) : null}
              {time.options.map((o) => {
                const inCart = cart.some((c) => c.key === `${o.resourceId}@${time.startsAt}`);
                const ok = o.available && (g.kind === 'court' || o.spotsLeft >= spots) && !inCart;
                return (
                  <Pressable key={o.resourceId} disabled={!ok} onPress={() => add(o)} style={[styles.option, !ok && { opacity: 0.45 }]} accessibilityRole="button" accessibilityLabel={`${o.name}, ${formatINR(o.price)}`}>
                    <View style={{ flex: 1 }}>
                      <T variant="bodyStrong">{o.name}</T>
                      <T variant="small" color={colors.mutedGrey}>{inCart ? 'In your booking' : !o.available ? 'Booked' : g.kind === 'spots' ? `${o.spotsLeft} spots left` : 'Available'}</T>
                    </View>
                    <T variant="bodyStrong">{formatINR(o.price * (g.kind === 'spots' ? spots : 1))}</T>
                    {ok ? <Icon name="plus" size={20} color={colors.pink} /> : null}
                  </Pressable>
                );
              })}
            </Card>
          ) : null}

          {cart.length ? (
            <Card style={{ marginHorizontal: 16, padding: 16, gap: 8 }}>
              <T variant="headline">Your booking</T>
              {cart.map((c) => (
                <View key={c.key} style={[styles.row, { alignItems: 'center', justifyContent: 'space-between' }]}>
                  <View style={{ flex: 1 }}>
                    <T variant="captionStrong">{c.sport} · {c.name}{c.spots && c.spots > 1 ? ` × ${c.spots}` : ''}</T>
                    <T variant="small" color={colors.mutedGrey}>{c.dayLabel} · {c.label}</T>
                  </View>
                  <T variant="captionStrong">{formatINR(c.price)}</T>
                  <Pressable onPress={() => setCart(cart.filter((x) => x.key !== c.key))} accessibilityRole="button" accessibilityLabel={`Remove ${c.name}`} hitSlop={8}><Icon name="close" size={18} color={colors.mutedGrey} /></Pressable>
                </View>
              ))}
              <Badge label="Held for 10 minutes while you pay" tone="muted" />
            </Card>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 20 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slot: { width: '31%', minWidth: 96, paddingVertical: 10, paddingHorizontal: 8, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.white, alignItems: 'center', gap: 2 },
  slotOn: { backgroundColor: colors.nearBlack, borderColor: colors.nearBlack },
  slotOff: { backgroundColor: colors.softWhite, borderColor: colors.softWhite },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.hairline },
});
