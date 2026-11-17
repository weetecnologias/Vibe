import { useEffect, useState } from 'react';

import { useAuth, type BillBoard, type BillRow } from '@kit';

const POLL_MS = 5000;

/** A customer who needs the staff now: waiting for their bill, or showing a code to confirm. */
export const isWaiting = (b: BillRow) => b.status === 'awaiting_bill' || b.status === 'code_issued';

/**
 * How many customers are waiting at Bills and codes right now, checked every few seconds while the tab is open, so the menu, the top bar and the
 * dashboard show it even if nobody opened the alert. Null when this person doesn't handle bills.
 */
export function useWaitingBills(enabled: boolean): number | null {
  const { client } = useAuth();
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const load = () => client.get<BillBoard>('/v1/merchant/bills?view=open').then(
      (b) => { if (live) setCount(b.rows.filter(isWaiting).length); },
      () => { /* offline for a moment: try again next time */ },
    );
    void load();
    const t = setInterval(() => { if (!document.hidden) void load(); }, POLL_MS);
    const onVisible = () => { if (!document.hidden) void load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { live = false; clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [client, enabled]);
  return enabled ? count : null;
}
