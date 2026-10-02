import { Redirect } from 'expo-router';

/**
 * /diagnostics — development builds only.
 *
 * In a production build (__DEV__ false) this route redirects home before the
 * screen is ever required, so a deep link (phare://diagnostics) leads nowhere
 * new: home is gated like every signed-in route. The screen module is required
 * lazily, inside the development branch, so production never evaluates it.
 */
export default function Diagnostics() {
  if (!__DEV__) return <Redirect href="/" />;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DiagnosticsScreen = require('../src/screens/DiagnosticsScreen').default;
  return <DiagnosticsScreen />;
}
