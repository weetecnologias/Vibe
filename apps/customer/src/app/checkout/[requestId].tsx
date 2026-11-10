import { useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { api } from '@/api';
import { BillBreakdown, PayPanel } from '@/components/PayPanel';
import { Badge, EmptyState, ErrorState, LoadingState, Screen, TopBar } from '@/components/ui';
import { formatCountdown } from '@/lib/dates';
import { useAsync, useCountdown } from '@/lib/useAsync';

/** Generic checkout for server-created payment requests (ticket orders, membership). */
export default function Checkout() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const req = useAsync(() => api.getPaymentRequest(requestId), [requestId]);
  const left = useCountdown(req.data?.expiresAt);

  const r = req.data;
  const title = r?.kind === 'tickets' ? 'Pay for tickets' : r?.kind === 'membership' ? 'Join VIBE Membership' : 'Checkout';

  return (
    <Screen>
      <TopBar title={title} subtitle={r?.payeeName} right={left !== null && left > 0 ? <Badge label={`Held ${formatCountdown(left)}`} tone="warning" /> : null} />
      {req.error ? <ErrorState message={req.error} onRetry={req.reload} /> : null}
      {!r && !req.error ? <LoadingState rows={2} /> : null}
      {r && left === 0 ? (
        <EmptyState icon="clock" title="Your hold expired" message={r.kind === 'tickets' ? 'Tickets were released back to sale. Nothing was charged. Pick your tickets again.' : 'Nothing was charged. Please start again.'} />
      ) : null}
      {r && left !== 0 ? (
        <View style={{ paddingHorizontal: 16, gap: 16, marginTop: 8 }}>
          <BillBreakdown req={r} title={r.kind === 'tickets' ? 'Your order' : 'Membership'} />
          <PayPanel req={r} />
        </View>
      ) : null}
    </Screen>
  );
}
