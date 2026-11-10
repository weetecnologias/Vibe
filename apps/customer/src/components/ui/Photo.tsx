import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { colors } from '@/theme/tokens';

const glows = [
  { cx: '78%', cy: '22%' }, { cx: '22%', cy: '30%' }, { cx: '70%', cy: '80%' },
  { cx: '30%', cy: '75%' }, { cx: '50%', cy: '18%' }, { cx: '85%', cy: '60%' },
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

type Props = {
  uri?: string | null;
  seed?: string;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  /** Darkens the photo so white text placed on it stays readable. */
  scrim?: boolean | number;
  children?: React.ReactNode;
  accessibilityLabel?: string;
};

/**
 * Business / event photography. While a photo is missing or fails to load,
 * renders the brand placeholder: near-black with a soft pink glow.
 */
export function Photo({ uri, seed = 'vibe', style, radius = 0, scrim, children, accessibilityLabel }: Props) {
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const g = glows[hash(seed) % glows.length];
  const id = `g${hash(seed) % 9973}`;
  const show = !!uri && failedUri !== uri;
  return (
    <View
      style={[styles.box, { borderRadius: radius }, style]}
      accessible={!!accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}>
      {show ? (
        <Image
          source={{ uri: uri! }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={150}
          onError={() => setFailedUri(uri!)}
          accessible={false}
        />
      ) : (
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" preserveAspectRatio="none">
          <Defs>
            <RadialGradient id={id} cx={g.cx} cy={g.cy} r="60%">
              <Stop offset="0" stopColor={colors.pink} stopOpacity={0.42} />
              <Stop offset="1" stopColor={colors.pink} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={colors.nearBlack} />
          <Rect width="100%" height="100%" fill={`url(#${id})`} />
        </Svg>
      )}
      {scrim && show ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(23,21,27,${typeof scrim === 'number' ? scrim : 0.5})` }]} />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: 'hidden', backgroundColor: colors.nearBlack },
});
