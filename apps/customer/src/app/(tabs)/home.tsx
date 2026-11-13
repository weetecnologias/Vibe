import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '@/api';
import { CategoryIcon } from '@/components/CategoryIcon';
import { BusinessRow, BusinessTile, EventTile, OfferCard } from '@/components/cards';
import { Button, ErrorState, Icon, LoadingState, Photo, SectionHeader, T } from '@/components/ui';
import { formatINR } from '@/lib/money';
import { useAsync } from '@/lib/useAsync';
import { useSession } from '@/state/session';
import { colors, fonts, radius } from '@/theme/tokens';

/** "Food & Dining" → "Food", "VIBE Social" → "Social". */
function shortName(name: string) {
  const words = name.replace('&', '').split(/\s+/).filter((w) => w && w !== 'VIBE');
  return words[0] ?? name;
}

function Carousel({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}>
      {children}
    </ScrollView>
  );
}

/**
 * Bills waiting for you to pay, wherever they came from: one you asked for, or one a business raised from your VIBE ID. Checked every few seconds
 * while Home is open, so a bill appears here by itself the moment the business sends it.
 */
/** The number of unread notifications on the bell, refreshed while Home is open (push is not connected yet). */
function UnreadCount() {
  const { status } = useSession();
  const unread = useAsync(() => (status === 'signedIn' ? api.getNotifications(true) : Promise.resolve([])), [status]);
  const reload = unread.reload;
  useEffect(() => {
    if (status !== 'signedIn') return;
    const t = setInterval(reload, 8000);
    return () => clearInterval(t);
  }, [status, reload]);
  const n = unread.data?.length ?? 0;
  if (!n) return null;
  return <View style={styles.badge} accessibilityLabel={`${n} unread`}><T variant="small" color={colors.white} style={{ fontSize: 11, lineHeight: 14 }}>{n > 9 ? '9+' : n}</T></View>;
}

