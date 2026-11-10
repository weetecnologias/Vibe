import { router, useLocalSearchParams } from 'expo-router';
import { Pressable, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api';
import { Badge, BackButton, Button, Card, Divider, ErrorState, Icon, IconButton, LoadingState, Notice, Photo, Screen, T } from '@/components/ui';
import { daysUntil, formatDate } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { useAsync } from '@/lib/useAsync';
import { useSession } from '@/state/session';
import { colors, fonts } from '@/theme/tokens';

const STEPS = [
  ['Tap Redeem offer at the venue', 'We let the business know you’re redeeming. Staff see only your first name and VIBE ID.'],
  ['Staff send your bill', 'They enter the eligible amount in VIBE for Business.'],
  ['Check the discount and pay', 'See the bill, discount, taxes and final amount before you approve.'],
  ['Get your receipt', 'Confirmed once our payment partner verifies the payment.'],
];

export default function OfferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { status } = useSession();
  const offer = useAsync(() => api.getOffer(id), [id]);
  const elig = useAsync(() => api.getOfferEligibility(id), [id, status]);
  const o = offer.data;

  if (offer.error) return <View style={{ flex: 1, paddingTop: insets.top }}><BackButton /><ErrorState message={offer.error} onRetry={offer.reload} /></View>;
  if (!o) return <View style={{ flex: 1, paddingTop: insets.top + 48, backgroundColor: colors.softWhite }}><LoadingState rows={2} /></View>;

  const days = daysUntil(o.endsAt);
  const e = elig.data;
  const guest = status !== 'signedIn';

  const footer = (
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
      {o.maxDiscount ? (
        <View><T variant="small" color={colors.mutedGrey}>Save up to</T><T variant="title2">{formatINR(o.maxDiscount)}</T></View>
      ) : null}
      {guest ? (
        <Button label="Sign in to redeem" style={{ flex: 1 }} onPress={() => router.push('/login')} />
      ) : e && !e.eligible && o.memberOnly && e.reason.includes('members') ? (
        <Button label="Become a member" style={{ flex: 1 }} onPress={() => router.push('/membership')} />
      ) : (
        <Button label="Redeem offer" style={{ flex: 1 }} disabled={!e?.eligible} loading={elig.loading && !e} onPress={() => router.push(`/redeem/${o.id}`)} />
      )}
    </View>
  );

  return (
    <Screen edgeToEdge footer={footer}>
      <Photo uri={o.coverUrl} scrim seed={o.id} style={{ height: 250 }}>
        <View style={[styles.heroBar, { top: insets.top + 8 }]}>
          <BackButton tone="light" fallback="/home" />
          <IconButton icon="share" label="Share offer" onPress={() => Share.share({ message: `${o.title} at ${o.businessName} on VIBE` })} />
        </View>
        <View style={styles.heroText}>
          {o.memberOnly ? <Badge label="Member exclusive" tone="pink" uppercase /> : null}
          <T style={styles.big}>{o.headline} {o.headlineSub}</T>
        </View>
      </Photo>

      <View style={styles.card}>
        <Pressable accessibilityRole="link" onPress={() => router.push(`/business/${o.businessId}`)} style={styles.bizRow}>
          <View style={styles.logo}><T style={{ fontFamily: fonts.displayHeavy, color: colors.pink, fontSize: 15 }}>{o.businessName.split(' ').map((w) => w[0]).slice(0, 2).join('')}</T></View>
          <View style={{ flex: 1 }}><T variant="bodyStrong">{o.businessName}</T><T variant="small" color={colors.mutedGrey}>{o.area}</T></View>
          <Icon name="chevronRight" size={18} strokeWidth={2} />
        </Pressable>
        <Divider />
        <T variant="title1" accessibilityRole="header">{o.title}</T>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Icon name="clock" size={16} color={colors.mutedGrey} />
          <T variant="caption" color={colors.mutedGrey}>{o.scheduleLabel} · valid till {formatDate(o.endsAt)}</T>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {o.channels.map((c) => <Badge key={c} label={c} tone="muted" />)}
          {o.maxDiscount ? <Badge label={`Max ${formatINR(o.maxDiscount)} off`} tone="muted" /> : null}
          {o.minBill ? <Badge label={`Min bill ${formatINR(o.minBill)}`} tone="muted" /> : null}
          {days <= 21 ? <Badge label={`Ends in ${days} day${days === 1 ? '' : 's'}`} tone="warning" /> : null}
        </View>
      </View>

      <View style={{ paddingHorizontal: 16, gap: 20, marginTop: 14 }}>
        {e ? (
          <Notice tone={e.eligible ? 'success' : 'warning'} icon={e.eligible ? 'shield' : 'info'}>
            <T variant="caption">
              <T variant="captionStrong">{e.eligible ? 'You’re eligible. ' : 'Not available yet. '}</T>
              {e.reason}{e.memberValidUntil && e.eligible ? ` · until ${formatDate(e.memberValidUntil)}` : ''}
              {e.redemptionsLeftToday !== null && e.eligible ? ` · ${e.redemptionsLeftToday} redemption left today` : ''}
            </T>
          </Notice>
        ) : null}

        {o.example ? (
          <Card dark style={{ padding: 18, gap: 10 }}>
            <T variant="label" color={colors.onDarkMuted}>Example</T>
            <Line k="Eligible bill" v={formatINR(o.example.bill)} />
            <Line k={`${o.title.includes('%') || o.type === 'percentage' ? `Member offer · ${o.headline}` : 'Offer'}`} v={formatINR(-o.example.discount)} />
            <Divider dark />
            <View style={styles.between}><T variant="bodyStrong" color={colors.white}>You pay</T><T variant="title2" color={colors.white}>{formatINR(o.example.payable)}</T></View>
          </Card>
        ) : null}

        <View style={{ gap: 14 }}>
          <View style={styles.between}><T variant="headline">How it works</T><T variant="small" color={colors.mutedGrey}>No QR or PIN needed</T></View>
          {STEPS.map(([title, text], i) => (
            <View key={title} style={{ flexDirection: 'row', gap: 14 }}>
              <View style={[styles.step, { backgroundColor: i === 0 ? colors.pink : colors.nearBlack }]}><T variant="captionStrong" color={colors.white}>{i + 1}</T></View>
              <View style={{ flex: 1, paddingTop: 3 }}><T variant="captionStrong">{title}</T><T variant="caption" color={colors.mutedGrey}>{text}</T></View>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Card style={{ flex: 1, padding: 14, gap: 6 }}><T variant="label" color={colors.success}>Applies to</T><T variant="caption">{o.appliesTo}</T></Card>
          <Card style={{ flex: 1, padding: 14, gap: 6 }}><T variant="label" color={colors.error}>Doesn’t apply to</T><T variant="caption">{o.excludes}</T></Card>
        </View>

        <Card style={{ padding: 16, gap: 8 }}>
          <T variant="headline">Terms</T>
          {o.terms.map((t) => <T key={t} variant="caption" color={colors.mutedGrey}>• {t}</T>)}
        </Card>
      </View>
    </Screen>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return <View style={styles.between}><T variant="caption" color={colors.onDarkMuted}>{k}</T><T variant="captionStrong" color={colors.white}>{v}</T></View>;
}

const styles = StyleSheet.create({
  heroBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  heroText: { position: 'absolute', left: 20, bottom: 44, gap: 8 },
  big: { fontFamily: fonts.display, fontSize: 48, lineHeight: 52, letterSpacing: -1.4, color: colors.white },
  card: { marginTop: -24, marginHorizontal: 16, backgroundColor: colors.white, borderRadius: 24, borderWidth: 1, borderColor: colors.hairline, padding: 20, gap: 14 },
  bizRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.nearBlack, alignItems: 'center', justifyContent: 'center' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  step: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
