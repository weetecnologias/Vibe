import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Badge, Button, Icon, Photo, T, type IconName } from '@/components/ui';
import { useSession } from '@/state/session';
import { colors, fonts, radius } from '@/theme/tokens';

const slides = [
  { key: 'discover', title: 'Discover Hyderabad’s best', body: 'From Jubilee Hills cafés to Old City food walks: restaurants, studios, salons and experiences, curated in one place.' },
  { key: 'save', title: 'Members save more, every time', body: 'Pick an offer, the merchant sends your bill, VIBE applies the discount and you pay in the app. No codes, no coupons.' },
  { key: 'social', title: 'Find your people', body: 'Running groups, book clubs and hosted dinners, with verified hosts and safety controls built in.' },
];

const cats: { label: string; icon: IconName }[] = [
  { label: 'Food', icon: 'food' }, { label: 'Shopping', icon: 'shopping' }, { label: 'Fitness', icon: 'fitness' }, { label: 'Beauty', icon: 'beauty' },
  { label: 'Kids', icon: 'kids' }, { label: 'Events', icon: 'ticket' }, { label: 'Social', icon: 'social' }, { label: 'Offers', icon: 'offer' },
];

function Art({ k }: { k: string }) {
  if (k === 'discover') {
    return (
      <View style={{ gap: 28 }}>
        <View style={styles.catGrid}>
          {cats.map((c, i) => (
            <View key={c.label} style={styles.catCell}>
              <View style={[styles.catTile, { backgroundColor: i === 0 ? colors.pink : colors.darkSurface }]}>
                <Icon name={c.icon} size={26} color={colors.white} />
              </View>
              <T variant="small" color={colors.onDarkMuted} style={{ fontFamily: fonts.semibold, fontSize: 11 }}>{c.label}</T>
            </View>
          ))}
        </View>
        <View style={styles.miniCard}>
          <Photo seed="brew" style={{ width: 52, height: 52 }} radius={14} />
          <View style={{ flex: 1 }}>
            <T variant="headline" style={{ fontSize: 15 }}>Brew & Bloom Café</T>
            <T variant="small" color={colors.mutedGrey}>Café · Banjara Hills · 0.8 km</T>
          </View>
          <Badge label="20% OFF" />
        </View>
      </View>
    );
  }
  if (k === 'save') {
    return (
      <View style={styles.bill}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <T variant="label" color={colors.mutedGrey}>Bill from merchant</T>
            <T variant="headline" style={{ fontSize: 15 }}>Saffron Courtyard</T>
          </View>
          <Badge label="MEMBER" tone="pink" />
        </View>
        <Line k="Eligible bill" v="₹1,000" />
        <Line k="Member offer · 30%" v="−₹300" pink />
        <View style={{ height: 1, backgroundColor: colors.hairline }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <T variant="bodyStrong">You pay</T>
          <T variant="amount">₹700</T>
        </View>
        <Badge label="You saved ₹300" tone="success" icon="check" />
      </View>
    );
  }
  return (
    <View style={{ gap: 20 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
        {[['PR', colors.pink], ['SK', colors.darkSurface], ['MN', colors.mutedGrey], ['PV', colors.darkSurface], ['+20', colors.pink]].map(([i, bg]) => (
          <View key={i} style={[styles.avatar, { backgroundColor: bg }]}>
            <T variant="headline" color={colors.white} style={{ fontFamily: fonts.display }}>{i}</T>
          </View>
        ))}
      </View>
      <View style={styles.activity}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <T variant="headline" color={colors.white}>Sunday Sunrise Run</T>
            <T variant="small" color={colors.onDarkMuted}>Sun · 6:00 AM · Necklace Road · 5 km</T>
          </View>
          <Badge label="Verified host" tone="dark" icon="shield" />
        </View>
        <T variant="small" color={colors.onDarkMuted}>24 going · 6 spots left</T>
      </View>
    </View>
  );
}

function Line({ k, v, pink }: { k: string; v: string; pink?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <T variant="caption" color={colors.mutedGrey}>{k}</T>
      <T variant="captionStrong" color={pink ? colors.pinkDeep : colors.nearBlack}>{v}</T>
    </View>
  );
}

export default function Onboarding() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { completeOnboarding } = useSession();
  const [index, setIndex] = useState(0);
  const list = useRef<FlatList>(null);

  const finish = async () => {
    await completeOnboarding();
    router.replace('/login');
  };
  const next = () => {
    if (index < slides.length - 1) {
      const nextIndex = index + 1;
      setIndex(nextIndex);
      list.current?.scrollToOffset({ offset: nextIndex * width, animated: true });
    } else finish();
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width));

  return (
    <View style={{ flex: 1, backgroundColor: colors.white }}>
      <FlatList
        ref={list}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        keyExtractor={(s) => s.key}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => (
          <View style={{ width }}>
            <View style={[styles.hero, { paddingTop: insets.top + 16 }]}>
              <View style={styles.heroTop}>
                <T style={styles.logo}>VIBE</T>
                <Pressable accessibilityRole="button" onPress={finish} hitSlop={12}>
                  <T variant="bodyStrong" color="rgba(255,255,255,0.8)">Skip</T>
                </Pressable>
              </View>
              <View style={{ marginTop: 36 }}><Art k={item.key} /></View>
            </View>
            <View style={styles.copy}>
              <T variant="display" accessibilityRole="header">{item.title}</T>
              <T variant="body" color={colors.mutedGrey}>{item.body}</T>
            </View>
          </View>
        )}
      />
      <View style={[styles.footer, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.dots} accessibilityLabel={`Step ${index + 1} of ${slides.length}`}>
          {slides.map((s, i) => (
            <View key={s.key} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>
        <Button label={index === slides.length - 1 ? 'Get started' : 'Next'} onPress={next} />
        {index === slides.length - 1 ? (
          <Button label="I already have an account" variant="ghost" onPress={finish} style={{ marginTop: 4 }} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { height: 500, backgroundColor: colors.nearBlack, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, paddingHorizontal: 24 },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  logo: { fontFamily: fonts.displayHeavy, fontSize: 24, letterSpacing: -1, color: colors.pink },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 },
  catCell: { width: '25%', alignItems: 'center', gap: 8 },
  catTile: { width: 64, height: 64, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  miniCard: { backgroundColor: colors.white, borderRadius: radius.lg, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  bill: { backgroundColor: colors.white, borderRadius: 24, padding: 20, gap: 14, marginHorizontal: 12 },
  avatar: { width: 60, height: 60, borderRadius: 30, marginLeft: -12, borderWidth: 3, borderColor: colors.nearBlack, alignItems: 'center', justifyContent: 'center' },
  activity: { backgroundColor: colors.darkSurface, borderRadius: 24, padding: 18, gap: 12 },
  copy: { paddingHorizontal: 28, paddingTop: 52, gap: 12 },
  footer: { paddingHorizontal: 28, gap: 8 },
  dots: { flexDirection: 'row', gap: 6, marginBottom: 16 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.hairline },
  dotOn: { width: 24, backgroundColor: colors.pink },
});
