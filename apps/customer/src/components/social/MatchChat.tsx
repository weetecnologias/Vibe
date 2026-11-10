import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type ChatMessage, type ChatSendInput, type OneOnOneChat, type OneOnOneInvite } from '@/api';
import { CHAT_FREE_TEXT_MAX, DRESS_COLOURS, MEET_SPOTS, MEET_STATUS } from '@/api/chat';
import { formatTime, relativeDay } from '@/lib/dates';
import { errorMessage } from '@/lib/useAsync';
import { colors, fonts, radius } from '@/theme/tokens';

import { Button, Chip, Icon, IconButton, Notice, T } from '../ui';

type Panel = 'dress' | 'table' | 'spot' | 'status' | null;
const PANELS: { key: Exclude<Panel, null>; label: string }[] = [
  { key: 'dress', label: 'Dress colour' }, { key: 'table', label: 'Table / seat' }, { key: 'spot', label: 'Where I am' }, { key: 'status', label: 'Status' },
];

const CLOSED: Record<NonNullable<OneOnOneChat['closedReason']>, { tone: 'error' | 'info'; text: string }> = {
  contact_shared: { tone: 'error', text: 'This chat was closed because a phone number or other contact detail was about to be shared. You’re blocked from each other and VIBE has flagged it for review.' },
  cancelled: { tone: 'info', text: 'The plan was cancelled, so this chat has ended.' },
  blocked: { tone: 'info', text: 'This chat has ended because one of you blocked the other.' },
  ended: { tone: 'info', text: 'The meetup is over, so this chat has closed.' },
};

function Bubble({ m }: { m: ChatMessage }) {
  if (m.from === 'system') {
    return (
      <View style={styles.system}>
        <T variant="small" color={colors.onDarkMuted} align="center">{m.text}</T>
      </View>
    );
  }
  const mine = m.from === 'me';
  return (
    <View style={[styles.row, mine ? { justifyContent: 'flex-end' } : null]}>
      <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
        <T variant="body" color={colors.white}>{m.text}</T>
        <T variant="small" color={mine ? 'rgba(255,255,255,0.8)' : colors.onDarkSubtle} style={{ marginTop: 2 }}>{formatTime(m.at)}</T>
      </View>
    </View>
  );
}

