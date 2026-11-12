import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { api, type RedeemMode, type Redemption } from '@/api';
import { BillBreakdown, PayPanel } from '@/components/PayPanel';
import { RateVisit } from '@/components/RateVisit';
import { Badge, Button, Card, EmptyState, ErrorState, Icon, LoadingState, Notice, Screen, T, TopBar } from '@/components/ui';
import { formatCountdown } from '@/lib/dates';
import { errorMessage, useAsync, useCountdown } from '@/lib/useAsync';
import { colors, fonts, radius } from '@/theme/tokens';

const POLL_MS = 3000;

/**
 * Two ways to redeem, chosen here:
 *  - Show a code: a 6-digit code valid for 5 minutes. Pay the place as usual; staff confirm the code on their dashboard.
 *  - Get the bill in VIBE: staff send the bill to this screen and you pay through VIBE.
 * Places that don't take payment through VIBE only offer the code.
 */
export default function Redeem() {
  const { offerId } = useLocalSearchParams<{ offerId: string }>();
  const offer = useAsync(() => api.getOffer(offerId), [offerId]);
  const [red, setRed] = useState<Redemption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<RedeemMode | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  const start = async (mode: RedeemMode) => {
    setStarting(mode);
    setError(null);
    try { setRed(await api.createRedemption(offerId, mode)); } catch (e) { setError(errorMessage(e)); } finally { setStarting(null); }
  };

  // Wait for staff: the bill to arrive, or the code to be confirmed (push notification in production; polling as a fallback).
  useEffect(() => {
    if (!red || (red.status !== 'awaiting_bill' && red.status !== 'code_issued')) return;
    const t = setInterval(() => { api.getRedemption(red.id).then(setRed).catch(() => undefined); }, POLL_MS);
    return () => clearInterval(t);
  }, [red]);

  const expiresAt = red?.paymentRequest?.expiresAt ?? red?.expiresAt;
  const left = useCountdown(expiresAt) ?? 0;

  const cancel = async () => {
    if (red) await api.cancelRedemption(red.id).catch(() => undefined);
    router.back();
  };

  const demo = async (fn: () => Promise<Redemption>) => {
    setDemoBusy(true);
    try { setRed(await fn()); } catch (e) { setError(errorMessage(e)); } finally { setDemoBusy(false); }
  };

  if (error && !red) {
    return (
      <Screen>
        <TopBar title="Redeem offer" />
        <ErrorState message={error} />
        <View style={{ paddingHorizontal: 20 }}><Button label="Back to offer" variant="outline" onPress={() => router.back()} /></View>
      </Screen>
    );
  }
  if (!red) {
    const o = offer.data;
    const modes: RedeemMode[] = o?.redeemModes?.length ? o.redeemModes : ['code', 'bill'];
    return (
      <Screen>
        <TopBar title="Redeem offer" subtitle={o ? `${o.title} · ${o.businessName}` : undefined} />
        {!o ? <LoadingState rows={2} /> : (
          <View style={{ paddingHorizontal: 16, gap: 14, marginTop: 6 }}>
            <T variant="title2">How do you want to redeem?</T>
            {modes.includes('code') ? (
              <Option
                icon="offer" title="Show a code at the counter" badge="Valid 5 minutes"
                text="Get a one-time code now. Show it when you pay the place as usual; staff confirm it and give you the discount."
                loading={starting === 'code'} onPress={() => start('code')}
              />
            ) : null}
            {modes.includes('bill') ? (
              <Option
                icon="receipt" title="Get the bill in VIBE and pay here" badge="Pay with UPI or card"
                text="Staff send your bill to this screen. The discount is worked out for you, and you pay securely through VIBE."
                loading={starting === 'bill'} onPress={() => start('bill')}
              />
            ) : (
              <Notice tone="info"><T variant="caption">{o.businessName} takes payment at the counter, so redeem with a code.</T></Notice>
            )}
            <T variant="small" color={colors.mutedGrey} align="center">Staff only ever see your first name and VIBE ID.</T>
          </View>
        )}
      </Screen>
    );
  }

  const expired = red.status === 'expired' || (expiresAt && left === 0 && (red.status === 'awaiting_bill' || red.status === 'code_issued' || red.status === 'bill_ready'));
  const done = red.status === 'paid' || red.status === 'redeemed';

  if (red.mode === 'code') {
    return (
      <Screen>
        <TopBar title="Your code" subtitle={`${red.businessName} · ${red.branchName}`} right={red.status === 'code_issued' && !expired ? <Badge label={`Valid ${formatCountdown(left)}`} tone="warning" /> : null} />
        <View style={{ paddingHorizontal: 16, gap: 16, marginTop: 6 }}>
          {expired ? (
            <EmptyState icon="clock" title="This code has run out" message="Codes work for 5 minutes. Get a new one when you’re at the counter." actionLabel="Get a new code" onAction={() => start('code')} />
          ) : red.status === 'code_issued' && red.code ? (
            <>
              <Card dark style={styles.codeCard}>
                <T variant="label" color={colors.onDarkMuted}>Show this to staff</T>
                <T style={styles.code} accessibilityLabel={`Code ${red.code.split('').join(' ')}`}>{red.code.slice(0, 3)} {red.code.slice(3)}</T>
                <T variant="caption" color={colors.onDarkMuted} align="center">{red.customerDisplayName} · VIBE ID {red.vibeId}</T>
              </Card>
              <Notice tone="info" icon="info"><T variant="caption">Pay the place as usual. Once staff confirm your code, this screen updates and you’ll get the discount.</T></Notice>
              {api.demo ? <Button label="Demo: staff confirm the code" variant="outline" size="md" loading={demoBusy} onPress={() => demo(() => api.demo!.simulateCodeConfirmed(red.id))} /> : null}
            </>
          ) : done ? (
            <Card style={{ padding: 20, gap: 8, alignItems: 'center' }}>
              <View style={styles.tick}><Icon name="check" size={28} color={colors.white} strokeWidth={2.5} /></View>
              <T variant="title2" align="center">Redeemed at {red.businessName}</T>
              <T variant="caption" color={colors.mutedGrey} align="center">Staff confirmed your code. Enjoy!</T>
            </Card>
          ) : (
            <Notice tone="warning"><T variant="caption">This code was cancelled.</T></Notice>
          )}

          {red.place && !done ? <PlaceCard place={red.place} /> : null}
          {done && (red.canReview || red.review) ? <RateVisit redemptionId={red.id} businessName={red.businessName} done={red.review} /> : null}
          {red.status === 'code_issued' && !expired ? <Button label="I don’t need the code" variant="ghost" size="md" onPress={cancel} /> : null}
          {done ? <Button label="Done" variant="outline" size="md" onPress={() => router.replace('/home')} /> : null}
        </View>
      </Screen>
    );
  }

  const step = red.status === 'awaiting_bill' ? 1 : 2;
  return (
    <Screen>
      <TopBar
        title="Redeem offer"
        subtitle={`${red.businessName} · ${red.branchName}`}
        right={!expired && !done && expiresAt ? <Badge label={`Expires ${formatCountdown(left)}`} tone="warning" /> : null}
      />

      <View style={styles.steps} accessibilityLabel={`Step ${step + 1} of 3`}>
        {['Requested', 'Bill received', 'Pay'].map((s, i) => {
          const isDone = i < step || done;
          const current = i === step && !done;
          return (
            <View key={s} style={[styles.step, i < 2 && { flex: 1 }]}>
              <View style={[styles.stepDot, { backgroundColor: isDone ? colors.success : current ? colors.pink : colors.hairline }]}>
                <T variant="small" color={isDone || current ? colors.white : colors.mutedGrey}>{isDone ? '✓' : i + 1}</T>
              </View>
              <T variant="small" color={current || isDone ? colors.nearBlack : colors.mutedGrey}>{s}</T>
              {i < 2 ? <View style={[styles.stepLine, { backgroundColor: isDone ? colors.success : colors.hairline }]} /> : null}
            </View>
          );
        })}
      </View>

      <View style={{ paddingHorizontal: 16, gap: 16, marginTop: 14 }}>
        <Card dark style={styles.identity}>
          <View style={styles.avatar}><T variant="captionStrong" color={colors.white}>{red.customerDisplayName.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</T></View>
          <View style={{ flex: 1 }}>
            <T variant="small" color={colors.onDarkMuted}>Staff see you as</T>
            <T variant="headline" color={colors.white}>{red.customerDisplayName} · VIBE ID {red.vibeId}</T>
          </View>
        </Card>

        {expired ? (
          <EmptyState icon="clock" title="This request expired" message="Nothing was charged. Start a new redemption when you’re ready to pay." actionLabel="Back to offer" onAction={() => router.back()} />
        ) : red.status === 'awaiting_bill' ? (
          <Card style={{ padding: 20, gap: 10, alignItems: 'center' }}>
            <T variant="headline" align="center">Waiting for your bill</T>
            <T variant="caption" color={colors.mutedGrey} align="center">
              Tell the staff your name and VIBE ID. They’ll send the bill to this screen from VIBE for Business. You can keep the app open or come back to it.
            </T>
            {api.demo ? (
              <View style={{ alignSelf: 'stretch', gap: 6, marginTop: 6 }}>
                <Button label="Demo: merchant sends ₹1,000 bill" variant="outline" size="md" loading={demoBusy} onPress={() => demo(() => api.demo!.simulateMerchantBill(red.id, 100000))} />
                <T variant="small" color={colors.warning} align="center">Demo only. In the real app the merchant dashboard sends this.</T>
              </View>
            ) : null}
          </Card>
        ) : red.status === 'paid' ? (
          <Notice tone="success"><T variant="caption">This bill has been paid.</T></Notice>
        ) : red.paymentRequest ? (
          <>
            <BillBreakdown req={red.paymentRequest} title="Bill from merchant" />
            <PayPanel req={red.paymentRequest} />
          </>
        ) : null}

        {done && (red.canReview || red.review) ? <RateVisit redemptionId={red.id} businessName={red.businessName} done={red.review} /> : null}
        {red.status === 'awaiting_bill' || red.status === 'bill_ready' ? (
          <Button label={red.status === 'bill_ready' ? 'Bill looks wrong? Cancel and ask staff' : 'Cancel request'} variant="ghost" size="md" onPress={cancel} />
        ) : null}
      </View>
    </Screen>
  );
}

function Option({ icon, title, text, badge, loading, onPress }: { icon: 'offer' | 'receipt'; title: string; text: string; badge: string; loading: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} disabled={loading} style={({ pressed }) => [styles.option, pressed && { borderColor: colors.pink }]}>
      <View style={styles.optionIcon}><Icon name={icon} size={22} color={colors.white} /></View>
      <View style={{ flex: 1, gap: 4 }}>
        <T variant="bodyStrong">{title}</T>
        <T variant="caption" color={colors.mutedGrey}>{text}</T>
        <View style={{ flexDirection: 'row' }}><Badge label={badge} tone="muted" /></View>
      </View>
      {loading ? <T variant="small" color={colors.mutedGrey}>…</T> : <Icon name="chevronRight" size={18} strokeWidth={2} />}
    </Pressable>
  );
}

