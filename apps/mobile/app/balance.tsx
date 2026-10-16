import AuthGate from '../src/components/AuthGate';
import HouseholdGate from '../src/components/HouseholdGate';
import BalanceScreen from '../src/screens/BalanceScreen';

/**
 * /balance — set the chequing balance on a known date, as a modal over the
 * tabs. Outside the (tabs) group, so it carries the same two gates itself.
 */
export default function Balance() {
  return (
    <AuthGate>
      <HouseholdGate>
        <BalanceScreen />
      </HouseholdGate>
    </AuthGate>
  );
}
