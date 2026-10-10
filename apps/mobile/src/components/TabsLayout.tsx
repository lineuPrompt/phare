import { Tabs } from 'expo-router/js-tabs';
import AuthGate from './AuthGate';
import HouseholdGate from './HouseholdGate';
import { useI18n } from '../i18n';
import { theme } from '../theme';

/**
 * The signed-in shell: Home | Review | Timeline | Cards | Account.
 *
 * LIVES IN src/, NOT app/(tabs)/_layout.tsx, because the i18n parity test
 * extracts t() keys from src/ only. A tab label written in app/ would ship
 * without its key ever being checked in either locale.
 *
 * AuthGate, then HouseholdGate (terms), wrap the whole navigator.
 *
 * THE GATE WRAPS THE WHOLE NAVIGATOR, not each tab. Every tab is a signed-in
 * screen, and one gate means signing out anywhere replaces the whole shell
 * with the sign-in form rather than leaving the tab bar up around it.
 *
 * js-tabs, not native tabs: it ships inside expo-router (react-native plus
 * safe-area-context, both already installed), so adding it needs no native
 * module and no new development build.
 *
 * No icons. There is no icon set in this app and adding one is a dependency
 * for decoration; the labels carry the meaning.
 */
export default function TabsLayout() {
  const { t } = useI18n();

  return (
    <AuthGate>
      <HouseholdGate>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: theme.color.heading,
            tabBarInactiveTintColor: theme.color.muted,
            tabBarIconStyle: { display: 'none' },
            // 12, down from 14, when the fifth tab arrived: at 14 the longest
            // French label, « Chronologie », no longer fits a fifth of a phone.
            tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
            sceneStyle: { backgroundColor: theme.color.background },
          }}
        >
          <Tabs.Screen name="index" options={{ title: t('tabs.home') }} />
          <Tabs.Screen name="review" options={{ title: t('tabs.review') }} />
          <Tabs.Screen name="timeline" options={{ title: t('tabs.timeline') }} />
          <Tabs.Screen name="cards" options={{ title: t('tabs.cards') }} />
          <Tabs.Screen name="account" options={{ title: t('tabs.account') }} />
        </Tabs>
      </HouseholdGate>
    </AuthGate>
  );
}
