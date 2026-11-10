import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { T } from '@/components/ui';
import { useSession } from '@/state/session';
import { colors, fonts } from '@/theme/tokens';

/** Branded splash, then route to the right place for this session. */
export default function Splash() {
  const { status, onboarded, area } = useSession();
  const [done, setDone] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDone(true), 900);
    return () => clearTimeout(t);
  }, []);

  if (done) {
    if (status === 'signedOut') return <Redirect href={onboarded ? '/login' : '/onboarding'} />;
    if (!area) return <Redirect href="/location" />;
    return <Redirect href="/home" />;
  }

  return (
    <View style={styles.root} accessibilityLabel="VIBE Hyderabad">
      <View style={styles.center}>
        <T style={styles.logo}>VIBE</T>
        <T variant="small" color="rgba(255,255,255,0.78)" style={styles.city}>HYDERABAD</T>
      </View>
      <View style={styles.bottom}>
        <View style={styles.dots}>
          <View style={[styles.dot, { backgroundColor: colors.pink }]} />
          <View style={styles.dot} />
          <View style={styles.dot} />
        </View>
        <T variant="caption" color={colors.onDarkMuted}>Discover · Save · Belong</T>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.nearBlack, justifyContent: 'center' },
  center: { alignItems: 'center', gap: 14 },
  logo: { fontFamily: fonts.displayHeavy, fontSize: 84, lineHeight: 92, letterSpacing: -4, color: colors.pink },
  city: { fontFamily: fonts.semibold, fontSize: 13, letterSpacing: 5.5, paddingLeft: 5.5 },
  bottom: { position: 'absolute', bottom: 56, left: 0, right: 0, alignItems: 'center', gap: 20 },
  dots: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.28)' },
});
