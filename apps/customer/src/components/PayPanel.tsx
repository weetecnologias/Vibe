import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { api, type PaymentMethod, type PaymentRequest } from '@/api';
import { formatINR } from '@/lib/money';
import { errorMessage, newIdempotencyKey } from '@/lib/useAsync';
import { colors, fonts } from '@/theme/tokens';

import { Button, Card, Divider, Icon, Notice, T, type IconName } from './ui';

const METHODS: { key: PaymentMethod; name: string; sub: string; icon: IconName }[] = [
  { key: 'upi', name: 'UPI', sub: 'Any UPI app on this phone', icon: 'wallet' },
  { key: 'card', name: 'Card', sub: 'Debit or credit · handled by payment partner', icon: 'membership' },
  { key: 'netbanking', name: 'Netbanking', sub: 'All major Indian banks', icon: 'bank' },
];

/** Server-priced bill breakdown. Every number comes from the backend. */
export function BillBreakdown({ req, title = 'Bill', showLines = true }: { req: PaymentRequest; title?: string; showLines?: boolean }) {
  return (
    <Card style={{ padding: 20, gap: 12 }}>
      <View style={styles.between}>
        <View style={{ flex: 1 }}>
          <T variant="label" color={colors.mutedGrey}>{title}</T>
          <T variant="bodyStrong">{req.billRef}</T>
        </View>
        <T variant="small" color={colors.mutedGrey} align="right">Raised by {req.raisedBy}</T>
      </View>
      {showLines && req.lines.length ? (
        <View style={styles.lines}>
          {req.lines.map((l, i) => (
            <View key={i} style={styles.between}><T variant="caption" color={colors.mutedGrey} style={{ flex: 1 }}>{l.label}</T><T variant="caption">{formatINR(l.amount, { decimals: 'always' })}</T></View>
          ))}
        </View>
      ) : null}
      {req.discount > 0 || req.discountLabel || req.vibeFee > 0 ? (
        <>
          <Row k={req.vibeFee > 0 ? 'Subtotal' : 'Eligible bill'} v={formatINR(req.eligibleAmount, { decimals: 'always' })} />
          {req.discount > 0 || req.discountLabel ? <Row k={req.discountLabel || 'Discount'} v={formatINR(-req.discount, { decimals: 'always' })} pink /> : null}
        </>
      ) : null}
      <Row k="Taxes & charges" v={req.taxes === null ? 'Included' : formatINR(req.taxes, { decimals: 'always' })} />
      <Row k="VIBE fee" v={formatINR(req.vibeFee, { decimals: 'always' })} />
      <Divider />
      <View style={styles.between}>
        <T variant="bodyStrong">You pay</T>
        <T variant="amount">{formatINR(req.payable, { decimals: 'always' })}</T>
      </View>
      {req.discount > 0 ? (
        <View style={styles.save}><T variant="small" color={colors.success} style={{ fontFamily: fonts.bold }}>You save {formatINR(req.discount, { decimals: 'always' })}</T></View>
      ) : null}
    </Card>
  );
}

function Row({ k, v, pink }: { k: string; v: string; pink?: boolean }) {
  return (
    <View style={styles.between}>
      <T variant="caption" color={colors.mutedGrey} style={{ flex: 1 }}>{k}</T>
      <T variant="captionStrong" color={pink ? colors.pinkDeep : colors.nearBlack}>{v}</T>
    </View>
  );
}

/** Payment method choice + pay button. Navigates to the server-verified status screen. */
export function PayPanel({ req }: { req: PaymentRequest }) {
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One key per bill+method so double taps and retries never create two payments.
  const keys = useRef(new Map<string, string>());

  const pay = async () => {
    setBusy(true);
    setError(null);
    const k = `${req.id}:${method}:${req.payable}`;
    if (!keys.current.has(k)) keys.current.set(k, newIdempotencyKey());
    try {
      const start = await api.startPayment(req.id, method, keys.current.get(k)!);
      if (start.checkout.mode === 'provider') {
        // TODO(payments): open the selected aggregator's checkout SDK with start.checkout.orderId.
        setError('Online payment isn’t connected yet. No money has been taken.');
        return;
      }
      router.replace(`/payment/${start.reference}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <T variant="headline">Pay with</T>
      <Card style={{ overflow: 'hidden' }}>
        {METHODS.map((m, i) => {
          const on = method === m.key;
          return (
            <Pressable
              key={m.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }} aria-checked={on}
              onPress={() => setMethod(m.key)}
              style={[styles.method, i < METHODS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.hairline }]}>
              <View style={styles.methodIcon}><Icon name={m.icon} size={20} /></View>
              <View style={{ flex: 1 }}><T variant="captionStrong">{m.name}</T><T variant="small" color={colors.mutedGrey}>{m.sub}</T></View>
              <View style={[styles.radio, { borderColor: on ? colors.pink : colors.mutedGrey, borderWidth: on ? 2 : 1.5 }]}>
                {on ? <View style={styles.radioDot} /> : null}
              </View>
            </Pressable>
          );
        })}
      </Card>
      <Notice tone="info" icon="shield">
        <T variant="small" color={colors.mutedGrey}>
          Your payment is confirmed only after our RBI-regulated payment partner verifies it. Don’t pay the merchant separately for this bill.
        </T>
      </Notice>
      {error ? <Notice tone="error"><T variant="caption">{error}</T></Notice> : null}
      <Button label={`Pay ${formatINR(req.payable, { decimals: 'always' })}`} icon="lock" onPress={pay} loading={busy} testID="pay" />
    </View>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  lines: { gap: 6, padding: 12, borderRadius: 14, backgroundColor: colors.softWhite },
  save: { alignSelf: 'flex-end', backgroundColor: colors.successTint, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  method: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  methodIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.softWhite, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.pink },
});
