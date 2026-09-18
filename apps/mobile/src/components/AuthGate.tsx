import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSession } from '../lib/useSession';
import { gateView } from '../lib/authGate';
import SignInScreen from '../screens/SignInScreen';
import { theme } from '../theme';

/**
 * The auth gate, shared by every signed-in route.
 *
 * WHY EVERY ROUTE AND NOT JUST THE INDEX. /timeline is a real route, so it is
 * reachable directly — a deep link, a notification, or the router restoring it
 * after a reload. Ungated, a signed-out device would render the screen, watch
 * its first request come back 401, and show "Your session has ended" where the
 * only useful thing is a sign-in form. Wrapping the route puts the form there
 * instead.
 *
 * RENDERING SignInScreen IN PLACE, NOT REDIRECTING. A redirect on session
 * change races the sign-in call's own completion and can push a duplicate
 * screen or strand the user on a route the session no longer permits. One
 * component reading one piece of state has no such race — and after signing
 * in, this gate re-renders straight into the screen the user was aiming at,
 * which a redirect to the index would have thrown away.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const view = gateView(useSession());

  if (view === 'loading') {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={theme.color.heading} />
      </View>
    );
  }

  return view === 'content' ? <>{children}</> : <SignInScreen />;
}

const styles = StyleSheet.create({
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.background,
  },
});
