import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { apiMode } from '@/api';
import { BackButton, Button, Icon, T } from '@/components/ui';
import { formatCountdown } from '@/lib/dates';
import { errorMessage } from '@/lib/useAsync';
import { useSession } from '@/state/session';
import { colors, fonts, radius } from '@/theme/tokens';

const LENGTH = 6;

export default function Otp() {
  const insets = useSafeAreaInsets();
  const { challenge, verifyOtp, requestOtp, area } = useSession();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(challenge?.resendInSec ?? 30);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!challenge) router.replace('/login');
  }, [challenge]);

  const submit = async (value = code) => {
    if (value.length !== LENGTH || busy) return;
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(value);
      router.replace(area ? '/home' : '/location');
    } catch (e) {
      setError(errorMessage(e));
      setCode('');
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!challenge) return;
    try {
      const c = await requestOtp(challenge.phone);
      setResendIn(c.resendInSec);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }]}>
      <View style={{ marginLeft: -10 }}><BackButton fallback="/login" /></View>
      <T variant="title1" style={{ marginTop: 20 }} accessibilityRole="header">Verify your number</T>
      <T variant="body" color={colors.mutedGrey} style={{ marginTop: 8 }}>
        Enter the code sent to <T variant="bodyStrong">{challenge?.maskedPhone}</T>.{' '}
        <T variant="bodyStrong" color={colors.pinkDeep} onPress={() => router.back()} accessibilityRole="link">Edit</T>
      </T>

      {/* One real input drives six visual boxes (best for SMS autofill and screen readers). */}
      <View style={styles.boxes}>
        {Array.from({ length: LENGTH }).map((_, i) => {
          const ch = code[i] ?? '';
          const active = i === Math.min(code.length, LENGTH - 1) && !busy;
          return (
            <View
              key={i}
              style={[styles.box, { borderColor: error ? colors.error : active ? colors.pink : ch ? colors.nearBlack : colors.hairline, borderWidth: active ? 2 : 1.5 }]}>
              <T style={styles.digit}>{ch}</T>
            </View>
          );
        })}
        <TextInput
          ref={input}
          value={code}
          onChangeText={(t) => {
            const v = t.replace(/\D/g, '').slice(0, LENGTH);
            setCode(v);
            if (v.length === LENGTH) submit(v);
          }}
          autoFocus
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={LENGTH}
          accessibilityLabel="One-time code"
          style={styles.hiddenInput}
          caretHidden
        />
      </View>

      {error ? <T variant="caption" color={colors.error} style={{ marginTop: 12 }} accessibilityRole="alert">{error}</T> : null}

      <View style={styles.resendRow}>
        <T variant="caption" color={colors.mutedGrey}>Didn’t get it?</T>
        {resendIn > 0 ? (
          <T variant="caption" color={colors.mutedGrey}>Resend in <T variant="captionStrong">{formatCountdown(resendIn)}</T></T>
        ) : (
          <T variant="captionStrong" color={colors.pinkDeep} onPress={resend} accessibilityRole="button">Resend code</T>
        )}
      </View>

      <View style={styles.notice}>
        <Icon name="lock" size={20} />
        <T variant="caption" color={colors.mutedGrey} style={{ flex: 1 }}>Never share this code. VIBE and our partner businesses will never ask for it.</T>
      </View>
      {apiMode === 'demo' ? (
        <T variant="small" color={colors.warning} style={{ marginTop: 12 }}>Demo mode: no SMS is sent. Use code 123456.</T>
      ) : null}

      <View style={{ flex: 1 }} />
      <Button label="Verify and continue" onPress={() => submit()} loading={busy} disabled={code.length !== LENGTH} />
      <T variant="small" color={colors.mutedGrey} align="center" style={{ marginTop: 12 }}>
        Code expires in 5 minutes · {challenge?.attemptsLeft ?? 3} attempts
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white, paddingHorizontal: 24 },
  boxes: { flexDirection: 'row', gap: 10, marginTop: 32 },
  box: { flex: 1, height: 58, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  digit: { fontFamily: fonts.display, fontSize: 24, color: colors.nearBlack },
  hiddenInput: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0.02, color: 'transparent' },
  resendRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 },
  notice: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 28, padding: 14, borderRadius: 16, backgroundColor: colors.softWhite },
});
