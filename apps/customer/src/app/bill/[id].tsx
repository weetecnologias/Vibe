import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { api } from '@/api';
import { OffersPanel } from '@/components/OffersPanel';
import { BillBreakdown, PayPanel } from '@/components/PayPanel';
import { Badge, Button, EmptyState, ErrorState, LoadingState, Notice, Screen, T, TopBar } from '@/components/ui';
import { formatCountdown } from '@/lib/dates';
import { useAsync, useCountdown } from '@/lib/useAsync';
import { colors } from '@/theme/tokens';

/**
 * A bill from a business, however it started: the customer asked for it, or the business raised it from their VIBE ID. It shows the items, the
 * discount and the VIBE fee, and the customer pays it here. If the business withdraws it to correct it, this says so.
 */
export default function BillScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const red = useAsync(() => api.getRedemption(id), [id]);
  const [tick, setTick] = useState(0);
  const r = red.data;
  const left = useCountdown(r?.paymentRequest?.expiresAt);

  // The business may withdraw and resend it, so keep it fresh until it's paid.
  const reload = red.reload;
  useEffect(() => {
    if (!r || r.status === 'paid' || r.status === 'cancelled' || r.status === 'expired') return;
    const t = setInterval(() => { reload(); setTick((n) => n + 1); }, 6000);
    return () => clearInterval(t);
  }, [r, reload]);
  void tick;

  const cancel = async () => {
    if (r) await api.cancelRedemption(r.id).catch(() => undefined);
    router.back();
  };

  return (
    <Screen>
      <TopBar title="Your bill" subtitle={r?.businessName} right={r?.status === 'bill_ready' && left !== null && left > 0 ? <Badge label={`Pay within ${formatCountdown(left)}`} tone="warning" /> : null} />
      {red.error && !r ? <ErrorState message={red.error} onRetry={red.reload} /> : !r ? <LoadingState rows={2} /> : (
        <View style={{ paddingHorizontal: 16, gap: 16, marginTop: 8 }}>
          {r.status === 'paid' ? (
            <Notice tone="success"><T variant="caption">This bill has been paid. Thank you!</T></Notice>
          ) : r.status === 'expired' || r.status === 'cancelled' ? (
            <EmptyState icon="clock" title="This bill is no longer open" message="Nothing was charged. Ask the business to send it again if you still want to pay." actionLabel="Back" onAction={() => router.back()} />
          ) : r.status === 'awaiting_bill' ? (
            <Notice tone="info"><T variant="caption">{r.businessName} is preparing your bill. It will appear here as soon as they send it.</T></Notice>
          ) : r.paymentRequest ? (
            <>
              <OffersPanel requestId={r.paymentRequest.id} discount={r.paymentRequest.discount} onRepriced={(next) => red.setData((prev) => (prev ? { ...prev, paymentRequest: next } : prev))} />
              <BillBreakdown req={r.paymentRequest} title={`Bill from ${r.businessName}`} />
              <PayPanel req={r.paymentRequest} />
              <Button label="Something looks wrong? Cancel this bill" variant="ghost" size="md" onPress={cancel} />
              <T variant="small" color={colors.mutedGrey} align="center">{r.businessName} issues your tax invoice separately.</T>
            </>
          ) : null}
        </View>
      )}
    </Screen>
  );
}