function BillsDue() {
  const { status } = useSession();
  const bills = useAsync(() => (status === 'signedIn' ? api.getMyBills() : Promise.resolve([])), [status]);
  const reload = bills.reload;
  useEffect(() => {
    if (status !== 'signedIn') return;
    const t = setInterval(reload, 8000);
    return () => clearInterval(t);
  }, [status, reload]);
  if (!bills.data?.length) return null;
  return (
    <View style={{ paddingHorizontal: 20, gap: 10, marginTop: 14 }}>
      {bills.data.map((b) => (
        <Pressable key={b.id} accessibilityRole="button" accessibilityLabel={`Bill from ${b.businessName}: ${formatINR(b.paymentRequest?.payable ?? 0, { decimals: 'always' })}. Pay now`} onPress={() => router.push(`/bill/${b.id}`)} style={styles.bill}>
          <View style={{ flex: 1 }}>
            <T variant="label" color={colors.pinkDeep}>Bill ready to pay</T>
            <T variant="bodyStrong" numberOfLines={1}>{b.businessName}</T>
            <T variant="caption" color={colors.mutedGrey}>{b.paymentRequest && b.paymentRequest.discount > 0 ? `You save ${formatINR(b.paymentRequest.discount, { decimals: 'always' })}` : 'Tap to see the items and apply an offer or coupon'}</T>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <T variant="title2">{formatINR(b.paymentRequest?.payable ?? 0, { decimals: 'always' })}</T>
            <T variant="captionStrong" color={colors.pinkDeep}>Pay now</T>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const { area } = useSession();
  const home = useAsync(() => api.getHome(area), [area]);
  const cats = useAsync(() => api.getCategories(), []);

  const h = home.data;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.softWhite }}
      contentContainerStyle={{ paddingBottom: 32, gap: 30 }}
      refreshControl={<RefreshControl refreshing={home.loading && !!h} onRefresh={home.reload} tintColor={colors.pink} />}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={styles.headerRow}>
          <T style={styles.logo}>VIBE</T>
          <Pressable accessibilityRole="button" accessibilityLabel={`Location: ${area}. Change`} onPress={() => router.push('/location')} style={{ flex: 1 }}>
            <T variant="small" color={colors.onDarkSubtle}>Hyderabad</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="pin" size={14} color={colors.pink} strokeWidth={2.2} />
              <T variant="captionStrong" color={colors.white} style={{ fontSize: 14 }}>{area}</T>
              <Icon name="chevronDown" size={14} color={colors.white} strokeWidth={2.2} />
            </View>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Notifications" onPress={() => router.push('/notifications')} style={styles.bell}>
            <Icon name="bell" color={colors.white} />
            <UnreadCount />
          </Pressable>
        </View>
        <Pressable accessibilityRole="search" onPress={() => router.push('/discover')} style={styles.search}>
          <Icon name="search" size={20} />
          <T variant="body" color={colors.mutedGrey} style={{ flex: 1 }}>Search places, offers, events</T>
          <View style={styles.filterBtn}><Icon name="filters" size={18} color={colors.white} /></View>
        </Pressable>
      </View>

      <BillsDue />

      {home.error && !h ? <ErrorState message={home.error} onRetry={home.reload} /> : null}
      {!h && !home.error ? <LoadingState rows={3} /> : null}

      {h ? (
        <>
          <View style={{ marginTop: -8 }}>
            <Carousel>
              {h.banners.map((b, i) => (
                <Pressable
                  key={b.id}
                  accessibilityRole="button"
                  accessibilityLabel={b.title}
                  onPress={() => (b.target.type === 'offer' && b.target.id ? router.push(`/offer/${b.target.id}`) : router.push('/events'))}
                  style={[styles.banner, { backgroundColor: i === 0 ? colors.pink : colors.nearBlack }]}>
                  <View style={{ flex: 1, padding: 20, gap: 6 }}>
                    <T variant="label" color="rgba(255,255,255,0.88)">{b.eyebrow}</T>
                    <T variant="title3" color={colors.white} numberOfLines={3}>{b.title}</T>
                    <T variant="caption" color="rgba(255,255,255,0.9)" numberOfLines={1}>{b.subtitle}</T>
                    <View style={styles.bannerCta}><T variant="captionStrong">{b.cta}</T></View>
                  </View>
                  <Photo uri={b.imageUrl} seed={b.id} style={{ width: 110 }} />
                </Pressable>
              ))}
            </Carousel>
          </View>

          <View style={{ gap: 14, paddingHorizontal: 20 }}>
            <T variant="title2" accessibilityRole="header">Explore</T>
            <View style={styles.catGrid}>
              {(cats.data ?? []).map((c) => (
                <Pressable
                  key={c.id}
                  accessibilityRole="button"
                  accessibilityLabel={c.name}
                  onPress={() => (c.slug === 'social' ? router.push('/social') : c.slug === 'events' ? router.push('/events') : c.slug === 'movies' ? router.push('/movies') : router.push(`/category/${c.id}`))}
                  style={styles.catTile}>
                  <CategoryIcon icon={c.icon} iconUrl={c.iconUrl} size={26} color={c.slug === 'offers' ? colors.pink : colors.nearBlack} />
                  <T variant="small" style={{ fontFamily: fonts.semibold }} numberOfLines={1}>{shortName(c.name)}</T>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={{ gap: 14 }}>
            <SectionHeader title="Trending in Hyderabad" action="See all" onAction={() => router.push('/discover')} />
            <Carousel>{h.trending.map((b) => <BusinessTile key={b.id} b={b} />)}</Carousel>
          </View>

          <View style={{ gap: 14 }}>
            <SectionHeader title="Popular offers" action="All offers" onAction={() => router.push('/category/offers')} />
            <Carousel>{h.offers.map((o) => <OfferCard key={o.id} o={o} />)}</Carousel>
          </View>

          {h.membershipPromo ? (
            <View style={{ paddingHorizontal: 20 }}>
              <View style={styles.promo}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <T variant="label" color={colors.onDarkMuted}>VIBE Membership</T>
                  <T variant="captionStrong" color={colors.white}>{formatINR(h.membershipPromo.price)} / {h.membershipPromo.interval}</T>
                </View>
                <T variant="title2" color={colors.white}>Member-only prices across food, fitness, beauty and more</T>
                <T variant="caption" color={colors.onDarkMuted}>Discounts applied automatically when you pay through VIBE. Cancel anytime.</T>
                <Button label="Explore membership" onPress={() => router.push('/membership')} size="md" />
              </View>
            </View>
          ) : null}

          <View style={{ gap: 14 }}>
            <SectionHeader title="Upcoming events" action="See all" onAction={() => router.push('/events')} />
            <Carousel>{h.events.map((e) => <EventTile key={e.id} e={e} />)}</Carousel>
          </View>

          <View style={{ gap: 12, paddingHorizontal: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <T variant="title2" accessibilityRole="header">Nearby you</T>
              <T variant="captionStrong" color={colors.pinkDeep} onPress={() => router.push('/discover')} accessibilityRole="link">Map view</T>
            </View>
            {h.nearby.map((b) => <BusinessRow key={b.id} b={b} />)}
          </View>

          {h.experiences.length ? (
            <View style={{ gap: 14 }}>
              <SectionHeader title="Recommended experiences" />
              <Carousel>
                {h.experiences.map((e) => (
                  <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={e.title} onPress={() => router.push(`/event/${e.id}`)}>
                    <Photo seed={e.id} uri={e.coverUrl} style={styles.experience} radius={22}>
                      <View style={styles.experienceText}>
                        <T variant="label" color="rgba(255,255,255,0.8)">{e.kind}</T>
                        <T variant="title3" color={colors.white}>{e.title}</T>
                        <T variant="caption" color="rgba(255,255,255,0.8)">{e.area} · {formatINR(e.fromPrice)}</T>
                      </View>
                    </Photo>
                  </Pressable>
                ))}
              </Carousel>
            </View>
          ) : null}

          <View style={{ gap: 14, paddingHorizontal: 20 }}>
            <T variant="title2" accessibilityRole="header">Popular activities</T>
            <View style={styles.actGrid}>
              {h.activities.map((a) => (
                <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={a.name} onPress={() => router.push(`/category/${a.categoryId}`)} style={styles.actTile}>
                  <Photo uri={a.imageUrl} seed={a.id} style={{ height: 64 }} radius={12} />
                  <T variant="captionStrong" style={{ marginTop: 6 }}>{a.name}</T>
                  <T variant="small" color={colors.mutedGrey}>{a.note}</T>
                </Pressable>
              ))}
            </View>
          </View>

          {h.recentlyAdded.length ? (
            <View style={{ gap: 14 }}>
              <SectionHeader title="Recently added" />
              <Carousel>
                {h.recentlyAdded.map((b) => (
                  <Pressable key={b.id} accessibilityRole="button" accessibilityLabel={b.name} onPress={() => router.push(`/business/${b.id}`)} style={{ width: 170, gap: 8 }}>
                    <Photo seed={b.id} uri={b.coverUrl} style={{ height: 120 }} radius={18}>
                      <View style={{ position: 'absolute', left: 10, top: 10, backgroundColor: colors.white, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <T variant="label" style={{ fontSize: 10 }}>New</T>
                      </View>
                    </Photo>
                    <View>
                      <T variant="captionStrong">{b.name}</T>
                      <T variant="small" color={colors.mutedGrey}>{b.categoryLabel.split('·')[0].trim()} · {b.area}</T>
                    </View>
                  </Pressable>
                ))}
              </Carousel>
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.nearBlack, paddingHorizontal: 20, paddingBottom: 22, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, gap: 18 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { fontFamily: fonts.displayHeavy, fontSize: 26, letterSpacing: -1.2, color: colors.pink },
  bill: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: colors.pinkTint, borderWidth: 1.5, borderColor: colors.pink },
  badge: { position: 'absolute', top: 4, right: 4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center' },
  bell: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.darkSurface, alignItems: 'center', justifyContent: 'center' },
  search: { height: 52, borderRadius: 16, backgroundColor: colors.white, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 7 },
  filterBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.nearBlack, alignItems: 'center', justifyContent: 'center' },
  banner: { width: 330, height: 180, borderRadius: 24, overflow: 'hidden', flexDirection: 'row' },
  bannerCta: { marginTop: 'auto', alignSelf: 'flex-start', backgroundColor: colors.white, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  catTile: { width: '22.5%', flexGrow: 1, alignItems: 'center', gap: 8, paddingVertical: 14, borderRadius: 18, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline },
  promo: { backgroundColor: colors.nearBlack, borderRadius: 24, padding: 22, gap: 12 },
  experience: { width: 290, height: 200, justifyContent: 'flex-end' },
  experienceText: { padding: 16, gap: 4, backgroundColor: 'rgba(23,21,27,0.55)' },
  actGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actTile: { width: '31%', flexGrow: 1, padding: 8, borderRadius: radius.md + 2, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline, gap: 2 },
});
