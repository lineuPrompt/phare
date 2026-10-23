import AuthGate from '../src/components/AuthGate';
import HouseholdGate from '../src/components/HouseholdGate';
import ReviewScreen from '../src/screens/ReviewScreen';

/**
 * /reviews — the monthly review, opened from the More tab (2026-10-23; it was
 * a tab of its own). Outside the (tabs) group, so it carries the same two
 * gates itself and cannot render signed out, deep link included.
 */
export default function Reviews() {
  return (
    <AuthGate>
      <HouseholdGate>
        <ReviewScreen />
      </HouseholdGate>
    </AuthGate>
  );
}
