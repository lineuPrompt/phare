import AuthGate from '../src/components/AuthGate';
import HouseholdGate from '../src/components/HouseholdGate';
import NewAccountScreen from '../src/screens/NewAccountScreen';

/**
 * /account-new?type=… — add an account, as a modal over the tabs. Outside the
 * (tabs) group, so it carries the same two gates itself.
 */
export default function AccountNew() {
  return (
    <AuthGate>
      <HouseholdGate>
        <NewAccountScreen />
      </HouseholdGate>
    </AuthGate>
  );
}
