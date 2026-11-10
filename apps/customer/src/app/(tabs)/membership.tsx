import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type Membership, type MembershipPlan } from '@/api';
import { Button, Card, ErrorState, Icon, LoadingState, Notice, T, type IconName } from '@/components/ui';
import { formatDate } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { errorMessage, useAsync } from '@/lib/useAsync';
import { useSession } from '@/state/session';
import { colors, fonts, radius } from '@/theme/tokens';

const BENEFITS: { t: string; s: string; icon: IconName }[] = [
  { t: 'Member-only offers', s: 'Exclusive discounts across 8 categories', icon: 'offer' },
  { t: 'Early access to events', s: 'Book before tickets go on general sale', icon: 'ticket' },
  { t: 'Members-only social events', s: 'Hosted dinners, runs and meetups', icon: 'social' },
  { t: 'Savings tracker', s: 'See exactly what membership saved you', icon: 'wallet' },
];

export default function MembershipTab() {
  const insets = useSafeAreaInsets();
  const { status, user, refreshUser } = useSession();
  const signedIn = status === 'signedIn';
  const m = useAsync(() => (signedIn ? api.getMembership() : Promise.resolve(null)), [signedIn]);
  const plans = useAsync(() => api.getMembershipPlans(), []);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const mem = m.data;
  const active = mem?.status === 'active';
  const currentPlanId = mem?.plan?.id ?? null;
  const selected = picked ?? currentPlanId ?? plans.data?.[0]?.id ?? null;

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ tone: 'success', text: ok });
      m.reload();
      refreshUser().catch(() => undefined);
    } catch (e) {
      setMsg({ tone: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const join = () => act(async () => {
    const { paymentRequestId } = await api.subscribe(selected!);
    router.push(`/checkout/${paymentRequestId}`);
  });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.softWhite }}
      contentContainerStyle={{ paddingBottom: 32, gap: 24 }}
      refreshControl={<RefreshControl refreshing={m.loading && !!mem} onRefresh={m.reload} tintColor={colors.pink} />}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={styles.between}>
          <T variant="title1" color={colors.white} accessibilityRole="header">Membership</T>
          {mem ? <StatusPill m={mem} /> : null}
        </View>
        <MemberCard name={user?.name ?? 'Your name'} m={mem ?? null} />
        {active && mem?.renewsAt ? (
          <T variant="caption" color={colors.onDarkMuted}>
            Renews <T variant="captionStrong" color={colors.white}>{formatDate(mem.renewsAt)}</T> · {formatINR(mem.plan!.price)} via UPI Autopay
          </T>
        ) : mem?.status === 'cancelled' && mem.validUntil ? (
          <T variant="caption" color={colors.onDarkMuted}>Cancelled. Benefits continue until {formatDate(mem.validUntil)}.</T>
        ) : null}
      </View>

      {!signedIn ? (
        <View style={{ paddingHorizontal: 20 }}>
          <Notice tone="info" icon="lock">
            <T variant="caption">Sign in to join VIBE Membership and track your savings.</T>
          </Notice>
          <Button label="Sign in" style={{ marginTop: 12 }} onPress={() => router.push('/login')} />
        </View>
      ) : null}

      {m.error ? <ErrorState message={m.error} onRetry={m.reload} /> : null}
      {signedIn && !mem && !m.error ? <LoadingState rows={2} /> : null}

      {mem && mem.status !== 'none' ? (
        <View style={styles.section}>
          <T variant="title2">Your savings</T>
          <Card style={{ padding: 20, gap: 16 }}>
            <View>
              <T variant="caption" color={colors.mutedGrey}>Saved since joining{mem.savings.since ? ` in ${formatDate(mem.savings.since).split(' ')[1]}` : ''}</T>
              <T style={styles.bigSave}>{formatINR(mem.savings.total)}</T>
              {mem.payments.length ? (
                <T variant="captionStrong" color={colors.success}>
                  That’s {(mem.savings.total / Math.max(1, mem.payments.reduce((n, p) => n + (p.status === 'paid' ? p.amount : 0), 0))).toFixed(1)}× what you’ve paid for membership
                </T>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Stat v={formatINR(mem.savings.thisMonth)} k="This month" />
              <Stat v={String(mem.savings.redemptions)} k="Redemptions" />
              <Stat v={String(mem.savings.places)} k="Places" />
            </View>
            <View style={{ gap: 8 }}>
              <T variant="label" color={colors.mutedGrey}>By category</T>
              {mem.savings.byCategory.map((c) => (
                <View key={c.name} style={styles.between}><T variant="caption">{c.name}</T><T variant="captionStrong">{formatINR(c.amount)}</T></View>
              ))}
            </View>
          </Card>
        </View>
      ) : null}

      <View style={styles.section}>
        <T variant="title2">{active ? 'Plans' : 'Choose a plan'}</T>
        {plans.data?.map((p) => <PlanRow key={p.id} p={p} on={selected === p.id} current={active && currentPlanId === p.id} onPress={() => setPicked(p.id)} />)}
        {msg ? <Notice tone={msg.tone === 'success' ? 'success' : 'error'}><T variant="caption">{msg.text}</T></Notice> : null}
        {signedIn && !active ? (
          <Button label={`Join for ${formatINR(plans.data?.find((p) => p.id === selected)?.price ?? 0)}`} onPress={join} loading={busy} disabled={!selected} />
        ) : null}
        {active && selected && selected !== currentPlanId ? (
          <Button label="Switch at next renewal" onPress={() => act(() => api.changePlan(selected), 'Plan change saved. It applies from your next renewal.')} loading={busy} />
        ) : null}
        <T variant="small" color={colors.mutedGrey}>Prices include GST. Plan changes apply at your next renewal. Pricing is set by VIBE and may change with notice.</T>
      </View>

      <View style={styles.section}>
        <T variant="title2">What you get</T>
        <Card style={{ paddingHorizontal: 18, paddingVertical: 4 }}>
          {BENEFITS.map((b, i) => (
            <View key={b.t} style={[styles.benefit, i < BENEFITS.length - 1 && styles.divider]}>
              <View style={styles.benefitIcon}><Icon name={b.icon} size={20} color={colors.pinkDeep} /></View>
              <View style={{ flex: 1 }}><T variant="captionStrong">{b.t}</T><T variant="small" color={colors.mutedGrey}>{b.s}</T></View>
            </View>
          ))}
        </Card>
      </View>

      {mem && mem.recentSavings.length ? (
        <View style={styles.section}>
          <T variant="title2">Recent savings</T>
          <Card style={{ paddingHorizontal: 18, paddingVertical: 4 }}>
            {mem.recentSavings.slice(0, 5).map((t, i, a) => (
              <View key={t.id} style={[styles.between, { paddingVertical: 12 }, i < a.length - 1 && styles.divider]}>
                <View><T variant="captionStrong">{t.businessName}</T><T variant="small" color={colors.mutedGrey}>{formatDate(t.at)} · paid {formatINR(t.paid)}</T></View>
                <T variant="captionStrong" color={colors.success}>Saved {formatINR(t.saved)}</T>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {mem && mem.payments.length ? (
        <View style={styles.section}>
          <T variant="title2">Membership payments</T>
          <Card style={{ paddingHorizontal: 18, paddingVertical: 4 }}>
            {mem.payments.map((p, i, a) => (
              <View key={p.id} style={[styles.between, { paddingVertical: 12 }, i < a.length - 1 && styles.divider]}>
                <View><T variant="captionStrong">{formatDate(p.at)}</T><T variant="small" color={colors.mutedGrey}>{p.planName} plan</T></View>
                <View style={{ alignItems: 'flex-end' }}>
                  <T variant="captionStrong">{formatINR(p.amount, { decimals: 'always' })}</T>
                  <T variant="label" color={p.status === 'paid' ? colors.success : p.status === 'failed' ? colors.error : colors.mutedGrey}>{p.status}</T>
                </View>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {active ? (
        <View style={[styles.section, { gap: 8 }]}>
          {!confirmCancel ? (
            <Pressable accessibilityRole="button" onPress={() => setConfirmCancel(true)} style={{ paddingVertical: 10 }}>
              <T variant="bodyStrong" color={colors.error}>Cancel membership</T>
            </Pressable>
          ) : (
            <Card style={{ padding: 16, gap: 12, borderColor: colors.error }}>
              <T variant="headline">Cancel your membership?</T>
              <T variant="caption" color={colors.mutedGrey}>
                Auto-renew stops now. Your benefits continue until {mem?.validUntil ? formatDate(mem.validUntil) : 'the end of this period'}. No partial refunds for the current period.
              </T>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button label="Keep it" variant="outline" size="md" style={{ flex: 1 }} onPress={() => setConfirmCancel(false)} />
                <Button label="Cancel" variant="danger" size="md" style={{ flex: 1 }} loading={busy} onPress={() => act(() => api.cancelMembership(), 'Membership cancelled. Auto-renew is off.').then(() => setConfirmCancel(false))} />
              </View>
            </Card>
          )}
          <T variant="small" color={colors.mutedGrey}>See the cancellation & refund policy in Profile › Terms & policies.</T>
        </View>
      ) : null}
    </ScrollView>
  );
}

function StatusPill({ m }: { m: Membership }) {
  const map = {
    active: { label: 'Active', bg: colors.successTint, fg: colors.success },
    cancelled: { label: 'Cancelled', bg: colors.warningTint, fg: colors.warning },
    past_due: { label: 'Payment due', bg: colors.errorTint, fg: colors.error },
    none: { label: 'Not a member', bg: colors.darkSurface, fg: colors.white },
  }[m.status];
  return (
    <View style={[styles.pill, { backgroundColor: map.bg }]}>
      <View style={[styles.pillDot, { backgroundColor: map.fg }]} />
      <T variant="small" color={map.fg} style={{ fontFamily: fonts.bold }}>{map.label}</T>
    </View>
  );
}

function MemberCard({ name, m }: { name: string; m: Membership | null }) {
  const live = m && m.status !== 'none';
  return (
    <View style={[styles.card, !live && { backgroundColor: colors.darkSurface }]} accessibilityLabel={live ? `VIBE member card for ${name}, number ${m!.memberNo}` : 'VIBE membership card preview'}>
      <View style={styles.ring} />
      <View style={styles.between}>
        <View>
          <T style={{ fontFamily: fonts.displayHeavy, fontSize: 26, letterSpacing: -1.1, color: colors.white }}>VIBE</T>
          <T variant="label" color={colors.white} style={{ letterSpacing: 2 }}>Member</T>
        </View>
        {live && m!.plan ? <View style={styles.planTag}><T variant="label" color={colors.white}>{m!.plan.name}</T></View> : null}
      </View>
      <View style={{ gap: 4 }}>
        <T variant="title3" color={colors.white}>{live ? name : 'Join to unlock member prices'}</T>
        {live ? (
          <View style={styles.between}>
            <T variant="caption" color={colors.white} style={{ letterSpacing: 1.4 }}>{m!.memberNo}</T>
            {m!.validUntil ? <T variant="caption" color={colors.white}>Valid till {formatDate(m!.validUntil)}</T> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function PlanRow({ p, on, current, onPress }: { p: MembershipPlan; on: boolean; current: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} onPress={onPress} style={[styles.plan, { borderColor: on ? colors.pink : colors.hairline, borderWidth: on ? 2 : 1 }]}>
      <View style={[styles.radio, { borderColor: on ? colors.pink : colors.mutedGrey, borderWidth: on ? 2 : 1.5 }]}>{on ? <View style={styles.radioDot} /> : null}</View>
      <View style={{ flex: 1 }}><T variant="bodyStrong">{p.name}</T><T variant="small" color={colors.mutedGrey}>{p.note}</T></View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <T variant="title3">{formatINR(p.price)}</T>
        {current ? <View style={[styles.tag, { backgroundColor: colors.nearBlack }]}><T variant="label" color={colors.white}>Current</T></View>
          : p.savingsLabel ? <View style={[styles.tag, { backgroundColor: colors.pinkTint }]}><T variant="label" color={colors.pinkDeep}>{p.savingsLabel}</T></View> : null}
      </View>
    </Pressable>
  );
}

function Stat({ v, k }: { v: string; k: string }) {
  return (
    <View style={styles.stat}><T variant="headline">{v}</T><T variant="small" color={colors.mutedGrey}>{k}</T></View>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.nearBlack, paddingHorizontal: 20, paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, gap: 18 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  card: { height: 210, borderRadius: 24, backgroundColor: colors.pink, padding: 22, justifyContent: 'space-between', overflow: 'hidden' },
  ring: { position: 'absolute', right: -40, top: -40, width: 180, height: 180, borderRadius: 90, borderWidth: 28, borderColor: 'rgba(255,255,255,0.12)' },
  planTag: { backgroundColor: colors.nearBlack, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  section: { paddingHorizontal: 20, gap: 12 },
  bigSave: { fontFamily: fonts.display, fontSize: 34, lineHeight: 42, letterSpacing: -0.6, color: colors.nearBlack },
  stat: { flex: 1, padding: 12, borderRadius: 14, backgroundColor: colors.softWhite, gap: 2 },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: radius.lg, backgroundColor: colors.white },
  radio: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.pink },
  tag: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  benefitIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.pinkTint, alignItems: 'center', justifyContent: 'center' },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
});
