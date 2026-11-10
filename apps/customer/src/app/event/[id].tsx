import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api';
import { Badge, BackButton, Button, Card, ErrorState, Icon, LoadingState, Notice, Photo, Screen, T } from '@/components/ui';
import { formatDay, formatTime } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { errorMessage, useAsync } from '@/lib/useAsync';
import { isValidPersonName } from '@/lib/validation';
import { useSession } from '@/state/session';
import { colors, fonts, radius } from '@/theme/tokens';

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { status, user } = useSession();
  const ev = useAsync(() => api.getEvent(id), [id]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [names, setNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const e = ev.data;
  const total = useMemo(() => (e ? e.ticketTypes.reduce((n, t) => n + (qty[t.id] ?? 0) * t.price, 0) : 0), [e, qty]);
  const count = Object.values(qty).reduce((a, b) => a + b, 0);
  const attendees = Array.from({ length: count }, (_, i) => names[i] ?? (i === 0 ? user?.name ?? '' : ''));
  const namesValid = attendees.every(isValidPersonName);

  if (ev.error) return <View style={{ flex: 1, paddingTop: insets.top }}><BackButton /><ErrorState message={ev.error} onRetry={ev.reload} /></View>;
  if (!e) return <View style={{ flex: 1, paddingTop: insets.top + 48, backgroundColor: colors.softWhite }}><LoadingState rows={2} /></View>;

  const change = (tid: string, delta: number, max: number) =>
    setQty((q) => ({ ...q, [tid]: Math.max(0, Math.min(max, (q[tid] ?? 0) + delta)) }));

  const reserve = async () => {
    if (status !== 'signedIn') return router.push('/login');
    setShowErrors(true);
    if (!count || !namesValid) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.reserveTickets(e.id, Object.entries(qty).map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity })), attendees.map((a) => a.trim()));
      router.push(`/checkout/${res.paymentRequestId}`);
    } catch (err) {
      setError(errorMessage(err));
      ev.reload(); // refresh remaining inventory
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      edgeToEdge
      footer={
        e.soldOut ? <Button label="Sold out" disabled /> : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <View>
              <T variant="small" color={colors.mutedGrey}>{count ? `${count} ticket${count > 1 ? 's' : ''}` : 'From'}</T>
              <T variant="title2">{formatINR(count ? total : e.fromPrice)}</T>
            </View>
            <Button
              label={status !== 'signedIn' ? 'Sign in to book' : count ? 'Reserve and pay' : 'Choose tickets'}
              disabled={status === 'signedIn' && !count}
              loading={busy}
              style={{ flex: 1 }}
              onPress={reserve}
            />
          </View>
        )
      }>
      <Photo seed={e.id} uri={e.coverUrl} style={{ height: 260 }} accessibilityLabel={`Photo for ${e.title}`}>
        <View style={{ position: 'absolute', top: insets.top + 8, left: 16 }}><BackButton tone="light" fallback="/events" /></View>
      </Photo>

      <View style={{ paddingHorizontal: 16, gap: 18, marginTop: 18 }}>
        <View style={{ gap: 6 }}>
          <T variant="label" color={colors.mutedGrey}>{e.kind}{e.ageLimit ? ` · ${e.ageLimit}+ only` : ''}</T>
          <T variant="title1" accessibilityRole="header">{e.title}</T>
          <T variant="caption" color={colors.mutedGrey}>By {e.organiser}</T>
        </View>

        <Card style={{ padding: 16, gap: 12 }}>
          <Fact icon="calendar" title={formatDay(e.startsAt)} sub={`${formatTime(e.startsAt)} · gates open ${formatTime(e.gatesOpenAt)}`} />
          <Fact icon="pin" title={e.venue} sub={e.area} />
        </Card>

        <T variant="body" color={colors.mutedGrey}>{e.description}</T>

        <View style={{ gap: 10 }}>
          <T variant="headline">Tickets</T>
          {e.ticketTypes.map((t) => {
            const n = qty[t.id] ?? 0;
            const max = Math.min(t.maxPerOrder, t.remaining);
            const soldOut = t.remaining === 0;
            return (
              <Card key={t.id} style={[styles.tt, n > 0 && { borderColor: colors.pink, borderWidth: 1.5 }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <T variant="bodyStrong">{t.name}</T>
                    {soldOut ? <Badge label="Sold out" tone="muted" /> : t.remaining <= 20 ? <Badge label={`${t.remaining} left`} tone="warning" /> : null}
                  </View>
                  <T variant="small" color={colors.mutedGrey}>{t.description}</T>
                  <T variant="captionStrong">{formatINR(t.price)}</T>
                </View>
                {!soldOut ? (
                  <View style={styles.stepper}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Remove one ${t.name}`} disabled={n === 0} onPress={() => change(t.id, -1, max)} style={[styles.stepBtn, n === 0 && { opacity: 0.35 }]}>
                      <Icon name="minus" size={18} strokeWidth={2.2} />
                    </Pressable>
                    <T variant="bodyStrong" style={{ minWidth: 18, textAlign: 'center' }} accessibilityLabel={`${n} ${t.name} tickets`}>{n}</T>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Add one ${t.name}`} disabled={n >= max} onPress={() => change(t.id, 1, max)} style={[styles.stepBtn, styles.stepPlus, n >= max && { opacity: 0.35 }]}>
                      <Icon name="plus" size={18} color={colors.white} strokeWidth={2.2} />
                    </Pressable>
                  </View>
                ) : null}
              </Card>
            );
          })}
        </View>

        {count > 0 ? (
          <View style={{ gap: 10 }}>
            <T variant="headline">Attendee names</T>
            <T variant="small" color={colors.mutedGrey}>Each ticket is issued in one person’s name{e.ageLimit ? ` and checked against ID (${e.ageLimit}+)` : ''}.</T>
            {attendees.map((a, i) => {
              const bad = showErrors && !isValidPersonName(a);
              return (
                <View key={i}>
                  <TextInput
                    value={a}
                    onChangeText={(v) => setNames((prev) => { const next = [...attendees]; next[i] = v; void prev; return next; })}
                    placeholder={`Ticket ${i + 1} · full name`}
                    placeholderTextColor={colors.mutedGrey}
                    accessibilityLabel={`Name for ticket ${i + 1}`}
                    autoCapitalize="words"
                    style={[styles.input, { borderColor: bad ? colors.error : colors.hairline }]}
                  />
                  {bad ? <T variant="small" color={colors.error} style={{ marginTop: 4 }}>Enter a name for this ticket</T> : null}
                </View>
              );
            })}
            <Notice tone="info" icon="clock"><T variant="small" color={colors.mutedGrey}>We hold your tickets for 10 minutes while you pay. Unpaid holds go back on sale.</T></Notice>
          </View>
        ) : null}

        {error ? <Notice tone="error"><T variant="caption">{error}</T></Notice> : null}

        {e.terms.length ? (
          <Card style={{ padding: 16, gap: 6 }}>
            <T variant="headline">Good to know</T>
            {e.terms.map((t) => <T key={t} variant="caption" color={colors.mutedGrey}>• {t}</T>)}
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

function Fact({ icon, title, sub }: { icon: 'calendar' | 'pin'; title: string; sub: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
      <View style={styles.factIcon}><Icon name={icon} size={20} /></View>
      <View><T variant="captionStrong">{title}</T><T variant="small" color={colors.mutedGrey}>{sub}</T></View>
    </View>
  );
}

const styles = StyleSheet.create({
  tt: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
  stepPlus: { backgroundColor: colors.pink, borderColor: colors.pink },
  input: { height: 50, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: 14, fontFamily: fonts.medium, fontSize: 15, color: colors.nearBlack, backgroundColor: colors.white },
  factIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.softWhite, alignItems: 'center', justifyContent: 'center' },
});
