import AuthGate from '../src/components/AuthGate';
import HouseholdGate from '../src/components/HouseholdGate';
import RecurringScreen from '../src/screens/RecurringScreen';

/**
 * /recurring — recurring income, bills and contributions, opened from More.
 * Outside the (tabs) group, so it carries the same two gates itself.
 */
export default function Recurring() {
  return (
    <AuthGate>
      <HouseholdGate>
        <RecurringScreen />
      </HouseholdGate>
    </AuthGate>
  );
}
