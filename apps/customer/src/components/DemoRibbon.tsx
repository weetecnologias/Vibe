import { StyleSheet, View } from 'react-native';

import { apiMode } from '@/api';
import { colors, fonts } from '@/theme/tokens';

import { T } from './ui';

/**
 * Always-visible marker so demo data can never be mistaken for real data.
 * Rendered in the layout flow (not floating) so it never covers content.
 */
export function DemoRibbon() {
  if (apiMode !== 'demo') return null;
  return (
    <View style={styles.wrap} accessibilityLabel="Demo mode. Sample data on this device only, not connected to VIBE for Business. No real payments.">
      <T variant="small" color={colors.white} style={styles.text}>DEMO DATA · NOT CONNECTED TO MERCHANTS · NO REAL PAYMENTS</T>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.warning },
  text: { fontFamily: fonts.bold, fontSize: 9, lineHeight: 12, letterSpacing: 0.6 },
});
