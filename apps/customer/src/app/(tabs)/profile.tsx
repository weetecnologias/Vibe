import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, apiMode } from '@/api';
import { Button, Card, Icon, Notice, T, type IconName } from '@/components/ui';
import { formatINR } from '@/lib/money';
import { errorMessage, useAsync } from '@/lib/useAsync';
import { useSession } from '@/state/session';
import { colors, fonts } from '@/theme/tokens';

type Item = { label: string; icon: IconName; meta?: string; onPress?: () => void };

export default function Profile() {
  const insets = useSafeAreaInsets();
  const { status, user, area, signOut } = useSession();
  const signedIn = status === 'signedIn';
  const membership = useAsync(() => (signedIn ? api.getMembership() : Promise.resolve(null)), [signedIn]);
  const tickets = useAsync(() => (signedIn ? api.getMyTickets() : Promise.resolve([])), [signedIn]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const soon = (what: string) => () => setDeleteMsg(`${what} is coming in the next release.`);

  const groups: { title: string; items: Item[] }[] = [
    { title: 'Activity', items: [
      { label: 'My tickets', icon: 'ticket', meta: tickets.data?.length ? String(tickets.data.length) : undefined, onPress: () => router.push('/tickets') },
      { label: 'My bookings', icon: 'calendar', onPress: () => router.push('/bookings') },
      { label: 'Saved places', icon: 'heart', onPress: soon('Saved places') },
      { label: 'Payments & receipts', icon: 'receipt', onPress: soon('Receipts history') },
    ] },
    { title: 'Account', items: [
      { label: 'Location', icon: 'pin', meta: area ?? undefined, onPress: () => router.push('/location') },
      { label: 'Notifications', icon: 'bell', onPress: () => router.push('/notifications') },
    ] },
    { title: 'Privacy & safety', items: [
      { label: 'Privacy & data', icon: 'lock', meta: 'Consents', onPress: soon('Privacy controls') },
      { label: 'Blocked people', icon: 'shield', onPress: soon('Blocked people') },
      { label: 'Community guidelines', icon: 'flag', onPress: soon('Community guidelines') },
    ] },
    { title: 'Support', items: [
      { label: 'Help & support', icon: 'help', onPress: soon('In-app support') },
      { label: 'Terms & policies', icon: 'doc', onPress: soon('Terms & policies') },
    ] },
  ];

  const requestDeletion = async () => {
    setBusy(true);
    try {
      const r = await api.requestAccountDeletion();
      setDeleteMsg(r.message);
      setConfirmDelete(false);
    } catch (e) {
      setDeleteMsg(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await signOut();
    router.replace('/login');
  };

  const initials = (user?.name ?? 'Guest').split(' ').map((w) => w[0]).slice(0, 2).join('');
  const member = membership.data?.status === 'active';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.softWhite }} contentContainerStyle={{ paddingBottom: 32, gap: 22 }}>
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={styles.avatar}><T style={{ fontFamily: fonts.display, fontSize: 24, color: colors.white }}>{initials}</T></View>
          <View style={{ flex: 1, gap: 3 }}>
            <T variant="title2" color={colors.white} accessibilityRole="header">{user?.name ?? 'Guest'}</T>
            <T variant="caption" color={colors.onDarkMuted}>{signedIn ? `${user?.phoneMasked} · ${area}` : 'Browsing without an account'}</T>
            {member ? (
              <View style={styles.memberTag}><View style={styles.dot} /><T variant="label" color={colors.white}>VIBE member</T></View>
            ) : null}
          </View>
        </View>
        {signedIn ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Stat v={membership.data ? formatINR(membership.data.savings.total) : '—'} k="Saved" onPress={() => router.push('/membership')} />
            <Stat v={String(tickets.data?.length ?? 0)} k="Tickets" onPress={() => router.push('/tickets')} />
            <Stat v={user?.vibeId ?? '—'} k="VIBE ID" />
          </View>
        ) : (
          <Button label="Sign in or create account" onPress={() => router.push('/login')} />
        )}
      </View>

      {deleteMsg ? <View style={{ paddingHorizontal: 20 }}><Notice tone="info"><T variant="caption">{deleteMsg}</T></Notice></View> : null}

      {groups.map((g) => (
        <View key={g.title} style={{ paddingHorizontal: 20, gap: 10 }}>
          <T variant="label" color={colors.mutedGrey}>{g.title}</T>
          <Card style={{ overflow: 'hidden' }}>
            {g.items.filter((i) => signedIn || !['My tickets', 'Payments & receipts', 'My bookings'].includes(i.label)).map((i, idx, arr) => (
              <Pressable key={i.label} accessibilityRole="button" onPress={i.onPress} style={[styles.item, idx < arr.length - 1 && styles.divider]}>
                <View style={styles.itemIcon}><Icon name={i.icon} size={19} /></View>
                <T variant="body" style={{ flex: 1, fontFamily: fonts.medium }}>{i.label}</T>
                {i.meta ? <T variant="small" color={colors.mutedGrey}>{i.meta}</T> : null}
                <Icon name="chevronRight" size={16} color={colors.mutedGrey} strokeWidth={2} />
              </Pressable>
            ))}
          </Card>
        </View>
      ))}

      {signedIn ? (
        <View style={{ paddingHorizontal: 20, gap: 8 }}>
          <Button label="Log out" icon="logout" variant="outline" onPress={logout} />
          {!confirmDelete ? (
            <Pressable accessibilityRole="button" onPress={() => setConfirmDelete(true)} style={{ paddingVertical: 12 }}>
              <T variant="bodyStrong" color={colors.error}>Delete my account and data</T>
            </Pressable>
          ) : (
            <Card style={{ padding: 16, gap: 10, borderColor: colors.error }}>
              <T variant="headline">Delete your account?</T>
              <T variant="caption" color={colors.mutedGrey}>
                We’ll delete your profile, saved places and social activity. Payment and tax records we must keep by law are retained and then deleted on schedule. Active membership and tickets will be cancelled.
              </T>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button label="Keep account" variant="outline" size="md" style={{ flex: 1 }} onPress={() => setConfirmDelete(false)} />
                <Button label="Request deletion" variant="danger" size="md" style={{ flex: 1 }} loading={busy} onPress={requestDeletion} />
              </View>
            </Card>
          )}
        </View>
      ) : null}

      <T variant="small" color={colors.mutedGrey} align="center">VIBE Hyderabad · v1.0.0{apiMode === 'demo' ? ' · demo data' : ''}</T>
    </ScrollView>
  );
}

function Stat({ v, k, onPress }: { v: string; k: string; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} style={styles.stat}>
      <T style={{ fontFamily: fonts.display, fontSize: 18, color: colors.white }}>{v}</T>
      <T variant="small" color={colors.onDarkMuted}>{k}</T>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { backgroundColor: colors.nearBlack, paddingHorizontal: 20, paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, gap: 18 },
  avatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center' },
  memberTag: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.darkSurface, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.pink },
  stat: { flex: 1, padding: 12, borderRadius: 16, backgroundColor: colors.darkSurface, gap: 2 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 13 },
  itemIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.softWhite, alignItems: 'center', justifyContent: 'center' },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.hairline },
});
