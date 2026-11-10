import { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type ReportInput, type ReportReason } from '@/api';
import { errorMessage } from '@/lib/useAsync';
import { colors, fonts, radius } from '@/theme/tokens';

import { Button, Icon, Notice, T } from './ui';

const REASONS: { key: ReportReason; label: string }[] = [
  { key: 'harassment', label: 'Harassment or bullying' },
  { key: 'unsafe', label: 'Feels unsafe or threatening' },
  { key: 'inappropriate', label: 'Inappropriate content' },
  { key: 'underage', label: 'Someone may be under age' },
  { key: 'spam', label: 'Spam or scam' },
  { key: 'other', label: 'Something else' },
];

type Target = { type: ReportInput['targetType']; id: string; name: string; hostId?: string };

/** Report (and optionally block) sheet. Reports go to the admin moderation queue. */
export function ReportSheet({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [block, setBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setReason(null); setNote(''); setBlock(false); setDone(false); setError(null);
    onClose();
  };

  const submit = async () => {
    if (!target || !reason) return;
    setBusy(true);
    setError(null);
    try {
      await api.report({ targetType: target.type, targetId: target.id, reason, note: note.trim() || undefined });
      if (block && target.hostId) await api.block(target.hostId);
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={!!target} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.grab} />
        {done ? (
          <View style={{ gap: 12, alignItems: 'center', paddingVertical: 12 }}>
            <View style={styles.ok}><Icon name="check" size={26} color={colors.white} strokeWidth={2.6} /></View>
            <T variant="title2" color={colors.white} align="center">Thanks for telling us</T>
            <T variant="caption" color={colors.onDarkMuted} align="center">
              Our moderation team reviews every report. The person you reported isn’t told who reported them.{block ? ' You won’t see this host’s activities any more.' : ''}
            </T>
            <Button label="Done" onPress={close} style={{ alignSelf: 'stretch', marginTop: 8 }} />
          </View>
        ) : (
          <View style={{ gap: 14 }}>
            <T variant="title2" color={colors.white}>Report {target?.name}</T>
            <T variant="caption" color={colors.onDarkMuted}>If someone is in immediate danger, call 112.</T>
            <View style={{ gap: 8 }} accessibilityRole="radiogroup">
              {REASONS.map((r) => {
                const on = reason === r.key;
                return (
                  <Pressable key={r.key} accessibilityRole="radio" accessibilityState={{ checked: on }} aria-checked={on} onPress={() => setReason(r.key)} style={[styles.reason, on && { borderColor: colors.pink }]}>
                    <T variant="caption" color={colors.white} style={{ flex: 1 }}>{r.label}</T>
                    <View style={[styles.radio, on && { borderColor: colors.pink }]}>{on ? <View style={styles.radioDot} /> : null}</View>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Add details (optional)"
              placeholderTextColor={colors.onDarkSubtle}
              multiline
              maxLength={500}
              accessibilityLabel="Details"
              style={styles.note}
            />
            {target?.hostId ? (
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: block }} aria-checked={block} onPress={() => setBlock((b) => !b)} style={styles.blockRow}>
                <View style={[styles.box, block && { backgroundColor: colors.pink, borderColor: colors.pink }]}>{block ? <Icon name="check" size={14} color={colors.white} strokeWidth={3} /> : null}</View>
                <T variant="caption" color={colors.white}>Also block this host</T>
              </Pressable>
            ) : null}
            {error ? <Notice tone="error"><T variant="caption">{error}</T></Notice> : null}
            <Button label="Send report" onPress={submit} disabled={!reason} loading={busy} />
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(23,21,27,0.6)' },
  sheet: { backgroundColor: colors.nearBlack, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: 20, paddingTop: 10 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.darkSurface, marginBottom: 14 },
  reason: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14, backgroundColor: colors.darkSurface, borderWidth: 1.5, borderColor: colors.darkSurface },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: colors.onDarkSubtle, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.pink },
  note: { minHeight: 70, borderRadius: 14, backgroundColor: colors.darkSurface, color: colors.white, padding: 14, fontFamily: fonts.regular, fontSize: 14, textAlignVertical: 'top' },
  blockRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: colors.onDarkSubtle, alignItems: 'center', justifyContent: 'center' },
  ok: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
});
