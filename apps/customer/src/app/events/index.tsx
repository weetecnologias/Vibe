import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { api, type EventKind } from '@/api';
import { EventRow } from '@/components/cards';
import { Badge, Chip, EmptyState, ErrorState, Icon, IconButton, LoadingState, Photo, Screen, T, TopBar } from '@/components/ui';
import { formatDay, formatTime, istDayKey } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { useAsync } from '@/lib/useAsync';
import { useSession } from '@/state/session';
import { colors, fonts } from '@/theme/tokens';

const KINDS: (EventKind | 'All')[] = ['All', 'Workshops', 'Live Events', 'Tours', 'Meetups', 'Experiences'];

function nextDays(n: number) {
  const out: { key: string; dow: string; day: string }[] = [];
  for (let i = 0; i < n; i++) {
    const iso = new Date(Date.now() + i * 86_400_000).toISOString();
    const label = formatDay(iso); // "Mon, 9 Nov"
    out.push({ key: istDayKey(iso), dow: i === 0 ? 'Today' : label.slice(0, 3), day: label.split(' ')[1] });
  }
  return out;
}

export default function Events() {
  const { status } = useSession();
  const [kind, setKind] = useState<EventKind | 'All'>('All');
  const [day, setDay] = useState<string | null>(null);
  const days = useMemo(() => nextDays(14), []);
  const list = useAsync(() => api.getEvents({ kind: kind === 'All' ? undefined : kind, day: day ?? undefined }), [kind, day]);
  const mine = useAsync(() => (status === 'signedIn' ? api.getMyTickets() : Promise.resolve([])), [status]);
  const featured = list.data?.find((e) => e.featured && !e.soldOut);
  const upcoming = mine.data?.find((t) => t.status === 'valid');

  return (
    <Screen>
      <TopBar title="Events" right={<IconButton icon="search" label="Search events" onPress={() => router.push('/discover')} />} />

      {upcoming ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/tickets')} style={styles.mine}>
          <View style={styles.mineIcon}><Icon name="ticket" size={20} color={colors.white} /></View>
          <View style={{ flex: 1 }}>
            <T variant="captionStrong" color={colors.white}>Your ticket: {upcoming.eventTitle}</T>
            <T variant="small" color={colors.onDarkMuted}>{formatDay(upcoming.startsAt)} · {upcoming.of} × {upcoming.typeName}</T>
          </View>
          <Icon name="chevronRight" size={18} color={colors.white} strokeWidth={2} />
        </Pressable>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {KINDS.map((k) => <Chip key={k} label={k} selected={kind === k} onPress={() => setKind(k)} />)}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.row, { paddingTop: 12 }]}>
        <DayBtn on={day === null} top="Any" bottom="day" onPress={() => setDay(null)} />
        {days.map((d) => <DayBtn key={d.key} on={day === d.key} top={d.dow} bottom={d.day} onPress={() => setDay(d.key)} />)}
      </ScrollView>

      <View style={{ paddingHorizontal: 20, gap: 12, marginTop: 20 }}>
        {featured && kind === 'All' && !day ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Featured: ${featured.title}`} onPress={() => router.push(`/event/${featured.id}`)}>
            <Photo seed={featured.id} uri={featured.coverUrl} style={{ height: 290, justifyContent: 'flex-end' }} radius={26}>
              <View style={styles.featTop}><Badge label="Featured" tone="white" uppercase />{featured.tag ? <Badge label={featured.tag.label} tone="warning" /> : null}</View>
              <View style={styles.featText}>
                <T variant="label" color="rgba(255,255,255,0.85)">{featured.kind} · {formatDay(featured.startsAt)} · {formatTime(featured.startsAt)}</T>
                <T variant="title1" color={colors.white}>{featured.title}</T>
                <T variant="caption" color="rgba(255,255,255,0.85)">{featured.venue}, {featured.area}</T>
                <View style={styles.featFoot}>
                  <T variant="bodyStrong" color={colors.white}>From {formatINR(featured.fromPrice)}</T>
                  <View style={styles.getBtn}><T variant="captionStrong" color={colors.white}>Get tickets</T></View>
                </View>
              </View>
            </Photo>
          </Pressable>
        ) : null}

        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 8 }}>
          <T variant="title2" accessibilityRole="header">{day ? 'On this day' : 'Coming up'}</T>
          <T variant="small" color={colors.mutedGrey}>{list.data?.length ?? 0} events</T>
        </View>
        {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : null}
        {list.loading && !list.data ? <LoadingState rows={2} /> : null}
        {list.data && list.data.length === 0 ? <EmptyState icon="calendar" title="No events on this day" message="Try another date or category." /> : null}
        {list.data?.map((e) => <EventRow key={e.id} e={e} />)}

        <View style={styles.host}>
          <View style={{ flex: 1 }}>
            <T variant="captionStrong">Hosting an event in Hyderabad?</T>
            <T variant="small" color={colors.mutedGrey}>List it on VIBE. Every event is reviewed before it goes live.</T>
          </View>
        </View>
      </View>
    </Screen>
  );
}

function DayBtn({ on, top, bottom, onPress }: { on: boolean; top: string; bottom: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} aria-selected={on} accessibilityLabel={`${top} ${bottom}`} onPress={onPress} style={[styles.day, on && { backgroundColor: colors.pink, borderColor: colors.pink }]}>
      <T variant="small" color={on ? colors.white : colors.mutedGrey} style={{ fontFamily: fonts.semibold, fontSize: 11 }}>{top}</T>
      <T style={{ fontFamily: fonts.display, fontSize: 17, color: on ? colors.white : colors.nearBlack }}>{bottom}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingHorizontal: 20 },
  mine: { marginHorizontal: 20, marginBottom: 14, padding: 12, borderRadius: 18, backgroundColor: colors.nearBlack, flexDirection: 'row', alignItems: 'center', gap: 12 },
  mineIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center' },
  day: { width: 54, height: 64, borderRadius: 16, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center', gap: 2 },
  featTop: { position: 'absolute', top: 16, left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  featText: { padding: 20, gap: 6, backgroundColor: 'rgba(23,21,27,0.6)' },
  featFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  getBtn: { backgroundColor: colors.pink, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10 },
  host: { marginTop: 8, padding: 16, borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed', borderColor: colors.mutedGrey, flexDirection: 'row' },
});
