import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { api } from '@/api';
import { Badge, Button, ErrorState, Icon, LoadingState, Notice, Screen, T, TopBar } from '@/components/ui';
import { formatTime, relativeDay } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { errorMessage, useAsync } from '@/lib/useAsync';
import { useSession } from '@/state/session';
import { colors, fonts } from '@/theme/tokens';

/** Seat picker. Seats are held for a few minutes when you go to pay, so nobody else can take them. */
export default function SeatScreen() {
  const { id, meet } = useLocalSearchParams<{ id: string; meet?: string }>();
  const { width } = useWindowDimensions();
  const { status } = useSession();
  const map = useAsync(() => api.getSeatMap(id), [id]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null);

  const data = map.data;
  const priceOf = useMemo(() => {
    const byClass = new Map((data?.classes ?? []).map((c) => [c.id, c.price]));
    const out = new Map<string, number>();
    for (const row of data?.rows ?? []) for (const s of row.seats) if (s) out.set(s.id, byClass.get(row.classId) ?? 0);
    return out;
  }, [data]);
  const total = selected.reduce((n, s) => n + (priceOf.get(s) ?? 0), 0);

  const avail = Math.min(width, 560) - 32 - 40; // screen margins and the row letters
  const units = Math.max(1, ...(data?.rows ?? []).map((row) => row.seats.reduce((n, c) => n + (c ? 1 : 0.8), 0)));
  const size = Math.max(20, Math.min(34, Math.floor(avail / units) - 4));

  const toggle = (seatId: string) => {
    setNotice(null);
    setSelected((cur) => {
      if (cur.includes(seatId)) return cur.filter((s) => s !== seatId);
      const cap = meet ? 2 : data?.maxSeats;
      if (data && cap !== undefined && cur.length >= cap) {
        setNotice({ tone: 'warning', text: meet ? 'A plan for two needs exactly 2 seats.' : `You can book up to ${data.maxSeats} seats at a time.` });
        return cur;
      }
      return [...cur, seatId];
    });
  };

  const book = async () => {
    if (status !== 'signedIn') return router.push('/login');
    setBusy(true);
    setNotice(null);
    try {
      const hold = await api.holdSeats(id, selected, meet ? { meetId: meet } : undefined);
      router.push(`/checkout/${hold.paymentRequestId}`);
    } catch (e) {
      setNotice({ tone: 'error', text: errorMessage(e) });
      setSelected([]); // the picture has changed under us: start again from fresh availability
      map.reload();
    } finally {
      setBusy(false);
    }
  };

  const sh = data?.show;
  const labelled = [...selected].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  return (
    <Screen
      footer={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ flex: 1 }}>
            <T variant="small" color={colors.mutedGrey} numberOfLines={1}>{selected.length ? `${selected.length} seat${selected.length > 1 ? 's' : ''} · ${labelled.join(', ')}` : 'No seats selected'}</T>
            <T variant="title2">{formatINR(total)}</T>
          </View>
          <Button
            label={status !== 'signedIn' ? 'Sign in to book' : selected.length ? `Pay ${formatINR(total)}` : meet ? 'Select 2 seats' : 'Select seats'}
            disabled={status === 'signedIn' && (meet ? selected.length !== 2 : selected.length === 0)}
            loading={busy}
            style={{ minWidth: 160 }}
            onPress={book}
          />
        </View>
      }>
      <TopBar
        title={sh?.movieTitle ?? 'Choose seats'}
        subtitle={sh ? `${sh.cinemaName} · ${sh.screenName}` : undefined}
        right={sh ? <View style={{ marginRight: 12 }}><Badge label={sh.certificate} tone="muted" /></View> : null}
      />

      {map.error ? <ErrorState message={map.error} onRetry={map.reload} /> : null}
      {!data && !map.error ? <LoadingState rows={2} /> : null}

      {sh && data ? (
        <View style={{ paddingHorizontal: 16, gap: 14 }}>
          <T variant="caption" color={colors.mutedGrey}>
            {relativeDay(sh.startsAt)} · {formatTime(sh.startsAt)} · {sh.format} · {sh.language}
          </T>

          <View style={{ alignItems: 'center', gap: 4, marginTop: 4 }} accessible accessibilityLabel="The screen is at the front, above row A">
            <View style={styles.screenBar} />
            <T variant="small" color={colors.mutedGrey}>Screen this way</T>
          </View>

          {/* Big screens have wide rows: below the smallest comfortable seat size the map scrolls sideways instead of squeezing or clipping. */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
          <View style={{ gap: 4, alignItems: 'center' }}>
            {data.rows.map((row, i) => {
              const cls = data.classes.find((c) => c.id === row.classId)!;
              const header = i === 0 || data.rows[i - 1].classId !== row.classId;
              return (
                <View key={row.label} style={{ alignItems: 'center' }}>
                  {header ? (
                    <View style={styles.classHeader}>
                      <T variant="label" color={colors.mutedGrey} accessibilityRole="header">{cls.name} · {formatINR(cls.price)}</T>
                    </View>
                  ) : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <T variant="small" color={colors.mutedGrey} style={{ width: 20, textAlign: 'center' }}>{row.label}</T>
                    {row.seats.map((cell, k) => {
                      if (!cell) return <View key={`gap-${k}`} style={{ width: size * 0.8 + 4 }} />;
                      const on = selected.includes(cell.id);
                      const taken = cell.status === 'unavailable';
                      return (
                        <Pressable
                          key={cell.id}
                          accessibilityRole="checkbox"
                          accessibilityLabel={`Seat ${cell.id}, ${cls.name}, ${formatINR(cls.price)}, ${taken ? 'unavailable' : on ? 'selected' : 'available'}`}
                          accessibilityState={{ checked: on, disabled: taken }}
                          aria-checked={on}
                          disabled={taken}
                          onPress={() => toggle(cell.id)}
                          hitSlop={2}
                          style={[styles.seat, { width: size, height: size }, taken ? styles.seatTaken : on ? styles.seatOn : styles.seatFree]}>
                          {taken ? null : <T style={{ fontFamily: fonts.semibold, fontSize: size > 26 ? 11 : 9, color: on ? colors.white : colors.nearBlack }}>{cell.number}</T>}
                        </Pressable>
                      );
                    })}
                    <T variant="small" color={colors.mutedGrey} style={{ width: 20, textAlign: 'center' }}>{row.label}</T>
                  </View>
                </View>
              );
            })}
          </View>
          </ScrollView>

          <View style={styles.legend}>
            {([['Available', styles.seatFree], ['Selected', styles.seatOn], ['Sold', styles.seatTaken]] as const).map(([label, st]) => (
              <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={[styles.seat, st, { width: 18, height: 18, margin: 0 }]} />
                <T variant="small" color={colors.mutedGrey}>{label}</T>
              </View>
            ))}
          </View>

          {notice ? <Notice tone={notice.tone}><T variant="caption">{notice.text}</T></Notice> : null}
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Icon name="clock" size={16} color={colors.mutedGrey} />
            <T variant="small" color={colors.mutedGrey} style={{ flex: 1 }}>We hold your seats for {data.holdMinutes} minutes while you pay. Unpaid seats go back on sale.</T>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenBar: { width: '70%', height: 6, borderRadius: 3, backgroundColor: colors.pink },
  classHeader: { alignSelf: 'stretch', alignItems: 'center', paddingTop: 12, paddingBottom: 6 },
  seat: { margin: 2, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  seatFree: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.success },
  seatOn: { backgroundColor: colors.pink, borderWidth: 1.5, borderColor: colors.pink },
  seatTaken: { backgroundColor: colors.hairline, borderWidth: 1.5, borderColor: colors.hairline },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 20, paddingVertical: 6 },
});
