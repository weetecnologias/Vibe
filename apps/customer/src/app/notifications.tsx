import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { api, type AppNotification } from '@/api';
import { Card, EmptyState, ErrorState, LoadingState, Notice, Screen, T, TopBar } from '@/components/ui';
import { formatDay, formatTime } from '@/lib/dates';
import { useAsync } from '@/lib/useAsync';
import { colors } from '@/theme/tokens';

/** Where tapping a notification goes. A bill opens on the bill screen, where the offer and coupon can be chosen before paying. */
function open(n: AppNotification): void {
  if (!n.target) return;
  if (n.target.type === 'redemption') router.push(`/bill/${n.target.id}` as never);
}

/**
 * Notification inbox: bills a business sent, redemptions to rate, renewals. Push delivery (FCM / APNs) is not connected yet,
 * so the Home bell shows the unread count instead and the list refreshes while it is open.
 */
export default function Notifications() {
  const list = useAsync(() => api.getNotifications(), []);
  const reload = list.reload;
  useEffect(() => {
    const t = setInterval(reload, 10000);
    return () => clearInterval(t);
  }, [reload]);

  const items = list.data ?? [];
  const unread = items.filter((n) => !n.read).length;
  const tap = (n: AppNotification) => {
    if (!n.read) {
      api.markNotificationRead(n.id).catch(() => undefined);
      list.setData((prev) => prev?.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    }
    open(n);
  };
  const readAll = () => {
    api.markAllNotificationsRead().catch(() => undefined);
    list.setData((prev) => prev?.map((x) => ({ ...x, read: true })));
  };

  return (
    <Screen>
      <TopBar title="Notifications" right={unread > 0 ? <Pressable accessibilityRole="button" onPress={readAll}><T variant="captionStrong" color={colors.pinkDeep}>Mark all read</T></Pressable> : null} />
      <View style={{ paddingHorizontal: 16, gap: 10, marginTop: 8 }}>
        {list.error && !list.data ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <LoadingState rows={3} /> : items.length === 0 ? (
          <EmptyState icon="bell" title="You’re all caught up" message="Bills from merchants, visits to rate and membership renewals will show up here." />
        ) : items.map((n) => (
          <Pressable key={n.id} accessibilityRole="button" accessibilityLabel={`${n.title}. ${n.body}`} onPress={() => tap(n)}>
            <Card style={[styles.row, !n.read && styles.unread]}>
              <View style={[styles.dot, n.read && { opacity: 0 }]} />
              <View style={{ flex: 1, gap: 3 }}>
                <T variant="captionStrong">{n.title}</T>
                <T variant="small" color={colors.mutedGrey}>{n.body}</T>
                <T variant="small" color={colors.mutedGrey}>{formatDay(n.createdAt)}, {formatTime(n.createdAt)}</T>
              </View>
            </Card>
          </Pressable>
        ))}
        <Notice tone="info">
          <T variant="small" color={colors.mutedGrey}>Phone push alerts need Firebase Cloud Messaging and Apple Push Notification service to be configured. Until then, new bills appear here and as a card on Home.</T>
        </Notice>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14 },
  unread: { borderColor: colors.pink, borderWidth: 1.5 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.pink, marginTop: 5 },
});
