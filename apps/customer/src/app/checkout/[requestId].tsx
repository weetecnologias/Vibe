import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { api } from '@/api';
import { OffersPanel } from '@/components/OffersPanel';
import { BillBreakdown, PayPanel } from '@/components/PayPanel';
import { Badge, EmptyState, ErrorState, LoadingState, Screen, TopBar } from '@/components/ui';
import { formatCountdown } from '@/lib/dates';
import { useAsync, useCountdown } from '@/lib/useAsync';

/**
 * Generic checkout for server-created payment requests: ticket orders, court and class bookings, gym and studio memberships, VIBE Membership.
 * Where offers apply, they come first (VIBE member offers, then a coupon code), then the bill with the VIBE fee and taxes, then pay.
 */
export default function Checkout() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const req = useAsync(() => api.getPaymentRequest(requestId), [requestId]);
  const left = useCountdown(req.data?.expiresAt);

  const r = req.data;
  const title = r?.kind === 'tickets' ? 'Pay for tickets' : r?.kind === 'movie' ? 'Pay for your seats' : r?.kind === 'membership' ? 'Join VIBE Membership'
    : r?.kind === 'slots' ? 'Pay for your booking' : r?.kind === 'pass' ? 'Pay for your membership' : 'Checkout';
  const takesOffers = r?.kind === 'tickets' || r?.kind === 'movie' || r?.kind === 'slots' || r?.kind === 'pass';

  return (
    <Screen>
      <TopBar title={title} subtitle={r?.payeeName} right={left !== null && left > 0 ? <Badge label={`Held ${formatCountdown(left)}`} tone="warning" /> : null} />
      {req.error ? <ErrorState message={req.error} onRetry={req.reload} /> : null}
      {!r && !req.error ? <LoadingState rows={2} /> : null}
      {r && left === 0 ? (
        <EmptyState icon="clock" title="Your hold expired" message={r.kind === 'tickets' || r.kind === 'movie' ? 'Tickets were released back to sale. Nothing was charged. Pick your tickets again.' : r.kind === 'slots' ? 'Your slots were released. Nothing was charged. Choose your slots again.' : 'Nothing was charged. Please start again.'} />
      ) : null}
      {r && left !== 0 ? (
        <View style={{ paddingHorizontal: 16, gap: 16, marginTop: 8 }}>
          {takesOffers ? <OffersPanel requestId={r.id} discount={r.discount} onRepriced={(next) => req.setData(() => next)} /> : null}
          <BillBreakdown req={r} title={r.kind === 'membership' || r.kind === 'pass' ? 'Membership' : r.kind === 'slots' ? 'Your booking' : 'Your order'} />
          <PayPanel req={r} />
        </View>
      ) : null}
    </Screen>
  );
}
