import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { BackButton, Button, Chip, Icon, Screen, T } from '@/components/ui';
import { useSession } from '@/state/session';
import { colors, fonts, radius } from '@/theme/tokens';

/** Popular localities. In production this list comes from the admin-managed areas API. */
const AREAS = [
  { name: 'Jubilee Hills', lat: 17.4306, lng: 78.4071 }, { name: 'Banjara Hills', lat: 17.4126, lng: 78.4392 },
  { name: 'Gachibowli', lat: 17.4401, lng: 78.3489 }, { name: 'Hitech City', lat: 17.4474, lng: 78.3762 },
  { name: 'Madhapur', lat: 17.4483, lng: 78.3915 }, { name: 'Kondapur', lat: 17.4632, lng: 78.3634 },
  { name: 'Kukatpally', lat: 17.4849, lng: 78.4138 }, { name: 'Secunderabad', lat: 17.4399, lng: 78.4983 },
  { name: 'Begumpet', lat: 17.4447, lng: 78.4664 }, { name: 'Himayatnagar', lat: 17.4012, lng: 78.4867 },
  { name: 'Kokapet', lat: 17.3984, lng: 78.3283 }, { name: 'Old City', lat: 17.3616, lng: 78.4747 },
];

function nearestArea(lat: number, lng: number) {
  let best = AREAS[0];
  let bestD = Infinity;
  for (const a of AREAS) {
    const d = (a.lat - lat) ** 2 + (a.lng - lng) ** 2;
    if (d < bestD) { best = a; bestD = d; }
  }
  // Roughly 30 km from the city centre counts as outside Hyderabad.
  return bestD > 0.08 ? null : best.name;
}

export default function LocationScreen() {
  const { area, setArea } = useSession();
  const [picked, setPicked] = useState(area ?? 'Jubilee Hills');
  const [query, setQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const filtered = AREAS.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()));

  const useCurrent = async () => {
    setLocating(true);
    setMessage(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setMessage('Location permission was not given. Pick your area below instead.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const n = nearestArea(pos.coords.latitude, pos.coords.longitude);
      if (n) setPicked(n);
      else setMessage('Looks like you’re outside Hyderabad. VIBE is Hyderabad-only for now, so pick an area below.');
    } catch {
      setMessage('Couldn’t get your location. Pick your area below.');
    } finally {
      setLocating(false);
    }
  };

  const confirm = async () => {
    await setArea(picked);
    if (router.canGoBack() && area) router.back();
    else router.replace('/home');
  };

  return (
    <Screen
      style={{ backgroundColor: colors.white }}
      contentContainerStyle={{ paddingHorizontal: 24 }}
      footer={
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Icon name="lock" size={16} color={colors.mutedGrey} />
            <T variant="small" color={colors.mutedGrey} style={{ flex: 1 }}>Location is only used while the app is open. Manage it in Profile › Privacy.</T>
          </View>
          <Button label={`Continue with ${picked}`} onPress={confirm} />
        </View>
      }>
      {area ? <View style={{ marginLeft: -10 }}><BackButton fallback="/home" /></View> : <View style={{ height: 24 }} />}
      <T variant="title1" style={{ marginTop: 12 }} accessibilityRole="header">Where in Hyderabad?</T>
      <T variant="body" color={colors.mutedGrey} style={{ marginTop: 8 }}>We show places, offers and events near you. Change it anytime from Home.</T>

      <Pressable accessibilityRole="button" onPress={useCurrent} disabled={locating} style={({ pressed }) => [styles.current, pressed && { opacity: 0.85 }]}>
        <Icon name="crosshair" color={colors.pink} />
        <T variant="bodyStrong" color={colors.white} style={{ flex: 1 }}>{locating ? 'Finding you…' : 'Use my current location'}</T>
        <Icon name="chevronRight" color={colors.white} size={18} strokeWidth={2} />
      </Pressable>
      {message ? <T variant="caption" color={colors.warning} style={{ marginTop: 10 }}>{message}</T> : null}

      <View style={styles.search}>
        <Icon name="search" size={20} color={colors.mutedGrey} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search area or locality"
          placeholderTextColor={colors.mutedGrey}
          accessibilityLabel="Search area"
          style={styles.searchInput}
        />
      </View>

      <T variant="label" color={colors.mutedGrey} style={{ marginTop: 28, marginBottom: 12 }}>Popular areas</T>
      <View style={styles.grid}>
        {filtered.map((a) => (
          <Chip key={a.name} label={a.name} selected={picked === a.name} onPress={() => setPicked(a.name)} />
        ))}
        {filtered.length === 0 ? <T variant="caption" color={colors.mutedGrey}>No matching area yet. VIBE is adding more of Hyderabad soon.</T> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  current: { marginTop: 24, height: 56, borderRadius: 16, backgroundColor: colors.nearBlack, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18 },
  search: { marginTop: 14, height: 52, borderWidth: 1.5, borderColor: colors.hairline, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14 },
  searchInput: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.nearBlack, height: '100%' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
