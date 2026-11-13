import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { TextInput, View } from 'react-native';

import { api, type DisputeReason } from '@/api';
import { Badge, Button, Card, Chip, ErrorState, LoadingState, Notice, Screen, T, TopBar } from '@/components/ui';
import { formatDay } from '@/lib/dates';
import { errorMessage, useAsync } from '@/lib/useAsync';
import { colors, fonts, radius } from '@/theme/tokens';

const REASONS: { key: DisputeReason; label: string }[] = [
  { key: 'not_received', label: 'I didn’t get what I paid for' }, { key: 'wrong_amount', label: 'The amount is wrong' }, { key: 'charged_twice', label: 'I was charged twice' },
  { key: 'poor_service', label: 'The service wasn’t right' }, { key: 'other', label: 'Something else' },
];

/** Report a problem with a payment. VIBE looks into it within 5 days and either refunds or tells you why not; you're notified either way. */
export default function Dispute() {
  const { reference } = useLocalSearchParams<{ reference: string }>();
  const payment = useAsync(() => api.getPayment(reference), [reference]);
  const mine = useAsync(() => api.getMyDisputes(), []);
  const [reason, setReason] = useState<DisputeReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const existing = mine.data?.find((d) => d.paymentReference === reference);
  const p = payment.data;

  const send = async () => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.raiseDispute(reference, reason, details.trim());
      mine.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={!existing && p?.status === 'verified' ? <Button label="Send to VIBE" disabled={!reason} loading={busy} onPress={send} /> : undefined}>
      <TopBar title="Report a problem" subtitle={p ? `${p.payeeName} · ${reference}` : reference} />
      {payment.error ? <ErrorState message={payment.error} onRetry={payment.reload} /> : !p || mine.loading ? <LoadingState rows={2} /> : existing ? (
        <View style={{ paddingHorizontal: 16, gap: 14, marginTop: 8 }}>
          <Card style={{ padding: 18, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <T variant="headline" style={{ flex: 1 }}>{existing.reference}</T>
              <Badge label={existing.status === 'open' ? 'With VIBE' : existing.status === 'refund' ? 'Refund on its way' : 'Not refunded'} tone={existing.status === 'refund' ? 'success' : 'pinkSoft'} />
            </View>
            <T variant="caption" color={colors.mutedGrey}>Reported {formatDay(existing.createdAt)}.{existing.status === 'open' ? ` VIBE will respond by ${formatDay(existing.dueBy)}.` : ''}</T>
            {existing.resolutionNote ? <Notice tone="info"><T variant="caption">{existing.resolutionNote}</T></Notice> : null}
          </Card>
          <Button label="Back to receipt" variant="outline" onPress={() => router.back()} />
        </View>
      ) : p.status !== 'verified' ? (
        <Notice tone="info"><T variant="caption">Only a payment that went through can be reported. This one wasn’t charged.</T></Notice>
      ) : (
        <View style={{ paddingHorizontal: 16, gap: 14, marginTop: 8 }}>
          <T variant="caption" color={colors.mutedGrey}>Tell us what went wrong with your payment of {`₹${(p.amount / 100).toFixed(2)}`} to {p.payeeName}. VIBE looks into it and gets back to you within 5 days.</T>
          <View style={{ gap: 8 }}>
            <T variant="label" color={colors.mutedGrey}>What happened?</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {REASONS.map((r) => <Chip key={r.key} label={r.label} selected={reason === r.key} onPress={() => setReason(r.key)} />)}
            </View>
          </View>
          <View style={{ gap: 8 }}>
            <T variant="label" color={colors.mutedGrey}>More detail (optional)</T>
            <TextInput value={details} onChangeText={setDetails} multiline maxLength={1000} placeholder="What should we know?" placeholderTextColor={colors.mutedGrey} accessibilityLabel="More detail"
              style={{ minHeight: 100, borderWidth: 1.5, borderColor: colors.hairline, borderRadius: radius.md, padding: 12, fontFamily: fonts.medium, fontSize: 15, color: colors.nearBlack, backgroundColor: colors.white, textAlignVertical: 'top' }} />
          </View>
          {error ? <Notice tone="error"><T variant="caption">{error}</T></Notice> : null}
        </View>
      )}
    </Screen>
  );
}
