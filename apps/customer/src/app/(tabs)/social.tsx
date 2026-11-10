import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type ReportInput, type SocialActivity, type SocialGroup, type SocialWhen } from '@/api';
import { ReportSheet } from '@/components/ReportSheet';
import { OneOnOneSection } from '@/components/social/OneOnOne';
import { Badge, Button, Chip, EmptyState, ErrorState, Icon, IconButton, LoadingState, Notice, Photo, T } from '@/components/ui';
import { formatTime, relativeDay, startsInLabel } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { errorMessage, useAsync } from '@/lib/useAsync';
import { useSession } from '@/state/session';
import { colors, fonts } from '@/theme/tokens';

const WHEN: { key: SocialWhen; label: string }[] = [
  { key: 'any', label: 'Any time' }, { key: 'hour', label: 'Within an hour' }, { key: 'today', label: 'Today' }, { key: 'week', label: 'This week' },
];
const SECTIONS = ['For you', 'One-on-one', 'Activities', 'Groups', 'Communities', 'Social events'] as const;
type Section = (typeof SECTIONS)[number];
type ReportTarget = { type: ReportInput['targetType']; id: string; name: string; hostId?: string };

export default function Social() {
  const insets = useSafeAreaInsets();
  const { status, area } = useSession();
  const signedIn = status === 'signedIn';
  const [when, setWhen] = useState<SocialWhen>('any');
  const [nearMe, setNearMe] = useState(false);
  const filter = { when: when === 'any' ? undefined : when, nearMe: nearMe || undefined };
  const filtering = when !== 'any' || nearMe;
  const feed = useAsync(() => api.getSocialFeed(filter), [when, nearMe]);
  const [section, setSection] = useState<Section>('For you');
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  const requireSignIn = () => {
    if (signedIn) return true;
    router.push('/login');
    return false;
  };

  const updateActivity = (a: SocialActivity) => feed.setData((f) => f && { ...f, activities: f.activities.map((x) => (x.id === a.id ? a : x)) });
  const updateGroup = (g: SocialGroup) => feed.setData((f) => f && { ...f, groups: f.groups.map((x) => (x.id === g.id ? g : x)) });

  const toggleActivity = async (a: SocialActivity) => {
    if (!requireSignIn()) return;
    setNotice(null);
    try {
      const next = a.myStatus === 'none' ? await api.joinActivity(a.id) : await api.leaveActivity(a.id);
      updateActivity(next);
      if (next.myStatus === 'requested') setNotice({ tone: 'success', text: `Request sent. ${next.hostName} will confirm your place.` });
    } catch (e) {
      setNotice({ tone: 'error', text: errorMessage(e) });
    }
  };
  const joinGroup = async (g: SocialGroup) => {
    if (!requireSignIn()) return;
    try { updateGroup(await api.joinGroup(g.id)); } catch (e) { setNotice({ tone: 'error', text: errorMessage(e) }); }
  };

  const f = feed.data;
  const events = f?.activities.filter((a) => a.section === 'social_event') ?? [];
  const activities = f?.activities.filter((a) => a.section === 'activity') ?? [];
  const featured = events.find((a) => a.featured);
  const groups = f?.groups.filter((g) => g.kind === 'group') ?? [];
  const communities = f?.groups.filter((g) => g.kind === 'community') ?? [];
  const is = (...s: Section[]) => s.includes(section);

  return (
    <View style={{ flex: 1, backgroundColor: colors.nearBlack }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 32, gap: 24 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={feed.loading && !!f} onRefresh={feed.reload} tintColor={colors.pink} />}>
        <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 20, gap: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <T style={styles.logo}>VIBE</T>
              <T style={styles.title} accessibilityRole="header">Social</T>
            </View>
            <IconButton icon="plus" label="Post a one-on-one" tone="pink" onPress={() => setSection('One-on-one')} />
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="tablist">
            {SECTIONS.map((s) => <Chip key={s} label={s} onDark selected={section === s} onPress={() => setSection(s)} />)}
          </ScrollView>
          {!is('Groups', 'Communities') ? (
            <View style={{ gap: 6 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center' }} accessibilityLabel="Filters">
                <Chip label="Near me" icon="pin" onDark selected={nearMe} onPress={() => setNearMe((v) => !v)} />
                <View style={styles.sep} />
                {WHEN.map((w) => <Chip key={w.key} label={w.label} onDark selected={when === w.key} onPress={() => setWhen(w.key)} />)}
              </ScrollView>
              {nearMe ? <T variant="small" color={colors.onDarkMuted}>Near me: within 3 km of {area ?? 'your area'}</T> : null}
            </View>
          ) : null}
        </View>

        {is('For you') ? (
          <Pressable accessibilityRole="button" onPress={() => setSection('One-on-one')}>
            <Photo uri={null} seed="oneonone" style={styles.promo} radius={22}>
              <View style={{ flex: 1, gap: 6 }}>
                <View style={{ flexDirection: 'row', gap: 6 }}><Badge label="New" tone="pink" uppercase /><Badge label="18+" tone="dark" /></View>
                <T variant="title3" color={colors.white}>One-on-one meetups</T>
                <T variant="small" color={colors.onDarkMuted}>Coffee, badminton or a date. Choose who can join: women, men or anyone.</T>
              </View>
              <Icon name="chevronRight" color={colors.white} strokeWidth={2} />
            </Photo>
          </Pressable>
        ) : null}

        {is('For you', 'Activities', 'Groups', 'Communities', 'Social events') ? (
          <Pressable accessibilityRole="link" style={styles.safety}>
            <Icon name="shield" color={colors.pink} />
            <T variant="small" color="rgba(255,255,255,0.86)" style={{ flex: 1 }}>
              Verified hosts, private profiles by default, and Report or Block on every activity and person. <T variant="small" color={colors.white} style={{ fontFamily: fonts.semibold, textDecorationLine: 'underline' }}>Community guidelines</T>
            </T>
          </Pressable>
        ) : null}

        {notice ? <View style={{ paddingHorizontal: 20 }}><Notice tone={notice.tone}><T variant="caption">{notice.text}</T></Notice></View> : null}

        {is('One-on-one') ? (
          <OneOnOneSection filter={filter} signedIn={signedIn} onRequireSignIn={() => router.push('/login')} onReport={setReporting} />
        ) : null}

        {feed.error && !is('One-on-one') ? <ErrorState message={feed.error} onRetry={feed.reload} /> : null}
        {!f && !feed.error && !is('One-on-one') ? <LoadingState rows={2} dark /> : null}

        {f && is('For you', 'Social events') && featured ? (
          <View style={{ gap: 12 }}>
            <T variant="title2" color={colors.white} style={{ paddingHorizontal: 20 }}>Happening this week</T>
            <Photo uri={featured.coverUrl} seed={featured.id} style={styles.featured} radius={26}>
              <View style={{ position: 'absolute', right: 12, top: 12 }}>
                <IconButton icon="flag" label={`Report ${featured.title}`} tone="dark" size={40} onPress={() => setReporting({ type: 'activity', id: featured.id, name: featured.title, hostId: featured.hostId })} />
              </View>
              <View style={styles.featuredText}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Badge label={featured.kind} tone="pink" uppercase />
                  {featured.approvalRequired ? <Badge label="Approval needed" tone="dark" /> : null}
                </View>
                <T variant="title2" color={colors.white}>{featured.title}</T>
                <T variant="caption" color={colors.onDarkMuted}>
                  {relativeDay(featured.startsAt)} · {formatTime(featured.startsAt)} · {featured.area} · {featured.distanceKm} km{featured.price ? ` · ${formatINR(featured.price)}` : ''}
                </T>
                <View style={styles.between}>
                  <T variant="small" color={colors.onDarkMuted}>{featured.going} of {featured.capacity} places taken</T>
                  <JoinButton a={featured} onPress={() => toggleActivity(featured)} />
                </View>
              </View>
            </Photo>
          </View>
        ) : null}

        {f && is('For you', 'Activities') ? (
          <ActivityList filtering={filtering} onClear={() => { setWhen('any'); setNearMe(false); }} title={filtering ? 'Activities' : 'Activities near you'} items={activities} onJoin={toggleActivity} onReport={(a) => setReporting({ type: 'activity', id: a.id, name: a.title, hostId: a.hostId })} />
        ) : null}

        {f && is('Social events') ? (
          <ActivityList filtering={filtering} onClear={() => { setWhen('any'); setNearMe(false); }} title="Hosted social events" items={events.filter((e) => !e.featured && !e.requiresIdVerification)} onJoin={toggleActivity} onReport={(a) => setReporting({ type: 'activity', id: a.id, name: a.title, hostId: a.hostId })} />
        ) : null}

        {f && (is('Groups') || (is('For you') && !filtering)) ? <GroupRow title="Groups for you" items={groups} onJoin={joinGroup} /> : null}
        {f && (is('Communities') || (is('For you') && !filtering)) ? <GroupRow title="Communities" items={communities} onJoin={joinGroup} /> : null}

        {f && is('For you', 'Social events') ? events.filter((a) => a.ageRange || a.requiresIdVerification).map((a) => (
          <View key={a.id} style={styles.restricted}>
            <Photo uri={a.coverUrl} seed={a.id} style={{ height: 110 }} radius={16} scrim={0.2} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {a.ageRange ? <Badge label={`${a.ageRange.min}+ only`} tone="pink" uppercase /> : null}
              {a.requiresIdVerification ? <Badge label="ID verified" tone="dark" /> : null}
              {a.hostVerified ? <Badge label={`Hosted by ${a.hostName}`} tone="dark" /> : null}
            </View>
            <T variant="title3" color={colors.white}>{a.title}</T>
            <T variant="caption" color={colors.onDarkMuted}>
              {relativeDay(a.startsAt)} · {formatTime(a.startsAt)} · {a.area}. Matches are shared only if both of you say yes. Contact details stay hidden.
            </T>
            <Button
              label={a.requiresIdVerification ? 'Verify age to book' : 'Request a place'}
              variant="light"
              size="md"
              style={{ alignSelf: 'flex-start' }}
              onPress={() => (a.requiresIdVerification ? setNotice({ tone: 'error', text: 'ID verification needs a KYC provider and isn’t connected yet. This event can’t be booked in the app until it is.' }) : toggleActivity(a))}
            />
          </View>
        )) : null}
      </ScrollView>

      <ReportSheet target={reporting} onClose={() => setReporting(null)} />
    </View>
  );
}

function ActivityList({ title, items, onJoin, onReport, filtering, onClear }: { title: string; items: SocialActivity[]; onJoin: (a: SocialActivity) => void; onReport: (a: SocialActivity) => void; filtering: boolean; onClear: () => void }) {
  return (
    <View style={{ paddingHorizontal: 20, gap: 12 }}>
      <T variant="title2" color={colors.white}>{title}</T>
      {items.length === 0 ? (
        filtering
          ? <EmptyState dark icon="calendar" title="Nothing matches these filters" message="Try Today or This week, or turn off Near me." actionLabel="Clear filters" onAction={onClear} />
          : <EmptyState dark icon="social" title="Nothing here yet" message="Check back soon, or host your own." />
      ) : null}
      {items.map((a) => (
        <View key={a.id} style={styles.activity}>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Photo uri={a.coverUrl} seed={a.id} style={{ width: 76, height: 76 }} radius={14} />
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <T variant="label" color={colors.onDarkMuted}>{a.kind}</T>
                {startsInLabel(a.startsAt) ? <Badge label={startsInLabel(a.startsAt)!} tone="warning" /> : null}
              </View>
              <T variant="bodyStrong" color={colors.white}>{a.title}</T>
              <T variant="small" color={colors.onDarkMuted}>{relativeDay(a.startsAt)} · {formatTime(a.startsAt)} · {a.place}</T>
              <T variant="small" color={colors.onDarkMuted}>{a.distanceKm} km · {a.price ? formatINR(a.price) : 'Free'} · {a.going} going</T>
            </View>
            <IconButton icon="flag" label={`Report ${a.title}`} tone="clear" size={36} color={colors.onDarkSubtle} onPress={() => onReport(a)} />
          </View>
          <View style={styles.between}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
              {a.hostVerified ? <Icon name="shield" size={14} color={colors.pink} strokeWidth={2.2} /> : null}
              <T variant="small" color={colors.onDarkMuted} numberOfLines={1}>Hosted by {a.hostName}</T>
            </View>
            <JoinButton a={a} onPress={() => onJoin(a)} />
          </View>
        </View>
      ))}
    </View>
  );
}

function GroupRow({ title, items, onJoin }: { title: string; items: SocialGroup[]; onJoin: (g: SocialGroup) => void }) {
  return (
    <View style={{ gap: 12 }}>
      <T variant="title2" color={colors.white} style={{ paddingHorizontal: 20 }}>{title}</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 20 }}>
        {items.map((g) => (
          <View key={g.id} style={styles.group}>
            <Photo uri={g.coverUrl} seed={g.id} style={{ height: 96 }} />
            <View style={{ padding: 12, gap: 3 }}>
              <T variant="captionStrong" color={colors.white}>{g.name}</T>
              <T variant="small" color={colors.onDarkMuted}>{g.description} · {g.memberCount.toLocaleString('en-IN')} members</T>
              <Pressable accessibilityRole="button" disabled={g.myStatus !== 'none'} onPress={() => onJoin(g)} style={{ marginTop: 6 }} hitSlop={8}>
                <T variant="captionStrong" color={g.myStatus === 'none' ? colors.white : colors.onDarkMuted} style={g.myStatus === 'none' ? { textDecorationLine: 'underline' } : undefined}>
                  {g.myStatus === 'joined' ? 'Joined ✓' : g.myStatus === 'requested' ? 'Requested' : g.privacy === 'private' ? 'Private · Request' : 'Public · Join'}
                </T>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function JoinButton({ a, onPress }: { a: SocialActivity; onPress: () => void }) {
  const label = a.myStatus === 'joined' ? 'Joined ✓' : a.myStatus === 'requested' ? 'Requested' : a.approvalRequired ? 'Request to join' : a.price ? 'Book a place' : 'Join';
  const full = a.myStatus === 'none' && a.going >= a.capacity;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${full ? 'Full' : label}: ${a.title}`}
      accessibilityHint={a.myStatus !== 'none' ? 'Tap to leave' : undefined}
      disabled={full}
      onPress={onPress}
      style={[styles.join, a.myStatus !== 'none' ? styles.joinDone : null, full && { opacity: 0.5 }]}>
      <T variant="captionStrong" color={colors.white}>{full ? 'Full' : label}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  logo: { fontFamily: fonts.displayHeavy, fontSize: 26, letterSpacing: -1.2, color: colors.pink },
  title: { fontFamily: fonts.displaySemi, fontSize: 24, letterSpacing: -0.5, color: colors.white },
  sep: { width: 1, height: 22, backgroundColor: colors.darkSurface },
  promo: { marginHorizontal: 20, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: colors.pink },
  safety: { marginHorizontal: 20, padding: 14, borderRadius: 16, backgroundColor: colors.darkSurface, flexDirection: 'row', alignItems: 'center', gap: 12 },
  featured: { marginHorizontal: 20, height: 260, justifyContent: 'flex-end' },
  featuredText: { padding: 18, gap: 8, backgroundColor: 'rgba(23,21,27,0.72)' },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  activity: { padding: 14, borderRadius: 20, backgroundColor: colors.darkSurface, gap: 12 },
  join: { height: 38, paddingHorizontal: 14, borderRadius: 999, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center' },
  joinDone: { backgroundColor: 'transparent', borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  group: { width: 180, borderRadius: 20, backgroundColor: colors.darkSurface, overflow: 'hidden' },
  restricted: { marginHorizontal: 20, padding: 14, borderRadius: 22, borderWidth: 1.5, borderColor: colors.pink, gap: 10 },
});
