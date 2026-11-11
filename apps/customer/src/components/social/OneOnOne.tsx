import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  api, type Gender, type MeetPreference, type MemberCard, type MeetReservation, type OneOnOneInput, type OneOnOneInvite, type OneOnOneKind, type SocialFilter, type SocialProfile,
} from '@/api';
import { istAt, formatTime, relativeDay, startsInLabel } from '@/lib/dates';
import { formatINR } from '@/lib/money';
import { errorMessage, useAsync } from '@/lib/useAsync';
import { colors, fonts, radius } from '@/theme/tokens';

import { MatchChat } from './MatchChat';
import { Badge, Button, Chip, EmptyState, ErrorState, Icon, IconButton, LoadingState, Notice, Photo, T, type IconName } from '../ui';

// ---------- labels ----------
const GENDERS: { key: Gender; label: string }[] = [
  { key: 'woman', label: 'Woman' }, { key: 'man', label: 'Man' }, { key: 'nonbinary', label: 'Non-binary' }, { key: 'undisclosed', label: 'Prefer not to say' },
];
const PREFS: { key: MeetPreference; label: string; hint: string }[] = [
  { key: 'anyone', label: 'Anyone', hint: 'Open to everyone' },
  { key: 'women', label: 'Women', hint: 'Only women' },
  { key: 'men', label: 'Men', hint: 'Only men' },
];
const AGE_BANDS = ['18–24', '25–29', '30–34', '35–39', '40+'];
export const KINDS: { key: OneOnOneKind; label: string; icon: IconName; example: string }[] = [
  { key: 'coffee', label: 'Coffee & chat', icon: 'food', example: 'Coffee & conversation' },
  { key: 'sport', label: 'Sports partner', icon: 'fitness', example: 'Shuttle badminton · singles' },
  { key: 'food', label: 'Meal for two', icon: 'food', example: 'Dinner for two' },
  { key: 'movie', label: 'Movie date', icon: 'film', example: 'Movie night, two seats' },
];
const openToLabel = (p: MeetPreference) => (p === 'anyone' ? 'Open to anyone' : p === 'women' ? 'Women only' : 'Men only');
const kindIcon = (k: OneOnOneKind) => KINDS.find((x) => x.key === k)?.icon ?? 'social';

/** Which kind of VIBE business suits each activity. Places come only from the app's own listings. */
const KIND_CATEGORY: Record<OneOnOneKind, string> = { coffee: 'food.cafes', sport: 'fitness.sports', food: 'food.restaurants', movie: 'movies.cinemas' };

// ---------- small pieces ----------
function Avatar({ m, size = 40 }: { m: MemberCard; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]} accessibilityElementsHidden aria-hidden>
      <T variant="captionStrong" color={colors.white} style={{ fontSize: size * 0.38 }}>{m.firstName[0]}</T>
    </View>
  );
}

function Who({ m }: { m: MemberCard }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
      <Avatar m={m} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <T variant="bodyStrong" color={colors.white}>{m.firstName}{m.ageBand ? `, ${m.ageBand}` : ''}</T>
          {m.verified ? <Icon name="shield" size={14} color={colors.pink} strokeWidth={2.2} /> : null}
        </View>
        <T variant="small" color={colors.onDarkMuted}>{m.verified ? 'Phone verified' : 'Not yet verified'}</T>
      </View>
    </View>
  );
}

function Segmented<K extends string>({ options, value, onChange, label }: { options: { key: K; label: string }[]; value: K | null; onChange: (k: K) => void; label: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = value === o.key;
        return (
          <Pressable key={o.key} accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} onPress={() => onChange(o.key)}
            style={[styles.seg, on && styles.segOn]}>
            <T variant="captionStrong" color={colors.white}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.grab} />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <T variant="title2" color={colors.white} style={{ flex: 1 }} accessibilityRole="header">{title}</T>
          <IconButton icon="close" label="Close" tone="dark" size={40} onPress={onClose} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16, paddingBottom: 8 }}>{children}</ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------- profile setup ----------
