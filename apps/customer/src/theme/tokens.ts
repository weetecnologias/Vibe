/**
 * VIBE design tokens. Mirrors the approved design system canvas
 * (design/ui-canvas/project/Main.dc.html). Do not add colours here
 * without brand approval.
 */
export const colors = {
  // Brand palette (exact)
  nearBlack: '#17151B',
  pink: '#E80069',
  white: '#FFFFFF',
  softWhite: '#F8F6F9',
  mutedGrey: '#69646E',

  // Derived shades, used only where the brand colours fail contrast
  pinkDeep: '#C8005A', // pink text under 18px on light backgrounds; pressed state
  pinkTint: '#FDE6F0', // offer chips, selected rows
  darkSurface: '#221F27', // cards and inputs on near-black
  hairline: '#E9E6EC', // borders, dividers, skeletons

  // Status colours — only ever mean status
  success: '#177A4C',
  successTint: '#E7F3ED',
  error: '#D93025',
  errorTint: '#FBE9E7',
  warning: '#9A5B00',
  warningTint: '#FBF0E0',

  // Translucent white on dark surfaces
  onDarkMuted: 'rgba(255,255,255,0.72)',
  onDarkSubtle: 'rgba(255,255,255,0.6)',
} as const;

export const space = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, xxxl: 40 } as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;

export const fonts = {
  display: 'Sora_700Bold',
  displayHeavy: 'Sora_800ExtraBold',
  displaySemi: 'Sora_600SemiBold',
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const type = {
  display: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  title1: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, letterSpacing: -0.3 },
  title2: { fontFamily: fonts.display, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  title3: { fontFamily: fonts.displaySemi, fontSize: 17, lineHeight: 22 },
  headline: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22 },
  caption: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  captionStrong: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  small: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  label: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, letterSpacing: 0.66, textTransform: 'uppercase' as const },
  amount: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, letterSpacing: -0.3 },
} as const;

export type TypeVariant = keyof typeof type;

export const shadow = {
  raised: {
    shadowColor: '#17151B',
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -6 },
    elevation: 8,
  },
} as const;
