import { Text as RNText, type TextProps } from 'react-native';

import { colors, type TypeVariant, type as typeScale } from '@/theme/tokens';

type Props = TextProps & {
  variant?: TypeVariant;
  color?: string;
  align?: 'left' | 'center' | 'right';
};

/** Typed text using the VIBE type scale. Defaults to Body / Near Black. */
export function T({ variant = 'body', color = colors.nearBlack, align, style, ...rest }: Props) {
  return <RNText {...rest} style={[typeScale[variant], { color, textAlign: align }, style]} />;
}