function ProfileSheet({ visible, initial, onClose, onSaved }: { visible: boolean; initial: SocialProfile | null; onClose: () => void; onSaved: (p: SocialProfile) => void }) {
  const [gender, setGender] = useState<Gender | null>(initial?.gender ?? null);
  const [pref, setPref] = useState<MeetPreference>(initial?.meetPreference ?? 'anyone');
  const [band, setBand] = useState<string | null>(initial?.ageBand ?? null);
  const [adult, setAdult] = useState(initial?.ageConfirmed18 ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !!gender && !!band && adult;

  const save = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.saveSocialProfile({ gender: gender!, meetPreference: pref, ageBand: band, ageConfirmed18: adult }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Your one-on-one profile">
      <T variant="caption" color={colors.onDarkMuted}>
        Used only to match invites. Other members see your first name and age range, never your phone number, surname or exact age.
      </T>
      <View style={{ gap: 8 }}>
        <T variant="label" color={colors.onDarkMuted}>I am</T>
        <Segmented label="I am" options={GENDERS} value={gender} onChange={setGender} />
      </View>
      <View style={{ gap: 8 }}>
        <T variant="label" color={colors.onDarkMuted}>I’d like to meet</T>
        <Segmented label="I'd like to meet" options={PREFS} value={pref} onChange={setPref} />
        {gender === 'undisclosed' || gender === 'nonbinary' ? (
          <T variant="small" color={colors.onDarkMuted}>You’ll see invites that are open to anyone.</T>
        ) : null}
      </View>
      <View style={{ gap: 8 }}>
        <T variant="label" color={colors.onDarkMuted}>Age range</T>
        <Segmented label="Age range" options={AGE_BANDS.map((b) => ({ key: b, label: b }))} value={band} onChange={setBand} />
      </View>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: adult }} aria-checked={adult} onPress={() => setAdult((a) => !a)} style={styles.checkRow}>
        <View style={[styles.box, adult && { backgroundColor: colors.pink, borderColor: colors.pink }]}>{adult ? <Icon name="check" size={14} color={colors.white} strokeWidth={3} /> : null}</View>
        <T variant="caption" color={colors.white} style={{ flex: 1 }}>I confirm I’m 18 or older and agree to the community guidelines.</T>
      </Pressable>
      <Notice tone="warning" icon="info">
        <T variant="small">Age is self-declared for now. ID verification will be added once a KYC provider is connected.</T>
      </Notice>
      {error ? <Notice tone="error"><T variant="caption">{error}</T></Notice> : null}
      <Button label="Save and continue" onPress={save} disabled={!ready} loading={busy} />
    </Sheet>
  );
}

// ---------- post an invite ----------
function slots(now = Date.now()) {
  const out: { iso: string; label: string }[] = [];
  const plan: [number, number][] = [[0, 18], [0, 20], [1, 7], [1, 13], [1, 18], [2, 7], [2, 18], [3, 10], [4, 17]];
  for (const [d, h] of plan) {
    const iso = istAt(d, h, 0, now);
    if (Date.parse(iso) > now + 45 * 60_000) out.push({ iso, label: `${relativeDay(iso, now)} · ${formatTime(iso)}` });
  }
  return out.slice(0, 6);
}

