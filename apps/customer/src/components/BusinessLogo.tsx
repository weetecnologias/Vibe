import { Image } from 'expo-image';
import { useState } from 'react';
import { View } from 'react-native';

import { colors, fonts } from '@/theme/tokens';

import { T } from './ui';

/** "Saffron Courtyard" -> "SC". */
export function initialsOf(name: string): string {
  const letter = /[\p{L}\p{N}]/u;
  return name.split(/\s+/).filter((w) => letter.test(w)).map((w) => w.match(letter)![0]).slice(0, 2).join('').toUpperCase();
}

/**
 * A business logo. Merchants upload one in their dashboard (logoUrl); until
 * then, or if the image can't load, the business initials are shown.
 */
export function BusinessLogo({ name, logoUrl, size = 60, radius = 16 }: { name: string; logoUrl?: string | null; size?: number; radius?: number }) {
  const [failed, setFailed] = useState(false);
  if (logoUrl && !failed) {
    return (
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${name} logo`}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden', padding: size * 0.1 }}>
        <Image source={{ uri: logoUrl }} style={{ flex: 1 }} contentFit="contain" onError={() => setFailed(true)} />
      </View>
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: radius, backgroundColor: colors.nearBlack, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden aria-hidden>
      <T style={{ fontFamily: fonts.displayHeavy, fontSize: size * 0.33, color: colors.pink }}>{initialsOf(name)}</T>
    </View>
  );
}
