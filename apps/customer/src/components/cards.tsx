import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import type { BusinessSummary, EventSummary, OfferSummary } from '@/api';
import { dateBadge, daysUntil, formatDay, formatTime } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { colors, fonts, radius } from '@/theme/tokens';

import { Badge, Icon, Photo, T } from './ui';

export function Rating({ value, onDark }: { value: number; onDark?: boolean }) {
  return (
    <View style={styles.rating} accessibilityLabel={`Rated ${value.toFixed(1)} out of 5`}>
      <Icon name="star" size={13} color={colors.pink} filled />
      <T variant="captionStrong" color={onDark ? colors.white : colors.nearBlack}>{value.toFixed(1)}</T>
    </View>
  );
}

const statusColor = { success: colors.success, warning: colors.warning, muted: colors.mutedGrey };

/** Horizontal carousel card (Home → Trending). */
export function BusinessTile({ b, width = 250 }: { b: BusinessSummary; width?: number }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${b.name}, ${b.categoryLabel}, ${b.area}`} onPress={() => router.push(`/business/${b.id}`)} style={[styles.card, { width }]}>
      <Photo uri={b.coverUrl} seed={b.id} style={{ height: 150 }}>
        {b.offerBadge ? <View style={styles.topLeft}><Badge label={b.offerBadge} tone="pink" /></View> : null}
      </Photo>
      <View style={styles.body}>
        <View style={styles.between}>
          <T variant="headline" numberOfLines={1} style={{ flex: 1 }}>{b.name}</T>
          <Rating value={b.rating} />
        </View>
        <T variant="caption" color={colors.mutedGrey} numberOfLines={1}>{b.categoryLabel} · {b.distanceKm} km</T>
      </View>
    </Pressable>
  );
}

/** Large list card (Category listing). */
export function BusinessCard({ b }: { b: BusinessSummary }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${b.name}, ${b.categoryLabel}`} onPress={() => router.push(`/business/${b.id}`)} style={[styles.card, { borderRadius: 22 }]}>
      <Photo uri={b.coverUrl} seed={b.id} style={{ height: 156 }}>
        {b.offerBadge ? <View style={styles.topLeft}><Badge label={b.offerBadge} tone="pink" /></View> : null}
        {b.isNew ? <View style={styles.topRight}><Badge label="NEW" tone="white" /></View> : null}
      </Photo>
      <View style={[styles.body, { paddingHorizontal: 16, gap: 5 }]}>
        <View style={styles.between}>
          <T variant="title3" numberOfLines={1} style={{ flex: 1 }}>{b.name}</T>
          <Rating value={b.rating} />
        </View>
        <T variant="caption" color={colors.mutedGrey}>{b.categoryLabel} · {b.area}</T>
        <View style={styles.row}>
          {b.costForTwo ? <T variant="captionStrong">{formatINR(b.costForTwo)} for two</T> : null}
          <T variant="caption" color={colors.mutedGrey}>{b.distanceKm} km</T>
          <T variant="captionStrong" color={statusColor[b.status.tone]}>{b.status.label}</T>
        </View>
      </View>
    </Pressable>
  );
}

/** Compact row (Discover results, Home → Nearby). */
export function BusinessRow({ b }: { b: BusinessSummary }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${b.name}, ${b.distanceKm} kilometres`} onPress={() => router.push(`/business/${b.id}`)} style={[styles.card, styles.rowCard]}>
      <Photo uri={b.coverUrl} seed={b.id} style={{ width: 88, height: 96 }} radius={14} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.between}>
          <T variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{b.name}</T>
          <T variant="small" color={colors.mutedGrey}>{b.distanceKm} km</T>
        </View>
        <T variant="caption" color={colors.mutedGrey} numberOfLines={1}>{b.categoryLabel}</T>
        <View style={styles.row}>
          <Rating value={b.rating} />
          <T variant="small" color={colors.mutedGrey}>({b.reviewCount.toLocaleString('en-IN')})</T>
          <T variant="small" color={statusColor[b.status.tone]} style={{ fontFamily: fonts.semibold }}>{b.status.label}</T>
        </View>
        {b.offerBadge ? <Badge label={b.offerBadge} /> : null}
      </View>
    </Pressable>
  );
}

export function OfferCard({ o, width = 280 }: { o: OfferSummary; width?: number | '100%' }) {
  const days = daysUntil(o.endsAt);
  const ending = days <= 7;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${o.headline} ${o.headlineSub}: ${o.title} at ${o.businessName}`} onPress={() => router.push(`/offer/${o.id}`)} style={[styles.card, styles.offer, { width }]}>
      <View style={styles.offerLeft}>
        <T style={styles.offerBig}>{o.headline}</T>
        <T variant="label" color={colors.pinkDeep}>{o.headlineSub}</T>
      </View>
      <View style={{ flex: 1, padding: 14, gap: 4 }}>
        <T variant="bodyStrong" numberOfLines={2}>{o.title}</T>
        <T variant="caption" color={colors.mutedGrey} numberOfLines={1}>{o.businessName}</T>
        <T variant="small" color={ending ? colors.warning : o.memberOnly ? colors.pinkDeep : colors.mutedGrey} style={{ fontFamily: fonts.semibold }}>
          {ending ? `Ends in ${days} day${days === 1 ? '' : 's'}` : o.memberOnly ? 'Members only' : o.scheduleLabel}
        </T>
      </View>
    </Pressable>
  );
}

