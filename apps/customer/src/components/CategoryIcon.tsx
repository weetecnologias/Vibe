import { Image } from 'expo-image';
import { useState } from 'react';

import { Icon, resolveIconName } from './ui/Icon';

/**
 * A category's icon. Admins can either pick one of the built-in icons by name
 * or upload their own (iconUrl, SVG or PNG). Anything missing or broken falls
 * back to a default icon, so a new category never shows blank.
 */
export function CategoryIcon({ icon, iconUrl, size = 26, color }: { icon?: string | null; iconUrl?: string | null; size?: number; color?: string }) {
  const [failed, setFailed] = useState(false);
  if (iconUrl && !failed) {
    return (
      <Image
        source={{ uri: iconUrl }}
        style={{ width: size, height: size }}
        contentFit="contain"
        onError={() => setFailed(true)}
        accessible={false}
      />
    );
  }
  return <Icon name={resolveIconName(icon)} size={size} color={color} />;
}