/** Meeting-details chat for a matched one-on-one. 30 messages, no contact details. */
export function MatchChat({ invite, onClose, onChanged }: { invite: OneOnOneInvite; onClose: () => void; onChanged: () => void }) {
  const insets = useSafeAreaInsets();
  const id = invite.id;
  const [chat, setChat] = useState<OneOnOneChat | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [text, setText] = useState('');
  const [num, setNum] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);

  const load = useCallback(async () => {
    try {
      setChat(await api.getOneOnOneChat(id));
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => void load(), 8000); // push notifications replace this when FCM is connected
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load]);

  const send = async (input: ChatSendInput) => {
    if (busy) return;
    setBusy(true);
    setSendError(null);
    try {
      const r = await api.sendOneOnOneMessage(id, input);
      setChat(r.chat);
      setText('');
      setNum('');
      setPanel(null);
      if (!r.delivered) onChanged(); // contact detail caught: chat closed, pair blocked, list needs a refresh
    } catch (e) {
      setSendError(errorMessage(e));
      void load();
    } finally {
      setBusy(false);
    }
  };

  const left = chat ? chat.limit - chat.used : 0;
  const open = chat?.status === 'open';
  const validNum = /^[1-9]\d?$/.test(num);
  const name = chat?.counterpart.firstName ?? 'your match';

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.header}>
          <View style={styles.avatar}><T variant="bodyStrong" color={colors.white}>{name[0]}</T></View>
          <View style={{ flex: 1 }}>
            <T variant="bodyStrong" color={colors.white} accessibilityRole="header">Chat with {name}</T>
            <T variant="small" color={colors.onDarkMuted} numberOfLines={1}>{invite.venueName} · {relativeDay(invite.startsAt)} {formatTime(invite.startsAt)}</T>
          </View>
          {chat ? (
            <View style={[styles.counter, left <= 5 && { backgroundColor: colors.warningTint }]} accessibilityLabel={`${left} of ${chat.limit} messages left`}>
              <T variant="small" color={left <= 5 ? colors.warning : colors.white} style={{ fontFamily: fonts.bold }}>{left} left</T>
            </View>
          ) : null}
          <IconButton icon="close" label="Close chat" tone="dark" size={40} onPress={onClose} />
        </View>

        <ScrollView
          ref={scroller}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled">
          {!chat && !loadError ? <T variant="caption" color={colors.onDarkMuted} align="center">Opening chat…</T> : null}
          {loadError && !chat ? <Notice tone="error"><T variant="caption">{loadError}</T></Notice> : null}
          {chat?.messages.map((m) => <Bubble key={m.id} m={m} />)}
          {api.demo && open ? (
            <Button
              label={`Demo: ${name} replies`}
              variant="light"
              size="sm"
              style={{ alignSelf: 'center', marginTop: 6 }}
              onPress={async () => { try { setChat(await api.demo!.simulateChatReply(id)); } catch (e) { setSendError(errorMessage(e)); } }}
            />
          ) : null}
        </ScrollView>

        {chat && chat.status === 'closed' && chat.closedReason ? (
          <View style={styles.footer}><Notice tone={CLOSED[chat.closedReason].tone}><T variant="caption">{CLOSED[chat.closedReason].text}</T></Notice></View>
        ) : null}

        {chat?.status === 'limit_reached' ? (
          <View style={styles.footer}>
            <Notice tone="success" icon="check"><T variant="caption">You’ve used all {chat.limit} messages. See you at {chat.venueName}!</T></Notice>
          </View>
        ) : null}

        {open ? (
          <View style={styles.footer}>
            <View style={styles.rule}>
              <Icon name="shield" size={15} color={colors.pink} strokeWidth={2.2} />
              <T variant="small" color="rgba(255,255,255,0.86)" style={{ flex: 1 }}>
                Meeting details only. Sharing a phone number, email or social handle ends the chat and blocks you both.
              </T>
            </View>
            {sendError ? <Notice tone="error"><T variant="caption">{sendError}</T></Notice> : null}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {PANELS.map((p) => <Chip key={p.key} label={p.label} onDark selected={panel === p.key} onPress={() => setPanel(panel === p.key ? null : p.key)} />)}
            </ScrollView>

            {panel === 'dress' ? (
              <View style={styles.wrap}>{DRESS_COLOURS.map((c) => <Chip key={c} label={c} onDark onPress={() => void send({ template: 'dress', value: c })} />)}</View>
            ) : null}
            {panel === 'spot' ? (
              <View style={styles.wrap}>{MEET_SPOTS.map((s) => <Chip key={s} label={s} onDark onPress={() => void send({ template: 'spot', value: s })} />)}</View>
            ) : null}
            {panel === 'status' ? (
              <View style={styles.wrap}>{MEET_STATUS.map((s) => <Chip key={s} label={s} onDark onPress={() => void send({ template: 'status', value: s })} />)}</View>
            ) : null}
            {panel === 'table' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <TextInput
                  value={num}
                  onChangeText={(v) => setNum(v.replace(/\D/g, '').slice(0, 2))}
                  placeholder="No."
                  placeholderTextColor={colors.onDarkSubtle}
                  keyboardType="number-pad"
                  maxLength={2}
                  accessibilityLabel="Table or seat number"
                  style={[styles.input, { width: 72, textAlign: 'center' }]}
                />
                <Button label="Table" size="sm" disabled={!validNum} onPress={() => void send({ template: 'table', value: num })} style={{ flex: 1 }} />
                <Button label="Seat" size="sm" variant="light" disabled={!validNum} onPress={() => void send({ template: 'seat', value: num })} style={{ flex: 1 }} />
              </View>
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Short note, e.g. near the window"
                placeholderTextColor={colors.onDarkSubtle}
                maxLength={CHAT_FREE_TEXT_MAX}
                accessibilityLabel="Message"
                returnKeyType="send"
                onSubmitEditing={() => text.trim() && void send({ text })}
                style={[styles.input, { flex: 1 }]}
              />
              <IconButton icon="arrowRight" label="Send message" tone="pink" onPress={() => text.trim() && void send({ text })} />
            </View>
            <T variant="small" color={colors.onDarkSubtle}>{text.length}/{CHAT_FREE_TEXT_MAX} · {left} of {chat!.limit} messages left</T>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.nearBlack },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.darkSurface },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.pink, alignItems: 'center', justifyContent: 'center' },
  counter: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.darkSurface },
  row: { flexDirection: 'row' },
  bubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  mine: { backgroundColor: colors.pink, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: colors.darkSurface, borderBottomLeftRadius: 6 },
  system: { alignSelf: 'center', maxWidth: '92%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: colors.darkSurface },
  footer: { paddingHorizontal: 16, paddingTop: 10, gap: 10, borderTopWidth: 1, borderTopColor: colors.darkSurface },
  rule: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { minHeight: 46, borderRadius: radius.md, backgroundColor: colors.darkSurface, color: colors.white, paddingHorizontal: 14, fontFamily: fonts.medium, fontSize: 15 },
});
