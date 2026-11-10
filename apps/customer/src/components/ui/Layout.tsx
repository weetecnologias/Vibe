import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, space } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { T } from './Text';

type ScreenProps = ScrollViewProps & {
  dark?: boolean;
  /** Content pinned under the scroll area (e.g. a pay bar). */
  footer?: React.ReactNode;
  /** Skip the top safe-area padding (when a full-bleed header handles it). */
  edgeToEdge?: boolean;
};

/** Scrollable screen with safe areas and the brand background. */
export function Screen({ dark, footer, edgeToEdge, contentContainerStyle, children, ...rest }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: dark ? colors.nearBlack : colors.softWhite }}>
      <ScrollView
        {...rest}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[{ paddingTop: edgeToEdge ? 0 : insets.top + 8, paddingBottom: 32 }, contentContainerStyle]}>
        {children}
      </ScrollView>
      {footer ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }, dark && styles.footerDark]}>{footer}</View>
      ) : null}
    </View>
  );
}

export function IconButton({
  icon, label, onPress, tone = 'light', size = 44, color,
}: { icon: IconName; label: string; onPress?: () => void; tone?: 'light' | 'dark' | 'clear' | 'pink'; size?: number; color?: string }) {
  const bg = tone === 'light' ? colors.white : tone === 'dark' ? colors.darkSurface : tone === 'pink' ? colors.pink : 'transparent';
  const fg = color ?? (tone === 'dark' || tone === 'pink' ? colors.white : colors.nearBlack);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.75 : 1 },
      ]}>
      <Icon name={icon} size={size > 40 ? 22 : 18} color={fg} strokeWidth={2} />
    </Pressable>
  );
}

export function BackButton({ tone = 'clear', fallback = '/' }: { tone?: 'light' | 'dark' | 'clear'; fallback?: string }) {
  return (
    <IconButton
      icon="back"
      label="Back"
      tone={tone}
      color={tone === 'dark' ? colors.white : colors.nearBlack}
      onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback as never))}
    />
  );
}

/** Simple top bar for pushed screens. */
export function TopBar({ title, subtitle, right, dark }: { title?: string; subtitle?: string; right?: React.ReactNode; dark?: boolean }) {
  return (
    <View style={styles.topBar}>
      <BackButton tone={dark ? 'dark' : 'clear'} />
      <View style={{ flex: 1 }}>
        {title ? <T variant="headline" color={dark ? colors.white : colors.nearBlack} numberOfLines={1}>{title}</T> : null}
        {subtitle ? <T variant="small" color={dark ? colors.onDarkMuted : colors.mutedGrey} numberOfLines={1}>{subtitle}</T> : null}
      </View>
      {right}
    </View>
  );
}

export function SectionHeader({
  title, action, onAction, dark, style,
}: { title: string; action?: string; onAction?: () => void; dark?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.section, style]}>
      <T variant="title2" color={dark ? colors.white : colors.nearBlack} accessibilityRole="header">{title}</T>
      {action ? (
        <Pressable accessibilityRole="link" onPress={onAction} hitSlop={10}>
          <T variant="captionStrong" color={dark ? colors.white : colors.pinkDeep}>{action}</T>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Card({ children, style, dark }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; dark?: boolean }) {
  return <View style={[dark ? styles.cardDark : styles.card, style]}>{children}</View>;
}

export function Divider({ dark }: { dark?: boolean }) {
  return <View style={{ height: 1, backgroundColor: dark ? 'rgba(255,255,255,0.14)' : colors.hairline }} />;
}

export function Row({ children, style, gap = 8 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  footer: {
    paddingHorizontal: space.md, paddingTop: 14, backgroundColor: colors.white,
    borderTopWidth: 1, borderTopColor: colors.hairline,
  },
  footerDark: { backgroundColor: colors.nearBlack, borderTopColor: colors.darkSurface },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingBottom: 8 },
  section: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: space.lg },
  card: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline },
  cardDark: { backgroundColor: colors.darkSurface, borderRadius: radius.lg },
});
