import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, fonts, radius } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { T } from './Text';

type Variant = 'primary' | 'dark' | 'outline' | 'ghost' | 'danger' | 'light';
type Size = 'lg' | 'md' | 'sm';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  testID?: string;
};

const palette: Record<Variant, { bg: string; fg: string; border?: string; pressed: string }> = {
  primary: { bg: colors.pink, fg: colors.white, pressed: colors.pinkDeep },
  dark: { bg: colors.nearBlack, fg: colors.white, pressed: colors.darkSurface },
  outline: { bg: colors.white, fg: colors.nearBlack, border: colors.nearBlack, pressed: colors.softWhite },
  ghost: { bg: 'transparent', fg: colors.pinkDeep, pressed: colors.pinkTint },
  danger: { bg: colors.white, fg: colors.error, border: colors.error, pressed: colors.errorTint },
  light: { bg: colors.white, fg: colors.nearBlack, pressed: colors.hairline },
};

const heights: Record<Size, number> = { lg: 52, md: 44, sm: 36 };

export function Button({
  label, onPress, variant = 'primary', size = 'lg', icon, loading, disabled, style, accessibilityHint, testID,
}: Props) {
  const p = palette[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      hitSlop={size === 'sm' ? 6 : 0}
      style={({ pressed }) => [
        styles.base,
        {
          height: heights[size],
          paddingHorizontal: size === 'sm' ? 14 : 20,
          backgroundColor: disabled ? colors.hairline : pressed ? p.pressed : p.bg,
          borderColor: disabled ? colors.hairline : p.border ?? 'transparent',
          borderWidth: p.border ? 1.5 : 0,
        },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={p.fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={18} color={disabled ? colors.mutedGrey : p.fg} strokeWidth={2} /> : null}
          <T
            variant="bodyStrong"
            color={disabled ? colors.mutedGrey : p.fg}
            style={{ fontSize: size === 'sm' ? 13 : size === 'md' ? 14 : 16, fontFamily: fonts.semibold }}>
            {label}
          </T>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
