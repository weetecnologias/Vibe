import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, View } from 'react-native';

import { api, type Payment } from '@/api';
import { Button, Card, Divider, ErrorState, Icon, IconButton, Screen, T } from '@/components/ui';
import { formatDate, formatTime } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { errorMessage } from '@/lib/useAsync';
import { colors, fonts } from '@/theme/tokens';

const POLL_MS = 1500;
const GIVE_UP_MS = 90_000;

const METHOD = { upi: 'UPI', card: 'Card', netbanking: 'Netbanking' } as const;

/**
 * Shows only what the backend says. Success appears when the server has verified
 * the payment with the provider — never because the checkout or redirect said so.
 */
export default function PaymentStatus() {
  const { reference } = useLocalSearchParams<{ reference: string }>();
  const [p, setP] = useState<Payment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [rating, setRating] = useState(0);

  useEffect(() => {
    let stop = false;
    const startedAt = Date.now();
    const tick = async () => {
      try {
        const next = await api.getPayment(reference);
        if (stop) return;
        setP(next);
        if (next.status === 'pending' || next.status === 'created') {
          if (Date.now() - startedAt > GIVE_UP_MS) setSlow(true);
          else setTimeout(tick, POLL_MS);
        }
      } catch (e) {
        if (!stop) setError(errorMessage(e));
      }
    };
    tick();
    return () => { stop = true; };
  }, [reference]);

  const verified = p?.status === 'verified';
  const failed = p?.status === 'failed';
  const pending = !p || p.status === 'pending' || p.status === 'created';

  const done = () => {
    if ((p?.kind === 'tickets' || p?.kind === 'movie') && p.ticketIds.length) router.replace(`/ticket/${p.ticketIds[0]}`);
    else if (p?.kind === 'membership') router.replace('/membership');
    else router.replace('/home');
  };

  return (
    <Screen contentContainerStyle={{ paddingHorizontal: 16 }}>
      <View style={{ alignItems: 'flex-end' }}>
        <IconButton icon="close" label="Close" tone="clear" onPress={() => router.replace('/home')} />
      </View>

      {error ? <ErrorState message={error} /> : null}

      <View style={styles.hero} accessibilityLiveRegion="polite">
        {verified ? (
          <>
            <View style={[styles.ring, { backgroundColor: colors.successTint }]}><View style={styles.okDot}><Icon name="check" size={32} color={colors.white} strokeWidth={2.6} /></View></View>
            <T variant="title1" align="center" accessibilityRole="header">Payment successful</T>
            <T variant="body" color={colors.mutedGrey} align="center"><T variant="bodyStrong">{formatINR(p!.amount, { decimals: 'always' })}</T> paid to {p!.payeeName}</T>
            <View style={styles.verifiedRow}>
              <Icon name="shield" size={14} color={colors.success} strokeWidth={2.2} />
              <T variant="small" color={colors.success} style={{ fontFamily: fonts.semibold }}>
                Verified by payment partner · {formatDate(p!.verifiedAt!)}, {formatTime(p!.verifiedAt!)}
              </T>
            </View>
            {p!.savings > 0 ? (
              <View style={styles.savedPill}><T variant="captionStrong" color={colors.white}>You saved {formatINR(p!.savings)} with {p!.offerTitle ?? 'VIBE Membership'}</T></View>
            ) : null}
          </>
        ) : failed ? (
          <>
            <View style={[styles.ring, { backgroundColor: colors.errorTint }]}><Icon name="close" size={36} color={colors.error} strokeWidth={2.4} /></View>
            <T variant="title1" align="center">Payment not completed</T>
            <T variant="body" color={colors.mutedGrey} align="center">{p!.failureReason ?? 'You have not been charged. Try again or use another method.'}</T>
          </>
        ) : (
          <>
            <View style={[styles.ring, { backgroundColor: colors.warningTint }]}><Icon name="clock" size={36} color={colors.warning} strokeWidth={2} /></View>
            <T variant="title1" align="center">Confirming your payment</T>
            <T variant="body" color={colors.mutedGrey} align="center">
              {slow
                ? 'This is taking longer than usual. If money left your account, it will be confirmed or refunded automatically. Please don’t pay again.'
                : `We’re waiting for our payment partner to confirm${p ? ` ${formatINR(p.amount, { decimals: 'always' })}` : ''}. This usually takes a few seconds. Please don’t pay again.`}
            </T>
          </>
        )}
      </View>

      {p ? (
        <Card style={{ padding: 18, gap: 10, marginTop: 24 }}>
          <View style={styles.between}>
            <T variant="headline">VIBE receipt</T>
            <View style={[styles.status, { backgroundColor: verified ? colors.successTint : failed ? colors.errorTint : colors.warningTint }]}>
              <T variant="small" color={verified ? colors.success : failed ? colors.error : colors.warning} style={{ fontFamily: fonts.bold }}>
                {verified ? 'Verified' : failed ? 'Failed' : 'Pending'}
              </T>
            </View>
          </View>
          <KV k="VIBE reference" v={p.reference} strong />
          <KV k="Partner payment ID" v={p.providerPaymentId ?? 'Awaiting'} />
          <KV k="Paid with" v={METHOD[p.method]} />
          <KV k="Paid to" v={p.payeeName} />
          {p.lines.map((l, i) => <KV key={i} k={l.label} v={formatINR(l.amount, { decimals: 'always' })} />)}
          {p.savings > 0 ? <KV k={p.offerTitle ?? 'Member offer'} v={formatINR(-p.savings, { decimals: 'always' })} pink /> : null}
          <Divider />
          <View style={styles.between}><T variant="bodyStrong">Total</T><T variant="title2">{formatINR(p.amount, { decimals: 'always' })}</T></View>
        </Card>
      ) : null}

      {verified && p?.kind === 'redemption' ? (
        <>
          <T variant="small" color={colors.mutedGrey} style={{ marginTop: 12, marginHorizontal: 4 }}>
            This is a VIBE payment receipt. {p.payeeName} issues your tax invoice separately.
          </T>
          <Card style={{ padding: 16, gap: 8, alignItems: 'center', marginTop: 16 }}>
            <T variant="headline">How was {p.payeeName}?</T>
            <View style={{ flexDirection: 'row' }} accessibilityRole="radiogroup">
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable key={n} accessibilityRole="radio" accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`} accessibilityState={{ checked: rating === n }} aria-checked={rating === n} onPress={() => setRating(n)} style={styles.star}>
                  <Icon name="star" size={30} color={n <= rating ? colors.pink : colors.mutedGrey} filled={n <= rating} strokeWidth={1.6} />
                </Pressable>
              ))}
            </View>
            {rating ? <T variant="small" color={colors.mutedGrey}>Thanks! You can add a written review from your receipts.</T> : null}
          </Card>
        </>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 24 }}>
        {verified ? <Button label="Share receipt" variant="outline" style={{ flex: 1 }} onPress={() => Share.share({ message: `VIBE receipt ${p!.reference}: ${formatINR(p!.amount, { decimals: 'always' })} to ${p!.payeeName}` })} /> : null}
        <Button
          label={verified ? (p?.kind === 'tickets' || p?.kind === 'movie' ? 'View tickets' : p?.kind === 'membership' ? 'Go to membership' : 'Done') : failed ? 'Back' : 'Keep waiting'}
          disabled={pending && !slow}
          style={{ flex: 1 }}
          onPress={failed ? () => router.back() : done}
        />
      </View>
    </Screen>
  );
}

function KV({ k, v, strong, pink }: { k: string; v: string; strong?: boolean; pink?: boolean }) {
  return (
    <View style={styles.between}>
      <T variant="caption" color={colors.mutedGrey}>{k}</T>
      <T variant={strong ? 'captionStrong' : 'caption'} color={pink ? colors.pinkDeep : colors.nearBlack} style={{ flexShrink: 1, textAlign: 'right' }}>{v}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 10, paddingHorizontal: 8 },
  ring: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  okDot: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  savedPill: { marginTop: 6, backgroundColor: colors.pink, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  status: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  star: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
