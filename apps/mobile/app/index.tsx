import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSession } from '../src/lib/useSession';
import SignInScreen from '../src/screens/SignInScreen';
import ReviewScreen from '../src/screens/ReviewScreen';
import { theme } from '../src/theme';

/**
 * The auth gate.
 *
 * Rendering the two screens conditionally rather than redirecting between two
 * routes is deliberate for a scaffold this size: a redirect on session change
 * races the sign-in call's own completion and can push a duplicate screen or
 * strand the user on a route the session no longer permits. One component that
 * reads one piece of state has no such race.
 *
 * The 'loading' branch matters — reading the persisted session out of
 * SecureStore is asynchronous, so treating "not yet known" as "signed out"
 * would flash the sign-in screen on every cold start for a signed-in user.
 */
export default function Index() {
  const session = useSession();

  if (session.status === 'loading') {
    return (
      <View style={styles.centred}>
        <ActivityIndicator color={theme.color.heading} />
      </View>
    );
  }

  return session.status === 'signedIn' ? <ReviewScreen /> : <SignInScreen />;
}

const styles = StyleSheet.create({
  centred: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.color.background,
  },
});
