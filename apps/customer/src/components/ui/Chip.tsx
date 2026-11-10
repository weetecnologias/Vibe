import { Pressable, StyleSheet, View } from 'react-native';

import { colors, fonts, radius } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { T } from './Text';

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  tone?: 'dark' | 'pink';
  icon?: IconName;
  onDark?: boolean;
};

/** Filter / selection chip. Selected = near-black (or pink for primary category level). */
export function Chip({ label, selected, onPress, tone = 'dark', icon, onDark }: ChipProps) {
  const selBg = tone === 'pink' ? colors.pink : onDark ? colors.pink : colors.nearBlack;
  const bg = selected ? selBg : onDark ? colors.darkSurface : colors.white;
  const fg = selected || onDark ? colors.white : colors.nearBlack;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }} aria-selected={!!selected}
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={[
        styles.chip,
        { backgroundColor: bg, borderColor: selected ? selBg : onDark ? colors.darkSurface : colors.hairline },
      ]}>
      {icon ? <Icon name={icon} size={15} color={fg} strokeWidth={2} /> : null}
      <T variant="captionStrong" color={fg}>{label}</T>
    </Pressable>
  );
}

type BadgeTone = 'pink' | 'pinkSoft' | 'success' | 'warning' | 'muted' | 'dark' | 'white' | 'error';

const badgeTones: Record<BadgeTone, { bg: string; fg: string }> = {
  pink: { bg: colors.pink, fg: colors.white },
  pinkSoft: { bg: colors.pinkTint, fg: colors.pinkDeep },
  success: { bg: colors.successTint, fg: colors.success },
  warning: { bg: colors.warningTint, fg: colors.warning },
  error: { bg: colors.errorTint, fg: colors.error },
  muted: { bg: colors.hairline, fg: colors.mutedGrey },
  dark: { bg: colors.nearBlack, fg: colors.white },
  white: { bg: colors.white, fg: colors.nearBlack },
};

export function Badge({ label, tone = 'pinkSoft', icon, uppercase }: { label: string; tone?: BadgeTone; icon?: IconName; uppercase?: boolean }) {
  const t = badgeTones[tone];
  return (
    <View style={[styles.badge, { backgroundColor: t.bg }]}>
      {icon ? <Icon name={icon} size={12} color={tone === 'dark' ? colors.pink : t.fg} strokeWidth={2.4} /> : null}
      <T
        variant="small"
        color={t.fg}
        style={{ fontFamily: fonts.bold, fontSize: 11, letterSpacing: uppercase ? 0.5 : 0, textTransform: uppercase ? 'uppercase' : 'none' }}>
        {label}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 38, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1,
    flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  badge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.pill,
  },
});