export function EventTile({ e, width = 250 }: { e: EventSummary; width?: number }) {
  const d = dateBadge(e.startsAt);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${e.title}, ${formatDay(e.startsAt)}`} onPress={() => router.push(`/event/${e.id}`)} style={[styles.card, { width }]}>
      <Photo uri={e.coverUrl} seed={e.id} style={{ height: 140 }}>
        <View style={[styles.topLeft, styles.dateBadge]}>
          <T variant="label" color={colors.pinkDeep} style={{ fontSize: 10 }}>{d.mon}</T>
          <T style={{ fontFamily: fonts.display, fontSize: 19, lineHeight: 21, color: colors.nearBlack }}>{d.day}</T>
        </View>
      </Photo>
      <View style={styles.body}>
        <T variant="headline" numberOfLines={1}>{e.title}</T>
        <T variant="caption" color={colors.mutedGrey} numberOfLines={1}>{formatDay(e.startsAt).split(',')[0]} · {formatTime(e.startsAt)} · {e.area}</T>
        <T variant="captionStrong">{e.soldOut ? 'Sold out' : `From ${formatINR(e.fromPrice)}`}</T>
      </View>
    </Pressable>
  );
}

export function EventRow({ e }: { e: EventSummary }) {
  const d = dateBadge(e.startsAt);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${e.title}, ${formatDay(e.startsAt)}, ${e.venue}`} onPress={() => router.push(`/event/${e.id}`)} style={[styles.card, styles.rowCard]}>
      <Photo uri={e.coverUrl} seed={e.id} style={{ width: 84, height: 100 }} radius={14}>
        <View style={[styles.dateBadge, { position: 'absolute', left: 8, top: 8, width: 40, height: 44 }]}>
          <T variant="label" color={colors.pinkDeep} style={{ fontSize: 9 }}>{d.mon}</T>
          <T style={{ fontFamily: fonts.display, fontSize: 16, lineHeight: 18, color: colors.nearBlack }}>{d.day}</T>
        </View>
      </Photo>
      <View style={{ flex: 1, gap: 4 }}>
        <T variant="label" color={colors.mutedGrey}>{e.kind}</T>
        <T variant="bodyStrong" numberOfLines={1}>{e.title}</T>
        <T variant="small" color={colors.mutedGrey} numberOfLines={1}>{formatDay(e.startsAt).split(',')[0]} · {formatTime(e.startsAt)} · {e.venue}, {e.area}</T>
        <View style={[styles.between, { marginTop: 'auto' }]}>
          <T variant="captionStrong">{e.soldOut ? 'Sold out' : `From ${formatINR(e.fromPrice)}`}</T>
          {e.tag ? <Badge label={e.tag.label} tone={e.tag.tone === 'muted' ? 'muted' : e.tag.tone} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.white, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline, overflow: 'hidden' },
  body: { padding: 14, paddingTop: 12, gap: 4 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  topLeft: { position: 'absolute', left: 12, top: 12 },
  topRight: { position: 'absolute', right: 12, top: 12 },
  rowCard: { flexDirection: 'row', gap: 12, padding: 12, alignItems: 'stretch' },
  offer: { flexDirection: 'row' },
  offerLeft: { width: 88, backgroundColor: colors.pinkTint, alignItems: 'center', justifyContent: 'center', gap: 2 },
  offerBig: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.pinkDeep },
  dateBadge: { width: 48, height: 52, borderRadius: 12, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center' },
});
