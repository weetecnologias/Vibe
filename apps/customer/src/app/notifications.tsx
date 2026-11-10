import { EmptyState, Notice, Screen, T, TopBar } from '@/components/ui';
import { View } from 'react-native';

import { colors } from '@/theme/tokens';

/** Notification inbox. Push delivery (FCM / APNs) is not connected yet. */
export default function Notifications() {
  return (
    <Screen>
      <TopBar title="Notifications" />
      <View style={{ paddingHorizontal: 20, gap: 16 }}>
        <EmptyState icon="bell" title="You’re all caught up" message="Bills from merchants, ticket reminders and membership renewals will show up here." />
        <Notice tone="info">
          <T variant="small" color={colors.mutedGrey}>Push notifications need Firebase Cloud Messaging and Apple Push Notification service to be configured. Until then, open the app to see new bills.</T>
        </Notice>
      </View>
    </Screen>
  );
}
