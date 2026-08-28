// THE FIRST IMPORT IN THE APP, DELIBERATELY.
//
// Importing this module runs assertTimeZoneSupport() at bundle-evaluation
// time — before any component renders and before any household data could be
// read or written, which is what packages/core/README.md requires. Keeping it
// first means no future import can be evaluated ahead of it by accident.
import { TIMEZONE_PROBE } from '../src/lib/startupProbe';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nProvider } from '../src/i18n';
import TimeZoneErrorScreen from '../src/screens/TimeZoneErrorScreen';
import { theme } from '../src/theme';

export default function RootLayout() {
  // THE GATE. When the probe failed, this screen is the entire app: no Stack,
  // no navigator, no route to anywhere. See TimeZoneErrorScreen for why there
  // is deliberately no way past it.
  if (!TIMEZONE_PROBE.ok) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <TimeZoneErrorScreen message={TIMEZONE_PROBE.message} />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <I18nProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.color.background },
          }}
        />
      </I18nProvider>
    </SafeAreaProvider>
  );
}
