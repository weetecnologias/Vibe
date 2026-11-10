import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { api, type Redemption } from '@/api';
import { BillBreakdown, PayPanel } from '@/components/PayPanel';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, Notice, Screen, T, TopBar } from '@/components/ui';
import { formatCountdown } from '@/lib/dates';
import { errorMessage, useCountdown } from '@/lib/useAsync';
import { colors } from '@/theme/tokens';

const POLL_MS = 3000;

export default function Redeem() {
  const { offerId } = useLocalSearchParams<{ offerId: string }>();
  const [red, setRed] = useState<Redemption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  const started = useRef(false);

  // Create exactly one redemption request for this visit.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api.createRedemption(offerId).then(setRed).catch((e) => setError(errorMessage(e)));
  }, [offerId]);

  // Wait for the merchant's bill (push notification in production; polling as a fallback).
  useEffect(() => {
    if (!red || red.status !== 'awaiting_bill') return;
    const t = setInterval(() => {
      api.getRedemption(red.id).then(setRed).catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(t);
  }, [red]);

  const expiresAt = red?.paymentRequest?.expiresAt ?? red?.expiresAt;
  const left = useCountdown(expiresAt) ?? 0;

  const cancel = async () => {
    if (red) await api.cancelRedemption(red.id).catch(() => undefined);
    router.back();
  };

  const simulateBill = async () => {
    if (!red || !api.demo) return;
    setDemoBusy(true);
    try { setRed(await api.demo.simulateMerchantBill(red.id, 100000)); } catch (e) { setError(errorMessage(e)); } finally { setDemoBusy(false); }
  };

  if (error) {
    return (
      <Screen>
        <TopBar title="Redeem offer" />
        <ErrorState message={error} />
        <View style={{ paddingHorizontal: 20 }}><Button label="Back to offer" variant="outline" onPress={() => router.back()} /></View>
      </Screen>
    );
  }
  if (!red) return <Screen><TopBar title="Redeem offer" /><LoadingState rows={2} /></Screen>;

  const step = red.status === 'awaiting_bill' ? 1 : 2;
  const expired = red.status === 'expired' || (expiresAt && left === 0 && red.status !== 'paid');

  return (
    <Screen>
      <TopBar
        title="Redeem offer"
        subtitle={`${red.businessName} · ${red.branchName}`}
        right={!expired && expiresAt ? <Badge label={`Expires ${formatCountdown(left)}`} tone="warning" /> : null}
      />

      <View style={styles.steps} accessibilityLabel={`Step ${step + 1} of 3`}>
        {['Requested', 'Bill received', 'Pay'].map((s, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <View key={s} style={[styles.step, i < 2 && { flex: 1 }]}>
              <View style={[styles.stepDot, { backgroundColor: done ? colors.success : current ? colors.pink : colors.hairline }]}>
                <T variant="small" color={done || current ? colors.white : colors.mutedGrey}>{done ? '✓' : i + 1}</T>
              </View>
              <T variant="small" color={current || done ? colors.nearBlack : colors.mutedGrey}>{s}</T>
              {i < 2 ? <View style={[styles.stepLine, { backgroundColor: done ? colors.success : colors.hairline }]} /> : null}
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
                <Button label="Demo: merchant sends ₹1,000 bill" variant="outline" size="md" loading={demoBusy} onPress={simulateBill} />
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

        {red.status === 'awaiting_bill' || red.status === 'bill_ready' ? (
          <Button label={red.status === 'bill_ready' ? 'Bill looks wrong? Cancel and ask staff' : 'Cancel request'} variant="ghost" size="md" onPress={cancel} />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  steps: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, gap: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  stepLine: { flex: 1, height: 2, marginLeft: 2 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, backgroundColor: colors.nearBlack },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center' },
});
