import { StyleSheet, View } from 'react-native';

import { colors, radius, space } from '@/theme/tokens';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { T } from './Text';

/** Skeleton blocks shown while a list or detail loads. */
export function LoadingState({ rows = 3, dark }: { rows?: number; dark?: boolean }) {
  const block = dark ? colors.darkSurface : colors.hairline;
  return (
    <View style={styles.wrap} accessibilityLabel="Loading" accessibilityRole="progressbar">
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={{ gap: 8 }}>
          <View style={{ height: 96, borderRadius: radius.md, backgroundColor: block }} />
          <View style={{ height: 14, width: '70%', borderRadius: 6, backgroundColor: block }} />
          <View style={{ height: 12, width: '45%', borderRadius: 6, backgroundColor: block }} />
        </View>
      ))}
    </View>
  );
}

export function EmptyState({
  icon = 'offer', title, message, actionLabel, onAction, dark,
}: { icon?: IconName; title: string; message?: string; actionLabel?: string; onAction?: () => void; dark?: boolean }) {
  return (
    <View style={[styles.center, { paddingVertical: space.xxl }]}>
      <View style={[styles.circle, { backgroundColor: dark ? colors.darkSurface : colors.pinkTint }]}>
        <Icon name={icon} size={24} color={dark ? colors.pink : colors.pinkDeep} />
      </View>
      <T variant="headline" align="center" color={dark ? colors.white : colors.nearBlack}>{title}</T>
      {message ? <T variant="caption" align="center" color={dark ? colors.onDarkMuted : colors.mutedGrey}>{message}</T> : null}
      {actionLabel ? <Button label={actionLabel} variant="ghost" size="md" onPress={onAction} /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Icon name="info" color={colors.error} size={22} strokeWidth={2} />
      <View style={{ flex: 1, gap: 4 }}>
        <T variant="captionStrong">Something went wrong</T>
        <T variant="caption">{message ?? 'Please check your connection and try again.'}</T>
        {onRetry ? <Button label="Try again" size="sm" variant="outline" onPress={onRetry} style={{ alignSelf: 'flex-start', marginTop: 6 }} /> : null}
      </View>
    </View>
  );
}

export function Notice({ tone, icon, children }: { tone: 'success' | 'warning' | 'error' | 'info'; icon?: IconName; children: React.ReactNode }) {
  const map = {
    success: { bg: colors.successTint, fg: colors.success, icon: 'shield' as IconName },
    warning: { bg: colors.warningTint, fg: colors.warning, icon: 'clock' as IconName },
    error: { bg: colors.errorTint, fg: colors.error, icon: 'info' as IconName },
    info: { bg: colors.white, fg: colors.nearBlack, icon: 'info' as IconName },
  }[tone];
  return (
    <View style={[styles.notice, { backgroundColor: map.bg }, tone === 'info' && { borderWidth: 1, borderColor: colors.hairline }]}>
      <Icon name={icon ?? map.icon} color={map.fg} size={20} strokeWidth={2} />
      <View style={{ flex: 1 }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 20, padding: space.lg },
  center: { alignItems: 'center', gap: 8, paddingHorizontal: space.xl },
  circle: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  error: {
    flexDirection: 'row', gap: 12, padding: space.md, margin: space.lg,
    backgroundColor: colors.errorTint, borderRadius: radius.lg,
  },
  notice: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 16 },
});
