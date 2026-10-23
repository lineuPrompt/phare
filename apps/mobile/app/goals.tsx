import AuthGate from '../src/components/AuthGate';
import HouseholdGate from '../src/components/HouseholdGate';
import GoalsScreen from '../src/screens/GoalsScreen';

/**
 * /goals — savings goals and debts, opened from More. Outside the (tabs)
 * group, so it carries the same two gates itself.
 */
export default function Goals() {
  return (
    <AuthGate>
      <HouseholdGate>
        <GoalsScreen />
      </HouseholdGate>
    </AuthGate>
  );
}
