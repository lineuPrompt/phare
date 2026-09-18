import AuthGate from '../src/components/AuthGate';
import ReviewScreen from '../src/screens/ReviewScreen';

/**
 * The home route: the monthly review, behind the auth gate.
 *
 * The gate itself (and the reasoning about why it renders the sign-in screen
 * in place rather than redirecting) moved into src/components/AuthGate.tsx
 * when /timeline was added — a second signed-in route needed the same
 * protection, and two copies of an auth decision is one too many.
 */
export default function Index() {
  return (
    <AuthGate>
      <ReviewScreen />
    </AuthGate>
  );
}