function PostSheet({ visible, onClose, onPosted }: { visible: boolean; onClose: () => void; onPosted: (i: OneOnOneInvite) => void }) {
  const [kind, setKind] = useState<OneOnOneKind>('coffee');
  const [activity, setActivity] = useState('');
  const [venue, setVenue] = useState<{ name: string; area: string; businessId: string } | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [openTo, setOpenTo] = useState<MeetPreference>('anyone');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const times = useMemo(() => slots(), [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const venues = useAsync(async () => {
    const list = await api.searchBusinesses({ categoryId: KIND_CATEGORY[kind], sort: 'nearest' });
    return list.slice(0, 8).map((b) => ({ name: b.name, area: b.area, businessId: b.id }));
  }, [kind]);

  const pickKind = (k: OneOnOneKind) => { setKind(k); setVenue(null); };
  const label = activity.trim() || KINDS.find((k) => k.key === kind)!.example;

  const post = async () => {
    if (!venue || !slot) return;
    setBusy(true);
    setError(null);
    const input: OneOnOneInput = { kind, activity: label, venueBusinessId: venue.businessId, startsAt: slot, openTo, note: note.trim() || undefined };
    try {
      onPosted(await api.createOneOnOne(input));
      setActivity(''); setVenue(null); setSlot(null); setNote('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Post a one-on-one">
      <View style={{ gap: 8 }}>
        <T variant="label" color={colors.onDarkMuted}>What’s the plan?</T>
        <Segmented label="Activity" options={KINDS} value={kind} onChange={pickKind} />
        <TextInput
          value={activity}
          onChangeText={setActivity}
          placeholder={KINDS.find((k) => k.key === kind)!.example}
          placeholderTextColor={colors.onDarkSubtle}
          maxLength={60}
          accessibilityLabel="Describe the plan"
          style={styles.input}
        />
      </View>
      <View style={{ gap: 8 }}>
        <T variant="label" color={colors.onDarkMuted}>Where · VIBE recommended places</T>
        {venues.loading && !venues.data ? <T variant="small" color={colors.onDarkMuted}>Finding places…</T> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {venues.data?.map((v) => (
            <Chip key={v.name} label={`${v.name} · ${v.area}`} onDark selected={venue?.name === v.name} onPress={() => setVenue(v)} />
          ))}
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <T variant="label" color={colors.onDarkMuted}>When</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {times.map((t) => <Chip key={t.iso} label={t.label} onDark selected={slot === t.iso} onPress={() => setSlot(t.iso)} />)}
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <T variant="label" color={colors.onDarkMuted}>Who can join</T>
        <Segmented label="Who can join" options={PREFS} value={openTo} onChange={setOpenTo} />
        <T variant="small" color={colors.onDarkMuted}>{PREFS.find((p) => p.key === openTo)!.hint}. Only people who match will see this invite.</T>
      </View>
      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Add a short note (optional)"
        placeholderTextColor={colors.onDarkSubtle}
        maxLength={140}
        multiline
        accessibilityLabel="Note"
        style={[styles.input, { minHeight: 64, textAlignVertical: 'top', paddingTop: 12 }]}
      />
      {error ? <Notice tone="error"><T variant="caption">{error}</T></Notice> : null}
      <Button label="Post invite" onPress={post} disabled={!venue || !slot} loading={busy} />
    </Sheet>
  );
}

// ---------- reserve the venue ----------
const reservationIcon = (k: MeetReservation['kind']): IconName => (k === 'movie' ? 'film' : k === 'slot' ? 'fitness' : 'food');

/** Offered right after posting, and any time from the host's own plan. Paying locks the spot and is shared in the chat. */
function ReserveSheet({ invite, onClose }: { invite: OneOnOneInvite | null; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opt = invite?.reservationOption ?? null;
  if (!invite || !opt) return <Sheet visible={false} onClose={onClose} title="Reserve your spot">{null}</Sheet>;

  const go = async () => {
    setError(null);
    if (opt.kind === 'movie') {
      onClose();
      router.push(`/cinema/${invite.venueBusinessId}?meet=${invite.id}`);
      return;
    }
    setBusy(true);
    try {
      const { paymentRequestId } = await api.reserveMeetVenue(invite.id);
      onClose();
      router.push(`/checkout/${paymentRequestId}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible onClose={onClose} title="Reserve your spot">
      <View style={styles.reserveCard}>
        <View style={styles.reserveIcon}><Icon name={reservationIcon(opt.kind)} size={22} color={colors.white} /></View>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="headline" color={colors.white}>{opt.title}</T>
          <T variant="small" color={colors.onDarkMuted}>{invite.venueName}, {invite.area} · {relativeDay(invite.startsAt)} {formatTime(invite.startsAt)}</T>
        </View>
        {opt.fee !== null ? <T variant="title3" color={colors.white}>{formatINR(opt.fee)}</T> : null}
      </View>
      <T variant="caption" color={colors.onDarkMuted}>{opt.description}</T>
      <View style={{ gap: 8 }}>
        {[
          'Your spot is held, so you’re not left waiting or turned away.',
          'It shows as Reserved on your invite, so people can see you’re serious.',
          'The details are shared in your chat once you’re matched.',
        ].map((t) => (
          <View key={t} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <Icon name="check" size={15} color={colors.pink} strokeWidth={2.6} />
            <T variant="small" color="rgba(255,255,255,0.86)" style={{ flex: 1 }}>{t}</T>
          </View>
        ))}
      </View>
      <Notice tone="warning" icon="info"><T variant="small">{opt.policy}</T></Notice>
      {error ? <Notice tone="error"><T variant="caption">{error}</T></Notice> : null}
      <Button label={opt.kind === 'movie' ? 'Choose film and seats' : `Reserve for ${formatINR(opt.fee ?? 0)}`} icon={opt.kind === 'movie' ? 'film' : 'lock'} loading={busy} onPress={go} />
      <Button label="Not now" variant="outline" onPress={onClose} />
    </Sheet>
  );
}

/** Asked before a host cancels a plan they have already paid to reserve. */
function CancelReservedSheet({ invite, onClose, onConfirm }: { invite: OneOnOneInvite | null; onClose: () => void; onConfirm: () => void }) {
  const res = invite?.reservation ?? null;
  return (
    <Sheet visible={!!invite && !!res} onClose={onClose} title="Cancel a reserved plan?">
      <T variant="caption" color={colors.onDarkMuted}>
        You’ve reserved {res?.title.toLowerCase()} at {invite?.venueName}. {res?.policy}
      </T>
      <Button label="Keep my plan" onPress={onClose} />
      <Button label="Cancel anyway" variant="outline" onPress={onConfirm} />
    </Sheet>
  );
}

function ReservationCard({ r, mine }: { r: MeetReservation; mine: boolean }) {
  return (
    <View style={styles.booked}>
      <Icon name={reservationIcon(r.kind)} size={18} color={colors.pink} strokeWidth={2.2} />
      <View style={{ flex: 1, gap: 1 }}>
        <T variant="captionStrong" color={colors.white}>{mine ? 'You’ve reserved ' : 'Reserved: '}{r.title}</T>
        {r.detail ? <T variant="small" color={colors.onDarkMuted}>{r.detail}</T> : null}
        {r.reference ? <T variant="small" color={colors.onDarkMuted}>Booking {r.reference} · {formatINR(r.amount)} paid</T> : null}
      </View>
    </View>
  );
}

// ---------- invite card ----------
function InviteCard({ i, busy, onRequest, onWithdraw, onCancel, onRespond, onReport, onChat, onReserve, onDemoAccept, onDemoRequest }: {
  i: OneOnOneInvite; busy: boolean;
  onRequest: () => void; onWithdraw: () => void; onCancel: () => void; onRespond: (m: MemberCard, accept: boolean) => void;
  onReport: () => void; onChat: () => void; onReserve: () => void; onDemoAccept?: () => void; onDemoRequest?: () => void;
}) {
  const when = `${relativeDay(i.startsAt)} · ${formatTime(i.startsAt)}`;
  return (
    <View style={styles.card}>
      <Photo uri={i.coverUrl} seed={i.id} style={{ height: 120 }} scrim={0.25}>
        <View style={styles.cardTop}>
          <View style={styles.kindPill}><Icon name={kindIcon(i.kind)} size={13} color={colors.white} strokeWidth={2.2} /><T variant="small" color={colors.white} style={{ fontFamily: fonts.semibold }}>{KINDS.find((k) => k.key === i.kind)?.label}</T></View>
          <View style={{ gap: 6, alignItems: 'flex-end' }}>
            <Badge label={openToLabel(i.openTo)} tone={i.openTo === 'anyone' ? 'dark' : 'pink'} />
            {i.reservation ? <Badge label="Reserved" tone="success" /> : null}
          </View>
        </View>
      </Photo>
      <View style={{ padding: 14, gap: 10 }}>
        {i.myStatus === 'host' ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Badge label="Your invite" tone="pink" uppercase /><T variant="small" color={colors.onDarkMuted}>{i.status === 'matched' ? 'Matched' : `${i.requests.length} request${i.requests.length === 1 ? '' : 's'}`}</T></View>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Who m={i.host} />
            <IconButton icon="flag" label={`Report or block ${i.host.firstName}`} tone="clear" size={36} color={colors.onDarkSubtle} onPress={onReport} />
          </View>
        )}
        {startsInLabel(i.startsAt) && i.myStatus === 'none' ? <Badge label={startsInLabel(i.startsAt)!} tone="warning" /> : null}
        <T variant="title3" color={colors.white}>{i.activity}</T>
        {i.note ? <T variant="caption" color={colors.onDarkMuted}>“{i.note}”</T> : null}
        <View style={{ gap: 4 }}>
          <Fact icon="calendar" text={`${when} · ${i.durationMin < 60 ? `${i.durationMin} min` : `${Math.round(i.durationMin / 60 * 10) / 10} hr`}`} />
          <Fact icon="pin" text={`${i.venueName}, ${i.area} · ${i.distanceKm} km`} />
          <Fact icon="wallet" text={i.costNote} />
        </View>
        <Pressable accessibilityRole="link" accessibilityLabel={`View ${i.venueName} on VIBE`} onPress={() => router.push(`/business/${i.venueBusinessId}`)} hitSlop={8} style={{ alignSelf: 'flex-start' }}>
          <T variant="captionStrong" color={colors.white} style={{ textDecorationLine: 'underline' }}>View {i.venueName} on VIBE</T>
        </Pressable>

        {i.reservation ? <ReservationCard r={i.reservation} mine={i.myStatus === 'host'} /> : null}

        {i.myStatus === 'none' ? <Button label="Ask to join" size="md" onPress={onRequest} loading={busy} /> : null}

        {i.myStatus === 'requested' ? (
          <View style={{ gap: 8 }}>
            <Notice tone="warning" icon="clock"><T variant="small">Request sent. {i.host.firstName} will confirm. You’ll see the plan here once accepted.</T></Notice>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="Withdraw" variant="outline" size="sm" style={{ flex: 1 }} onPress={onWithdraw} />
              {onDemoAccept ? <Button label={`Demo: ${i.host.firstName} accepts`} variant="light" size="sm" style={{ flex: 1.6 }} onPress={onDemoAccept} /> : null}
            </View>
          </View>
        ) : null}

        {i.myStatus === 'confirmed' && i.matchedWith ? (
          <View style={{ gap: 8 }}>
            <Notice tone="success" icon="check"><T variant="small">You’re meeting {i.matchedWith.firstName} {when.toLowerCase().startsWith('today') ? 'today' : 'on ' + relativeDay(i.startsAt)} at {i.venueName}. Meet inside the venue and tell a friend your plan.</T></Notice>
            <Button label="Open chat" icon="social" size="md" onPress={onChat} />
            <Button label="Cancel plan" variant="outline" size="sm" onPress={onWithdraw} />
          </View>
        ) : null}

        {i.myStatus === 'host' ? (
          <View style={{ gap: 8 }}>
            {i.status === 'matched' && i.matchedWith ? (
              <Notice tone="success" icon="check"><T variant="small">You’re meeting {i.matchedWith.firstName} ({i.matchedWith.ageBand}) at {i.venueName}.</T></Notice>
            ) : null}
            {i.reservationOption ? (
              <Button
                label={i.reservationOption.fee !== null ? `Reserve ${i.reservationOption.title.toLowerCase()} · ${formatINR(i.reservationOption.fee)}` : 'Reserve seats at the cinema'}
                icon={i.reservationOption.kind === 'movie' ? 'film' : 'lock'}
                variant="light"
                size="md"
                onPress={onReserve}
              />
            ) : null}
            {i.status === 'matched' && i.matchedWith ? <Button label="Open chat" icon="social" size="md" onPress={onChat} /> : null}
            {i.requests.map((m) => (
              <View key={m.id} style={styles.request}>
                <Who m={m} />
                <Button label="Decline" variant="outline" size="sm" onPress={() => onRespond(m, false)} />
                <Button label="Accept" size="sm" onPress={() => onRespond(m, true)} />
              </View>
            ))}
            {i.status === 'open' && i.requests.length === 0 ? <T variant="small" color={colors.onDarkMuted}>No requests yet. Matching members can see your invite now.</T> : null}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="Cancel invite" variant="outline" size="sm" style={{ flex: 1 }} onPress={onCancel} />
              {onDemoRequest && i.status === 'open' ? <Button label="Demo: someone asks" variant="light" size="sm" style={{ flex: 1.4 }} onPress={onDemoRequest} /> : null}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Fact({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name={icon} size={15} color={colors.onDarkMuted} />
      <T variant="small" color={colors.onDarkMuted} style={{ flex: 1 }}>{text}</T>
    </View>
  );
}

// ---------- section ----------
type ReportTarget = { type: 'user'; id: string; name: string; hostId: string };

export function OneOnOneSection({ filter, signedIn, onRequireSignIn, onReport }: { filter: SocialFilter; signedIn: boolean; onRequireSignIn: () => void; onReport: (t: ReportTarget) => void }) {
  const profile = useAsync(() => (signedIn ? api.getSocialProfile() : Promise.resolve(null)), [signedIn]);
  const p = profile.data ?? null;
  const invites = useAsync(() => (p ? api.getOneOnOnes(filter) : Promise.resolve([] as OneOnOneInvite[])), [p?.gender, p?.meetPreference, filter.when, filter.nearMe]);
  const filtering = !!filter.when || !!filter.nearMe;
  const [kind, setKind] = useState<OneOnOneKind | 'all'>('all');
  const [editing, setEditing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [chatInvite, setChatInvite] = useState<OneOnOneInvite | null>(null);
  const [reserveId, setReserveId] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  // Coming back from paying: show the reservation.
  useFocusEffect(useCallback(() => { invites.reload(); }, [invites.reload])); // eslint-disable-line react-hooks/exhaustive-deps
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  const replace = (n: OneOnOneInvite) => invites.setData((list) => list?.some((x) => x.id === n.id) ? list.map((x) => (x.id === n.id ? n : x)) : [n, ...(list ?? [])]);
  const run = async (inviteId: string, fn: () => Promise<OneOnOneInvite | void>, ok?: string) => {
    setBusyId(inviteId);
    setNotice(null);
    try {
      const r = await fn();
      if (r) replace(r); else invites.reload();
      if (ok) setNotice({ tone: 'success', text: ok });
    } catch (e) {
      setNotice({ tone: 'error', text: errorMessage(e) });
    } finally {
      setBusyId(null);
    }
  };

  const reserving = invites.data?.find((x) => x.id === reserveId) ?? null;
  const cancelling = invites.data?.find((x) => x.id === cancelId) ?? null;
  const cancelInvite = (i: OneOnOneInvite) => run(i.id, () => api.cancelOneOnOne(i.id).then(() => api.getOneOnOnes(filter)).then((l) => { invites.setData(() => l); }), 'Invite cancelled. Anyone who asked to join has been told.');
  const list = (invites.data ?? []).filter((i) => kind === 'all' || i.kind === kind);
  const mine = list.filter((i) => i.myStatus !== 'none');
  const open = list.filter((i) => i.myStatus === 'none');

  return (
    <View style={{ gap: 14 }}>
      <View style={{ paddingHorizontal: 20, gap: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <T variant="title2" color={colors.white} accessibilityRole="header">One-on-one</T>
          <Badge label="18+" tone="pink" />
        </View>
        <T variant="caption" color={colors.onDarkMuted}>Coffee, a game of badminton or a date. One person posts a plan at a public place, one person joins.</T>
      </View>

      <View style={styles.safety}>
        {[
          ['shield', 'Public venues only, first names only'],
          ['lock', 'Your phone number is never shared'],
          ['flag', 'Report or block anyone, anytime'],
        ].map(([icon, text]) => (
          <View key={text} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <Icon name={icon as IconName} size={15} color={colors.pink} strokeWidth={2.2} />
            <T variant="small" color="rgba(255,255,255,0.86)">{text}</T>
          </View>
        ))}
      </View>

      {!signedIn ? (
        <View style={{ paddingHorizontal: 20 }}><Button label="Sign in to see one-on-ones" onPress={onRequireSignIn} /></View>
      ) : profile.error ? (
        <ErrorState message={profile.error} onRetry={profile.reload} />
      ) : profile.loading && !profile.data ? (
        <LoadingState rows={1} dark />
      ) : !p ? (
        <View style={styles.setup}>
          <T variant="headline" color={colors.white}>Set your preferences first</T>
          <T variant="caption" color={colors.onDarkMuted}>Tell us who you are and who you’d like to meet: men, women or anyone. You only see invites that work both ways.</T>
          <Button label="Set up one-on-one" onPress={() => setEditing(true)} />
        </View>
      ) : (
        <>
          <View style={styles.prefRow}>
            <View style={{ flex: 1 }}>
              <T variant="small" color={colors.onDarkMuted}>Showing invites for</T>
              <T variant="captionStrong" color={colors.white}>
                {GENDERS.find((g) => g.key === p.gender)?.label} · meeting {PREFS.find((x) => x.key === p.meetPreference)?.label.toLowerCase()}{p.ageBand ? ` · ${p.ageBand}` : ''}
              </T>
            </View>
            <Button label="Change" variant="light" size="sm" onPress={() => setEditing(true)} />
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}>
            <Chip label="All" onDark selected={kind === 'all'} onPress={() => setKind('all')} />
            {KINDS.map((k) => <Chip key={k.key} label={k.label} onDark selected={kind === k.key} onPress={() => setKind(k.key)} />)}
          </ScrollView>

          <View style={{ paddingHorizontal: 20 }}><Button label="Post a one-on-one" icon="plus" variant="primary" size="md" onPress={() => setPosting(true)} /></View>
          {notice ? <View style={{ paddingHorizontal: 20 }}><Notice tone={notice.tone}><T variant="caption">{notice.text}</T></Notice></View> : null}
          {invites.error ? <ErrorState message={invites.error} onRetry={invites.reload} /> : null}
          {invites.loading && !invites.data ? <LoadingState rows={1} dark /> : null}

          <View style={{ paddingHorizontal: 20, gap: 14 }}>
            {mine.length ? <T variant="label" color={colors.onDarkMuted}>Your plans</T> : null}
            {[...mine, ...open].map((i, idx) => (
              <View key={i.id} style={{ gap: 14 }}>
                {idx === mine.length && open.length ? <T variant="label" color={colors.onDarkMuted}>Open invites near you</T> : null}
                <InviteCard
                  i={i}
                  busy={busyId === i.id}
                  onRequest={() => run(i.id, () => api.requestOneOnOne(i.id))}
                  onWithdraw={() => run(i.id, () => api.cancelOneOnOne(i.id).then(() => api.getOneOnOnes(filter)).then((l) => { invites.setData(() => l); }))}
                  onCancel={() => (i.reservation ? setCancelId(i.id) : cancelInvite(i))}
                  onReserve={() => setReserveId(i.id)}
                  onRespond={(m, accept) => run(i.id, () => api.respondOneOnOne(i.id, m.id, accept), accept ? `You’re meeting ${m.firstName}. You’ll both see the plan here.` : undefined)}
                  onReport={() => onReport({ type: 'user', id: i.host.id, name: i.host.firstName, hostId: i.host.id })}
                  onChat={() => setChatInvite(i)}
                  onDemoAccept={api.demo ? () => run(i.id, () => api.demo!.simulateHostAccepts(i.id)) : undefined}
                  onDemoRequest={api.demo ? () => run(i.id, () => api.demo!.simulateJoinRequest(i.id)) : undefined}
                />
              </View>
            ))}
            {invites.data && list.length === 0 ? (
              <EmptyState dark icon="social" title={filtering ? 'No invites match these filters' : 'No matching invites yet'} message={filtering ? 'Try Today or This week, or turn off Near me.' : 'Try another activity, or post your own plan.'} />
            ) : null}
          </View>
        </>
      )}

      <ProfileSheet
        key={p ? `${p.gender}-${p.meetPreference}-${p.ageBand}` : 'new'}
        visible={editing}
        initial={p}
        onClose={() => setEditing(false)}
        onSaved={(np) => { profile.setData(() => np); setEditing(false); }}
      />
      <ReserveSheet key={reserveId ?? 'none'} invite={reserving} onClose={() => setReserveId(null)} />
      <CancelReservedSheet invite={cancelling} onClose={() => setCancelId(null)} onConfirm={() => { const c = cancelling; setCancelId(null); if (c) cancelInvite(c); }} />
      {chatInvite ? <MatchChat key={chatInvite.id} invite={chatInvite} onClose={() => setChatInvite(null)} onChanged={() => invites.reload()} /> : null}
      <PostSheet
        visible={posting}
        onClose={() => setPosting(false)}
        onPosted={(inv) => { replace(inv); setPosting(false); setNotice({ tone: 'success', text: 'Invite posted. Matching members can ask to join now.' }); if (inv.reservationOption) setReserveId(inv.id); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center' },
  seg: { paddingHorizontal: 14, height: 40, borderRadius: radius.pill, backgroundColor: colors.darkSurface, borderWidth: 1.5, borderColor: colors.darkSurface, alignItems: 'center', justifyContent: 'center' },
  segOn: { borderColor: colors.pink, backgroundColor: colors.nearBlack },
  backdrop: { flex: 1, backgroundColor: 'rgba(23,21,27,0.6)' },
  sheet: { maxHeight: '90%', backgroundColor: colors.nearBlack, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 20, paddingTop: 10 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.darkSurface, marginBottom: 12 },
  checkRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: colors.onDarkSubtle, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 48, borderRadius: radius.md, backgroundColor: colors.darkSurface, color: colors.white, paddingHorizontal: 14, fontFamily: fonts.medium, fontSize: 15 },
  card: { borderRadius: 22, backgroundColor: colors.darkSurface, overflow: 'hidden' },
  cardTop: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between' },
  kindPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(23,21,27,0.75)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  request: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 16, backgroundColor: colors.nearBlack },
  safety: { marginHorizontal: 20, padding: 14, borderRadius: 16, backgroundColor: colors.darkSurface, gap: 8 },
  reserveCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: colors.darkSurface },
  reserveIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center' },
  booked: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.nearBlack, borderWidth: 1, borderColor: colors.pink },
  setup: { marginHorizontal: 20, padding: 18, borderRadius: 20, borderWidth: 1.5, borderColor: colors.pink, gap: 10 },
  prefRow: { marginHorizontal: 20, padding: 12, borderRadius: 16, backgroundColor: colors.darkSurface, flexDirection: 'row', alignItems: 'center', gap: 10 },
});
