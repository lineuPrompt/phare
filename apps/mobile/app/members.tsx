import AuthGate from '../src/components/AuthGate';
import HouseholdGate from '../src/components/HouseholdGate';
import MembersScreen from '../src/screens/MembersScreen';

/**
 * /members — the household's members, opened from More. Outside the (tabs)
 * group, so it carries the same two gates itself.
 */
export default function Members() {
  return (
    <AuthGate>
      <HouseholdGate>
        <MembersScreen />
      </HouseholdGate>
    </AuthGate>
  );
}
