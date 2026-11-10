import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

/** 24px rounded line icons from the VIBE design system. One path per icon. */
export const iconPaths = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  discover: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M15.5 8.5l-2 5-5 2 2-5z',
  social: 'M5.5 8a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.8a3.5 3.5 0 0 1 0 6.4M18 14.8c1.9.7 3.1 2.5 3.5 5.2',
  membership: 'M5.5 5h13a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-13a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM2.5 10h19M6.5 15h4',
  profile: 'M8 8a4 4 0 1 0 8 0a4 4 0 1 0-8 0M4 21c1-4 4.2-6 8-6s7 2 8 6',
  search: 'M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0M20 20l-3.5-3.5',
  pin: 'M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM9.5 9.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0',
  heart: 'M12 20s-7.5-4.6-9-9.3C2 7.4 4.3 4.5 7.3 4.5c2 0 3.6 1.1 4.7 2.8 1.1-1.7 2.7-2.8 4.7-2.8 3 0 5.3 2.9 4.3 6.2C19.5 15.4 12 20 12 20z',
  star: 'M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z',
  offer: 'M3 12V4h8l10 10-8 8zM6 8.5a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  calendar: 'M6 5h12a2.5 2.5 0 0 1 2.5 2.5v10.5a2.5 2.5 0 0 1-2.5 2.5H6a2.5 2.5 0 0 1-2.5-2.5V7.5A2.5 2.5 0 0 1 6 5zM3.5 10h17M8 3v4M16 3v4',
  clock: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2',
  ticket: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V14a2 2 0 0 0 0-4zM14.5 6v12',
  shield: 'M12 3L4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6zM9 12l2 2 4-4',
  flag: 'M5 21V4h12l-2 4 2 4H5',
  filters: 'M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M13 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0M7 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0M15 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  map: 'M9 4L3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5zM9 4v13.5M15 6.5V20',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6v.01M3.5 12v.01M3.5 18v.01',
  directions: 'M3 11l18-8-8 18-2-8z',
  call: 'M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  share: 'M15.5 5.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M3.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M15.5 18.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M8.2 10.8l7.6-4.1M8.2 13.2l7.6 4.1',
  wallet: 'M5.5 6h13A2.5 2.5 0 0 1 21 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-8A2.5 2.5 0 0 1 5.5 6zM3 10h18M16 14.5h2',
  bank: 'M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18',
  receipt: 'M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21zM9 8h6M9 12h6M9 16h3',
  food: 'M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10M17 21V3c-2.5 1-4 3.5-4 7v4h4',
  shopping: 'M5 8h14l-1 13H6zM9 8V6.5a3 3 0 0 1 6 0V8',
  fitness: 'M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11',
  beauty: 'M3.5 7a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M3.5 17a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M8 8.5L20 18M8 15.5L20 6',
  kids: 'M12 15c-3.3 0-6-3-6-6.5a6 6 0 0 1 12 0C18 12 15.3 15 12 15zM11 15l1 1.5 1-1.5M12 16.5c0 2-1.5 2.5-1.5 4.5',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  lock: 'M7 10.5h10a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zM8 10.5v-3a4 4 0 0 1 8 0v3',
  help: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5v.7M12 16.5v.01',
  info: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 11v5M12 7.5v.01',
  doc: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  crosshair: 'M5 12a7 7 0 1 0 14 0a7 7 0 1 0-14 0M9.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M12 2v3M12 19v3M2 12h3M19 12h3',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  back: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
} as const;

export type IconName = keyof typeof iconPaths;

/** Falls back to a default icon, so an unknown name (say a new admin-created category) never renders blank. */
export function resolveIconName(name?: string | null): IconName {
  return name && Object.prototype.hasOwnProperty.call(iconPaths, name) ? (name as IconName) : 'sparkle';
}

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  filled?: boolean;
};

export function Icon({ name, size = 22, color = colors.nearBlack, strokeWidth = 1.8, filled = false }: Props) {
  return (
    <View aria-hidden pointerEvents="none" style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path
        d={iconPaths[resolveIconName(name)]}
        fill={filled ? color : 'none'}
        stroke={color}
        strokeWidth={filled ? 0 : strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}
