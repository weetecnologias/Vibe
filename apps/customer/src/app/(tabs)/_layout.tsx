import { Tabs } from 'expo-router';

import { Icon, type IconName } from '@/components/ui';
import { colors, fonts } from '@/theme/tokens';

function TabIcon({ name, color, focused, dark }: { name: IconName; color: unknown; focused: boolean; dark?: boolean }) {
  // On near-black, the label stays white and the icon turns pink (pink text fails contrast on dark).
  return <Icon name={name} size={24} color={dark && focused ? colors.pink : String(color)} />;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => {
        const dark = route.name === 'social';
        return {
          headerShown: false,
          tabBarActiveTintColor: dark ? colors.white : colors.pink,
          tabBarInactiveTintColor: dark ? colors.onDarkSubtle : colors.mutedGrey,
          tabBarLabelStyle: { fontFamily: fonts.semibold, fontSize: 10, letterSpacing: -0.1 },
          tabBarItemStyle: { paddingHorizontal: 0 },
          tabBarStyle: {
            backgroundColor: dark ? colors.nearBlack : colors.white,
            borderTopColor: dark ? colors.darkSurface : colors.hairline,
          },
          sceneStyle: { backgroundColor: dark ? colors.nearBlack : colors.softWhite },
        };
      }}>
      <Tabs.Screen name="home" options={{ title: 'Home', tabBarIcon: (p) => <TabIcon name="home" {...p} /> }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover', tabBarIcon: (p) => <TabIcon name="discover" {...p} /> }} />
      <Tabs.Screen name="social" options={{ title: 'Social', tabBarIcon: (p) => <TabIcon name="social" dark {...p} /> }} />
      <Tabs.Screen name="membership" options={{ title: 'Membership', tabBarIcon: (p) => <TabIcon name="membership" {...p} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: (p) => <TabIcon name="profile" {...p} /> }} />
    </Tabs>
  );
}