function PlaceCard({ place }: { place: NonNullable<Redemption['place']> }) {
  const directions = () => {
    const q = place.lat !== null && place.lng !== null ? `${place.lat},${place.lng}` : `${place.name}, ${place.address}`;
    const url = Platform.select({
      ios: `maps:0,0?q=${encodeURIComponent(place.name)}@${q}`,
      android: `geo:0,0?q=${encodeURIComponent(q)}(${encodeURIComponent(place.name)})`,
      default: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
    });
    Linking.openURL(url!);
  };
  return (
    <Card style={{ padding: 16, gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <Icon name="pin" size={22} color={colors.pink} />
        <View style={{ flex: 1 }}>
          <T variant="bodyStrong">{place.name}</T>
          <T variant="caption" color={colors.mutedGrey}>{!place.address ? place.area : place.address.includes(place.area) ? place.address : `${place.address}, ${place.area}`}</T>
        </View>
      </View>
      <Button label="Directions" icon="directions" variant="outline" size="md" onPress={directions} />
    </Card>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stepLine: { flex: 1, height: 2, marginLeft: 2 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.nearBlack },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center' },
  option: { flexDirection: 'row', gap: 14, alignItems: 'center', padding: 16, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.white },
  optionIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.nearBlack, alignItems: 'center', justifyContent: 'center' },
  codeCard: { padding: 24, gap: 10, alignItems: 'center', backgroundColor: colors.nearBlack },
  code: { fontFamily: fonts.display, fontSize: 56, lineHeight: 64, letterSpacing: 6, color: colors.white },
  tick: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
});
