import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { Sora_600SemiBold, Sora_700Bold, Sora_800ExtraBold, useFonts } from '@expo-google-fonts/sora';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DemoRibbon } from '@/components/DemoRibbon';
import { SessionProvider, useSession } from '@/state/session';
import { colors } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();

export const unstable_settings = { anchor: 'index' };

function RootNavigator() {
  const { status, area } = useSession();
  const signedOut = status === 'signedOut';
  const inApp = status === 'signedIn' || status === 'guest';
  const member = status === 'signedIn';

  useEffect(() => {
    if (status !== 'loading') SplashScreen.hideAsync();
  }, [status]);

  if (status === 'loading') return null;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.softWhite }, animation: 'slide_from_right' }}>
      <Stack.Screen name="index" options={{ animation: 'fade' }} />

      <Stack.Protected guard={signedOut}>
        <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
      </Stack.Protected>

      {/* Guests can still sign in, e.g. when they try to redeem an offer */}
      <Stack.Protected guard={!member}>
        <Stack.Screen name="login" />
        <Stack.Screen name="otp" />
      </Stack.Protected>

      <Stack.Protected guard={inApp}>
        <Stack.Screen name="location" />
        <Stack.Protected guard={!!area}>
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          <Stack.Screen name="category/[id]" />
          <Stack.Screen name="business/[id]" />
          <Stack.Screen name="offer/[id]" />
          <Stack.Screen name="events/index" />
          <Stack.Screen name="event/[id]" />
          <Stack.Screen name="notifications" />
        </Stack.Protected>
      </Stack.Protected>

      {/* Money and personal data: signed-in customers only */}
      <Stack.Protected guard={member && !!area}>
        <Stack.Screen name="redeem/[offerId]" />
        <Stack.Screen name="payment/[reference]" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="checkout/[requestId]" />
        <Stack.Screen name="tickets/index" />
        <Stack.Screen name="ticket/[id]" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
    Sora_600SemiBold, Sora_700Bold, Sora_800ExtraBold,
  });

  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="auto" />
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1 }}><RootNavigator /></View>
          <DemoRibbon />
        </View>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
