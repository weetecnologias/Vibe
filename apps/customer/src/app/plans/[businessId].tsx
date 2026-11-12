import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { api, type VenuePlan } from '@/api';
import { Badge, Button, Card, EmptyState, ErrorState, Icon, LoadingState, Notice, Screen, T, TopBar } from '@/components/ui';
import { passEnd } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { errorMessage, useAsync } from '@/lib/useAsync';
import { useSession } from '@/state/session';
import { colors, radius } from '@/theme/tokens';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dayLabel = (d: string) => { const [y, m, day] = d.split('-').map(Number); return `${day} ${MON[m - 1]} ${y}`; };
const key = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const perMonthLabel = (p: VenuePlan) => (p.months === 1 ? 'a month' : `for ${p.months} months`);

/** Start options: from today, or the 1st of the next two months (the backend takes start dates up to 60 days ahead). */
function startOptions(now: number) {
  const t = new Date(now + 330 * 60_000);
  const y = t.getUTCFullYear(), m = t.getUTCMonth();
  const opts = [{ key: key(y, m, t.getUTCDate()), title: 'Start today', note: `${MONTH[m]} · from ${t.getUTCDate()} ${MON[m]}` }];
  for (let i = 1; i <= 2; i++) {
    const d = new Date(Date.UTC(y, m + i, 1));
    opts.push({ key: key(d.getUTCFullYear(), d.getUTCMonth(), 1), title: `${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}`, note: `From 1 ${MON[d.getUTCMonth()]}` });
  }
  return opts;
}

/**
 * Join a gym, yoga or meditation studio, or a trainer by the month: choose the plan, choose the month it starts, then pay through VIBE
 * (member offers and coupons apply at checkout). A trial or a single day is booked by the hour from the slot screen instead.
 */
export default function ChoosePlan() {
  const { businessId, plan: planParam } = useLocalSearchParams<{ businessId: string; plan?: string }>();
  const { status } = useSession();
  const business = useAsync(() => api.getBusiness(businessId), [businessId]);
  const plans = useAsync(() => api.getVenuePlans(businessId), [businessId]);
  const sports = useAsync(() => api.getVenueSports(businessId), [businessId]);
  const [now] = useState(() => Date.now());
  const starts = useMemo(() => startOptions(now), [now]);
  const [planId, setPlanId] = useState<string | null>(planParam ?? null);
  const [start, setStart] = useState(starts[0].key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const plan = plans.data?.find((p) => p.id === planId) ?? plans.data?.[0] ?? null;
  const ends = plan ? passEnd(start, plan.months) : null;

  const proceed = async () => {
    if (!plan) return;
    if (status !== 'signedIn') { router.push('/login'); return; }
    setBusy(true);
    setError(null);
    try {
      const pass = await api.buyVenuePass(plan.id, start);
      router.push(`/checkout/${pass.paymentRequestId}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const footer = plan ? (
    <View style={{ gap: 8 }}>
      {error ? <Notice tone="error"><T variant="caption">{error}</T></Notice> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View>
          <T variant="small" color={colors.mutedGrey}>{plan.name}</T>
          <T variant="title2">{formatINR(plan.price)}</T>
        </View>
        <Button label={status === 'signedIn' ? 'Proceed to pay' : 'Sign in to join'} style={{ flex: 1 }} loading={busy} onPress={proceed} />
      </View>
    </View>
  ) : undefined;

  if (plans.error) return <Screen><TopBar title="Memberships" /><ErrorState message={plans.error} onRetry={plans.reload} /></Screen>;
  return (
    <Screen footer={footer}>
      <TopBar title="Memberships" subtitle={business.data ? `${business.data.name} · ${business.data.area}` : undefined} />
      {plans.loading && !plans.data ? <LoadingState rows={3} /> : plans.data?.length === 0 ? (
        <EmptyState icon="calendar" title="No memberships here" message="This place doesn’t sell monthly plans in the app yet." />
      ) : (
        <View style={{ gap: 18, paddingHorizontal: 16, paddingBottom: 16 }}>
          <View style={{ gap: 10 }}>
            <T variant="label" color={colors.mutedGrey}>1 · Choose a plan</T>
            {plans.data?.map((p) => {
              const on = plan?.id === p.id;
              return (
                <Pressable key={p.id} onPress={() => setPlanId(p.id)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${p.name}, ${formatINR(p.price)} ${perMonthLabel(p)}`}
                  style={[styles.plan, on && styles.planOn]}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                    <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.dot} /> : null}</View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <T variant="bodyStrong">{p.name}</T>
                      {p.description ? <T variant="small" color={colors.mutedGrey}>{p.description}</T> : null}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <T variant="bodyStrong">{formatINR(p.price)}</T>
                      <T variant="small" color={colors.mutedGrey}>{p.months === 1 ? 'a month' : `${formatINR(Math.round(p.perMonth / 100) * 100)}/month`}</T>
                    </View>
                  </View>
                  {on && p.benefits.length ? (
                    <View style={{ gap: 4, paddingLeft: 30 }}>
                      {p.benefits.map((x) => (
                        <View key={x} style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                          <Icon name="check" size={14} color={colors.success} strokeWidth={3} />
                          <T variant="small">{x}</T>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          <View style={{ gap: 10 }}>
            <T variant="label" color={colors.mutedGrey}>2 · Choose the month you start</T>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {starts.map((s) => {
                const on = s.key === start;
                return (
                  <Pressable key={s.key} onPress={() => setStart(s.key)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${s.title}, ${s.note}`}
                    style={[styles.month, on && styles.monthOn]}>
                    <T variant="captionStrong" color={on ? colors.white : colors.nearBlack} align="center">{s.title}</T>
                    <T variant="small" color={on ? colors.white : colors.mutedGrey} align="center">{s.note}</T>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {plan && ends ? (
            <Card style={{ padding: 16, gap: 8 }}>
              <T variant="headline">Your membership</T>
              <View style={styles.between}><T variant="caption" color={colors.mutedGrey}>Plan</T><T variant="captionStrong">{plan.name}</T></View>
              <View style={styles.between}><T variant="caption" color={colors.mutedGrey}>Valid</T><T variant="captionStrong">{dayLabel(start)} – {dayLabel(ends)}</T></View>
              <View style={styles.between}><T variant="caption" color={colors.mutedGrey}>Price</T><T variant="captionStrong">{formatINR(plan.price)}</T></View>
              <Badge label="Member offers, coupons and the VIBE fee are shown at checkout" tone="muted" />
            </Card>
          ) : null}

          {sports.data?.length ? (
            <Pressable onPress={() => router.push(`/book/${businessId}`)} accessibilityRole="button" accessibilityLabel="Book a trial or one-day session by the hour" style={styles.trial}>
              <Icon name="clock" size={20} color={colors.pink} />
              <View style={{ flex: 1 }}>
                <T variant="captionStrong">Want a trial or just one day?</T>
                <T variant="small" color={colors.mutedGrey}>Book a single session by the hour instead.</T>
              </View>
              <Icon name="chevronRight" size={16} />
            </Pressable>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  plan: { padding: 14, gap: 10, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.white },
  planOn: { borderColor: colors.pink },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  radioOn: { borderColor: colors.pink },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.pink },
  month: { flex: 1, paddingVertical: 12, paddingHorizontal: 6, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.white, gap: 2 },
  monthOn: { backgroundColor: colors.nearBlack, borderColor: colors.nearBlack },
  trial: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.md, backgroundColor: colors.softWhite },
});
