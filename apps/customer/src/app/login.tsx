import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, T } from '@/components/ui';
import { errorMessage } from '@/lib/useAsync';
import { isValidIndianMobile } from '@/lib/validation';
import { useSession } from '@/state/session';
import { colors, fonts, radius } from '@/theme/tokens';

export default function Login() {
  const insets = useSafeAreaInsets();
  const { requestOtp, continueAsGuest, status } = useSession();
  const [phone, setPhone] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = phone.replace(/\D/g, '').slice(0, 10);
  const valid = isValidIndianMobile(digits);
  const showInvalid = touched && digits.length > 0 && !valid;

  const submit = async () => {
    setTouched(true);
    if (!valid || !agreed) return;
    setBusy(true);
    setError(null);
    try {
      await requestOtp(digits);
      router.push('/otp');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const guest = async () => {
    await continueAsGuest();
    router.replace('/location');
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.white }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <T style={styles.logo}>VIBE</T>
        <T variant="title1" style={{ marginTop: 36 }} accessibilityRole="header">Enter your mobile number</T>
        <T variant="body" color={colors.mutedGrey} style={{ marginTop: 8 }}>We’ll text you a 6-digit code to sign in or create your account.</T>

        <T variant="captionStrong" style={{ marginTop: 28 }} nativeID="phoneLabel">Mobile number</T>
        <View style={[styles.input, { borderColor: showInvalid ? colors.error : digits ? colors.pink : colors.hairline }]}>
          <T variant="bodyStrong" style={{ fontSize: 16 }}>+91</T>
          <View style={styles.sep} />
          <TextInput
            accessibilityLabelledBy="phoneLabel"
            accessibilityLabel="Mobile number"
            value={digits.replace(/^(\d{5})(\d+)/, '$1 $2')}
            onChangeText={setPhone}
            onBlur={() => setTouched(true)}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            maxLength={11}
            placeholder="98765 43210"
            placeholderTextColor={colors.mutedGrey}
            style={styles.textInput}
            returnKeyType="done"
            onSubmitEditing={submit}
          />
        </View>
        {showInvalid ? (
          <View style={styles.errRow} accessibilityRole="alert">
            <Icon name="info" size={14} color={colors.error} strokeWidth={2} />
            <T variant="small" color={colors.error}>Enter a valid 10-digit Indian mobile number</T>
          </View>
        ) : (
          <T variant="small" color={colors.mutedGrey} style={{ marginTop: 8 }}>Indian numbers only for now.</T>
        )}

        <View style={styles.consent}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }} aria-checked={agreed}
            accessibilityLabel="I agree to the Terms of Use and Privacy Policy and consent to receive my OTP by SMS"
            onPress={() => setAgreed((a) => !a)}
            hitSlop={12}
            style={[styles.box, agreed ? { backgroundColor: colors.pink, borderWidth: 0 } : null]}>
            {agreed ? <Icon name="check" size={14} color={colors.white} strokeWidth={3} /> : null}
          </Pressable>
          <T variant="caption" color={colors.mutedGrey} style={{ flex: 1 }}>
            I agree to the <T variant="captionStrong" color={colors.pinkDeep}>Terms of Use</T> and{' '}
            <T variant="captionStrong" color={colors.pinkDeep}>Privacy Policy</T>, and consent to receive my OTP by SMS.
          </T>
        </View>
        {touched && !agreed ? <T variant="small" color={colors.error} style={{ marginTop: 6, marginLeft: 34 }}>Please accept to continue.</T> : null}
        {error ? <T variant="caption" color={colors.error} style={{ marginTop: 12 }} accessibilityRole="alert">{error}</T> : null}

        <View style={{ flex: 1 }} />
        <Button label="Send OTP" onPress={submit} loading={busy} disabled={!valid || !agreed} testID="send-otp" />
        {status === 'signedOut' ? <Button label="Browse as guest" variant="ghost" onPress={guest} style={{ marginTop: 8 }} /> : (
          <Button label="Not now" variant="ghost" onPress={() => router.back()} style={{ marginTop: 8 }} />
        )}
        <View style={styles.business}>
          <T variant="caption" color={colors.mutedGrey}>Own a business? </T>
          <T variant="captionStrong" color={colors.pinkDeep}>Join VIBE for Business</T>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24 },
  logo: { fontFamily: fonts.displayHeavy, fontSize: 28, letterSpacing: -1.2, color: colors.pink },
  input: { marginTop: 8, height: 56, borderWidth: 2, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12 },
  sep: { width: 1, height: 24, backgroundColor: colors.hairline },
  textInput: { flex: 1, fontFamily: fonts.semibold, fontSize: 17, letterSpacing: 0.6, color: colors.nearBlack, height: '100%' },
  errRow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 8 },
  consent: { flexDirection: 'row', gap: 12, marginTop: 24, alignItems: 'flex-start' },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: colors.mutedGrey, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  business: { flexDirection: 'row', justifyContent: 'center', marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.hairline },
});
