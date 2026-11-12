import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, Pressable, Share, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api';
import { BusinessLogo } from '@/components/BusinessLogo';
import { Rating } from '@/components/cards';
import { Badge, BackButton, Button, Card, ErrorState, Icon, IconButton, LoadingState, Photo, Screen, T, type IconName } from '@/components/ui';
import { formatDate } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { groupMenu } from '@/lib/menu';
import { useAsync } from '@/lib/useAsync';
import { colors, fonts, radius } from '@/theme/tokens';

const TABS = ['Overview', 'Menu', 'Offers', 'Reviews', 'Branches'] as const;
type Tab = (typeof TABS)[number];

export default function BusinessScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { data: b, error, reload } = useAsync(() => api.getBusiness(id), [id]);
  const sports = useAsync(() => api.getVenueSports(id), [id]);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<Tab>('Overview');
  const [menuQuery, setMenuQuery] = useState('');

  if (error) return <View style={{ flex: 1, paddingTop: insets.top }}><BackButton /><ErrorState message={error} onRetry={reload} /></View>;
  if (!b) return <View style={{ flex: 1, paddingTop: insets.top + 48, backgroundColor: colors.softWhite }}><LoadingState rows={3} /></View>;

  const memberOffer = b.offers.find((o) => o.memberOnly) ?? b.offers[0];
  const kind = b.primaryCategorySlug ?? b.primaryCategoryId;
  const isCinema = kind.startsWith('movies.cinemas');
  // Overview shows a few highlights; the Menu tab shows everything, in sections, with search.
  const menuGroups = tab === 'Menu' ? groupMenu(b.menu, menuQuery) : [{ title: null as string | null, items: b.menu.slice(0, 4) }];
  const directions = () => {
    const { lat, lng } = b.location;
    const url = Platform.select({
      ios: `maps:0,0?q=${encodeURIComponent(b.name)}@${lat},${lng}`,
      android: `geo:0,0?q=${lat},${lng}(${encodeURIComponent(b.name)})`,
      default: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    });
    Linking.openURL(url!);
  };
  const share = () => Share.share({ message: `${b.name} on VIBE Hyderabad — ${b.address}` });
  const actions: { label: string; icon: IconName; onPress: () => void }[] = [
    { label: 'Call', icon: 'call', onPress: () => Linking.openURL('tel:') },
    { label: 'Directions', icon: 'directions', onPress: directions },
    { label: 'Menu', icon: 'receipt', onPress: () => setTab('Menu') },
    { label: 'Share', icon: 'share', onPress: share },
  ];
  const show = (t: Tab) => tab === 'Overview' || tab === t;

  return (
    <Screen
      edgeToEdge
      footer={
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {isCinema ? <Button label="Book tickets" style={{ flex: 1.3 }} onPress={() => router.push(`/cinema/${b.id}`)} /> : null}
          {sports.data?.length ? <Button label="Book a slot" style={{ flex: 1.3 }} onPress={() => router.push(`/book/${b.id}`)} /> : null}
          {sports.data?.length && memberOffer ? <Button label="Offer" variant="outline" style={{ flex: 0.8 }} onPress={() => router.push(`/offer/${memberOffer.id}`)} /> : sports.data?.length ? null : memberOffer ? <Button label="Redeem offer" variant={isCinema ? 'outline' : 'primary'} style={{ flex: isCinema ? 1 : 1.3 }} onPress={() => router.push(`/offer/${memberOffer.id}`)} /> : (
            <Button label="Get directions" variant="dark" style={{ flex: 1 }} onPress={directions} />
          )}
        </View>
      }>
      <Photo uri={b.photos[0] ?? b.coverUrl} seed={b.id} style={{ height: 290 }} accessibilityLabel={`Photo of ${b.name}`}>
        <View style={[styles.heroBar, { top: insets.top + 8 }]}>
          <BackButton tone="light" fallback="/home" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <IconButton icon="share" label="Share" onPress={share} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={saved ? 'Remove from saved' : 'Save'}
              accessibilityState={{ selected: saved }} aria-selected={saved}
              onPress={() => setSaved((s) => !s)}
              style={styles.saveBtn}>
              <Icon name="heart" size={20} color={saved ? colors.pink : colors.nearBlack} filled={saved} />
            </Pressable>
          </View>
        </View>
      </Photo>

      <View style={styles.infoCard}>
        <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
          <BusinessLogo name={b.name} logoUrl={b.logoUrl} />
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="title1" accessibilityRole="header">{b.name}</T>
            {b.verified ? (
              <View style={{ flexDirection: 'row', gap: 5, alignItems: 'center' }}>
                <Icon name="shield" size={13} color={colors.success} strokeWidth={2.2} />
                <T variant="small" color={colors.mutedGrey}>Verified business · {b.area}</T>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.wrap}>
          {b.categoryNames.map((c) => <Badge key={c.id} label={c.primary ? `${c.name} · Primary` : c.name} tone={c.primary ? 'dark' : 'muted'} />)}
        </View>
        <View style={[styles.wrap, { alignItems: 'center' }]}>
          <Rating value={b.rating} />
          <T variant="caption" color={colors.mutedGrey}>{b.reviewCount.toLocaleString('en-IN')} reviews</T>
          {b.costForTwo ? <T variant="captionStrong">· {formatINR(b.costForTwo)} for two</T> : null}
        </View>
        <T variant="captionStrong" color={b.status.tone === 'warning' ? colors.warning : colors.success}>{b.status.label}</T>
        <View style={styles.actions}>
          {actions.map((a) => (
            <Pressable key={a.label} accessibilityRole="button" accessibilityLabel={a.label} onPress={a.onPress} style={styles.action}>
              <Icon name={a.icon} />
              <T variant="small" style={{ fontFamily: fonts.semibold }}>{a.label}</T>
            </Pressable>
          ))}
        </View>
      </View>

      {memberOffer ? (
        <Pressable accessibilityRole="button" onPress={() => router.push(`/offer/${memberOffer.id}`)} style={styles.benefit}>
          <View style={styles.benefitBox}>
            <T style={{ fontFamily: fonts.display, fontSize: 21, color: colors.white }}>{memberOffer.headline}</T>
            <T variant="label" color={colors.white} style={{ fontSize: 10 }}>{memberOffer.headlineSub}</T>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="label" color={colors.pinkDeep}>{memberOffer.memberOnly ? 'Member benefit' : 'Offer'}</T>
            <T variant="bodyStrong">{memberOffer.title}</T>
            <T variant="small" color={colors.mutedGrey}>
              {memberOffer.scheduleLabel}{memberOffer.maxDiscount ? ` · max ${formatINR(memberOffer.maxDiscount)} off` : ''}
            </T>
          </View>
          <Icon name="chevronRight" size={20} strokeWidth={2} />
        </Pressable>
      ) : null}

      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((t) => (
          <Pressable key={t} accessibilityRole="tab" accessibilityState={{ selected: tab === t }} aria-selected={tab === t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabOn]}>
            <T variant="bodyStrong" color={tab === t ? colors.nearBlack : colors.mutedGrey} style={{ fontSize: 14 }}>
              {t}{t === 'Offers' ? ` · ${b.offers.length}` : t === 'Branches' ? ` · ${b.branches.length || 1}` : ''}
            </T>
          </Pressable>
        ))}
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 20, gap: 22 }}>
        {tab === 'Overview' ? (
          <View style={{ gap: 8 }}>
            <T variant="headline">About</T>
            <T variant="body" color={colors.mutedGrey}>{b.description}</T>
          </View>
        ) : null}

        {tab === 'Overview' ? (
          <Card style={{ padding: 16, gap: 8 }}>
            <View style={styles.between}><T variant="headline">Opening hours</T><T variant="captionStrong" color={b.status.open ? colors.success : colors.mutedGrey}>{b.status.open ? 'Open now' : 'Closed'}</T></View>
            {b.hours.map((h) => (
              <View key={h.day} style={styles.between}>
                <T variant={h.today ? 'captionStrong' : 'caption'} color={h.today ? colors.nearBlack : colors.mutedGrey}>{h.day}{h.today ? ' (today)' : ''}</T>
                <T variant={h.today ? 'captionStrong' : 'caption'} color={h.today ? colors.nearBlack : colors.mutedGrey}>{h.hours}</T>
              </View>
            ))}
          </Card>
        ) : null}

        {show('Overview') && sports.data?.length ? (
          <View style={{ gap: 12 }}>
            <T variant="headline">Sports available</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {sports.data.map((s) => (
                <Pressable key={s.sport} accessibilityRole="button" accessibilityLabel={`Book ${s.sport}, from ${formatINR(s.fromPrice)}`} onPress={() => router.push(`/book/${b.id}`)}
                  style={{ paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.white, gap: 2 }}>
                  <T variant="captionStrong">{s.sport}</T>
                  <T variant="small" color={colors.mutedGrey}>{s.kind === 'court' ? `${s.resources} ${s.resources === 1 ? 'court' : 'courts'}` : 'Sessions'} · from {formatINR(s.fromPrice)}/{s.slotMinutes === 60 ? 'hr' : `${s.slotMinutes} min`}</T>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {show('Menu') && b.menu.length ? (
          <View style={{ gap: 10 }}>
            <T variant="headline">{kind.startsWith('food') ? 'Menu highlights' : 'Services & prices'}</T>
            {tab === 'Menu' && b.menu.length > 8 ? (
              <TextInput
                value={menuQuery}
                onChangeText={setMenuQuery}
                placeholder={`Search ${b.menu.length} items`}
                placeholderTextColor={colors.mutedGrey}
                accessibilityLabel="Search the menu"
                style={styles.menuSearch}
              />
            ) : null}
            {menuGroups.map((g) => (
              <View key={g.title ?? 'all'} style={{ gap: 10 }}>
                {g.title && tab === 'Menu' ? <T variant="label" color={colors.mutedGrey} accessibilityRole="header">{g.title}</T> : null}
                {g.items.map((m) => (
                  <Card key={m.id} style={styles.menuRow}>
                    {m.imageUrl ? <Photo uri={m.imageUrl} seed={m.id} style={{ width: 56, height: 56 }} radius={12} /> : null}
                    <View style={{ flex: 1 }}><T variant="captionStrong">{m.name}</T><T variant="small" color={colors.mutedGrey}>{m.note}</T></View>
                    <T variant="captionStrong">{formatINR(m.price)}</T>
                  </Card>
                ))}
              </View>
            ))}
            {tab === 'Menu' && menuQuery && menuGroups.length === 0 ? <T variant="caption" color={colors.mutedGrey}>Nothing matches “{menuQuery}”.</T> : null}
            {tab === 'Overview' && b.menu.length > 4 ? <Button label={`See all ${b.menu.length} items`} variant="ghost" size="md" onPress={() => setTab('Menu')} /> : null}
          </View>
        ) : null}
        {tab === 'Menu' && !b.menu.length ? <T variant="caption" color={colors.mutedGrey}>This business hasn’t added a menu yet.</T> : null}

        {show('Offers') ? (
          <View style={{ gap: 10 }}>
            <T variant="headline">Offers here</T>
            {b.offers.length === 0 ? <T variant="caption" color={colors.mutedGrey}>No active offers right now.</T> : null}
            {b.offers.map((o) => (
              <Pressable key={o.id} accessibilityRole="button" onPress={() => router.push(`/offer/${o.id}`)}>
                <Card style={[styles.menuRow, { paddingHorizontal: 16 }]}>
                  <View style={{ flex: 1, gap: 2 }}><T variant="captionStrong">{o.title}</T><T variant="small" color={colors.mutedGrey}>{o.memberOnly ? 'Members' : 'All VIBE users'} · until {formatDate(o.endsAt)}</T></View>
                  <Badge label={o.memberOnly ? 'MEMBER' : o.headline} tone={o.memberOnly ? 'pink' : 'pinkSoft'} />
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}

        {tab === 'Overview' ? (
          <View style={{ gap: 10 }}>
            <T variant="headline">Location</T>
            <Card style={{ overflow: 'hidden' }}>
              <View style={styles.mapStub}>
                <Icon name="pin" size={28} color={colors.pink} strokeWidth={2.2} />
              </View>
              <View style={[styles.between, { padding: 14 }]}>
                <View style={{ flex: 1 }}><T variant="captionStrong">{b.address.split(',')[0]}, {b.area}</T><T variant="small" color={colors.mutedGrey}>{b.distanceKm} km away</T></View>
                <Button label="Directions" icon="directions" variant="dark" size="sm" onPress={directions} />
              </View>
            </Card>
          </View>
        ) : null}

        {show('Branches') && b.branches.length ? (
          <View style={{ gap: 10 }}>
            <T variant="headline">Branches</T>
            {b.branches.map((br) => (
              <Card key={br.id} style={[styles.menuRow, { paddingHorizontal: 16 }]}>
                <View style={{ flex: 1 }}><T variant="captionStrong">{br.name}</T><T variant="small" color={colors.mutedGrey}>{br.address} · {br.distanceKm} km</T></View>
                <T variant="small" color={colors.success} style={{ fontFamily: fonts.semibold }}>{br.status.label}</T>
              </Card>
            ))}
          </View>
        ) : null}

        {show('Reviews') ? (
          <View style={{ gap: 10 }}>
            <T variant="headline">Ratings & reviews</T>
            {b.reviews.length === 0 ? <T variant="caption" color={colors.mutedGrey}>No reviews yet. Reviews come from verified VIBE visits.</T> : null}
            {b.reviews.map((r) => (
              <Card key={r.id} style={{ padding: 16, gap: 8 }}>
                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                  <View style={styles.avatar}><T variant="captionStrong" color={colors.white}>{r.authorName.split(' ').map((w) => w[0]).join('')}</T></View>
                  <View style={{ flex: 1 }}><T variant="captionStrong">{r.authorName}</T><T variant="small" color={colors.mutedGrey}>{formatDate(r.createdAt)}{r.verifiedVisit ? ' · Verified visit' : ''}</T></View>
                  <Rating value={r.rating} />
                </View>
                <T variant="caption">{r.text}</T>
              </Card>
            ))}
          </View>
        ) : null}

        {tab === 'Overview' ? (
          <Card style={{ padding: 16, gap: 6 }}>
            <T variant="headline">Terms and conditions</T>
            {b.terms.map((t) => <T key={t} variant="caption" color={colors.mutedGrey}>• {t}</T>)}
          </Card>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  saveBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
  infoCard: { marginTop: -28, marginHorizontal: 16, backgroundColor: colors.white, borderRadius: 24, borderWidth: 1, borderColor: colors.hairline, padding: 20, gap: 12 },
  logo: { width: 60, height: 60, borderRadius: 16, backgroundColor: colors.nearBlack, alignItems: 'center', justifyContent: 'center' },
  menuSearch: { height: 46, borderRadius: 14, borderWidth: 1.5, borderColor: colors.hairline, backgroundColor: colors.white, paddingHorizontal: 14, fontFamily: fonts.medium, fontSize: 15, color: colors.nearBlack },
  logoText: { fontFamily: fonts.displayHeavy, fontSize: 20, color: colors.pink },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  actions: { flexDirection: 'row', gap: 8, paddingTop: 4 },
  action: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 16, backgroundColor: colors.softWhite },
  benefit: { marginHorizontal: 16, marginTop: 14, padding: 16, borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.pink, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', gap: 14 },
  benefitBox: { width: 64, height: 64, borderRadius: 16, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center' },
  tabs: { flexDirection: 'row', gap: 18, marginHorizontal: 16, marginTop: 20, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  tab: { paddingTop: 4, paddingBottom: 12, borderBottomWidth: 2.5, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: colors.pink },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 },
  mapStub: { height: 110, backgroundColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.nearBlack, alignItems: 'center', justifyContent: 'center' },
});
