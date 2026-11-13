import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { api, type AppliedOffer, type CheckoutRequest } from '@/api';
import { formatINR } from '@/lib/money';
import { errorMessage, useAsync } from '@/lib/useAsync';
import { colors, fonts, radius } from '@/theme/tokens';

import { Badge, Button, Card, Icon, Notice, T } from './ui';

/**
 * "Offers & coupons" at checkout: apply a VIBE member offer, a public offer or a
 * typed code. One offer per order. The server decides eligibility and reprices
 * the bill, so every figure shown comes from the backend.
 */
export function OffersPanel({ requestId, discount, onRepriced }: { requestId: string; discount: number; onRepriced: (next: CheckoutRequest) => void }) {
  const offers = useAsync(() => api.getCheckoutOffers(requestId), [requestId]);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<CheckoutRequest>) => {
    setBusy(key);
    setError(null);
    try {
      onRepriced(await fn());
      setCode('');
      offers.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const data = offers.data;
  const applied: AppliedOffer | null = data?.applied ?? null;
  if (data && data.available.length === 0 && !applied) return null;

  return (
    <View style={{ gap: 12 }}>
      <T variant="headline" accessibilityRole="header">Offers & coupons</T>

      {applied ? (
        <View style={styles.applied}>
          <View style={styles.tick}><Icon name="check" size={16} color={colors.white} strokeWidth={3} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="captionStrong">{applied.title}</T>
            <T variant="small" color={colors.success}>{applied.code ? `Code ${applied.code} applied` : 'Applied'} · you save {formatINR(discount, { decimals: 'always' })}</T>
          </View>
          <Button label="Remove" variant="ghost" size="sm" loading={busy === 'remove'} onPress={() => run('remove', () => api.removeOffer(requestId))} />
        </View>
      ) : null}

      {!applied && data?.available.map((o) => (
        <Card key={o.id} style={styles.row}>
          <View style={{ flex: 1, gap: 3 }}>
            <View style={styles.titleRow}>
              <T variant="captionStrong" style={{ flexShrink: 1 }}>{o.title}</T>
              {o.memberOnly ? <Badge label="MEMBER" tone="pink" /> : null}
            </View>
            <T variant="small" color={colors.mutedGrey}>{o.description}</T>
            <T variant="small" color={o.eligible ? colors.success : colors.mutedGrey} style={{ fontFamily: fonts.semibold }}>
              {o.eligible ? `You save ${formatINR(o.saving, { decimals: 'always' })}` : o.reason}
            </T>
            {o.code ? <T variant="small" color={colors.mutedGrey}>Code {o.code}</T> : null}
          </View>
          {o.eligible ? (
            <Button label="Apply" size="sm" loading={busy === o.id} onPress={() => run(o.id, () => api.applyOffer(requestId, o.id))} />
          ) : o.memberOnly && /member/i.test(o.reason ?? '') ? (
            <Button label="Join" size="sm" variant="outline" onPress={() => router.push('/membership')} />
          ) : null}
        </Card>
      ))}

      {!applied ? (
        <View style={styles.codeRow}>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.replace(/\s/g, '').toUpperCase().slice(0, 20))}
            placeholder="Have a code?"
            placeholderTextColor={colors.mutedGrey}
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="Offer code"
            returnKeyType="done"
            onSubmitEditing={() => code && run('code', () => api.applyOffer(requestId, code))}
            style={styles.input}
          />
          <Button label="Apply" size="md" variant="dark" disabled={!code} loading={busy === 'code'} onPress={() => run('code', () => api.applyOffer(requestId, code))} />
        </View>
      ) : null}

      {error ? <Notice tone="error"><T variant="caption">{error}</T></Notice> : null}
      {offers.error ? <T variant="small" color={colors.mutedGrey}>Offers couldn’t load. You can still pay.</T> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  applied: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.success, backgroundColor: colors.successTint },
  tick: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, height: 44, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.white, paddingHorizontal: 14, fontFamily: fonts.semibold, fontSize: 14, letterSpacing: 1, color: colors.nearBlack },
});
