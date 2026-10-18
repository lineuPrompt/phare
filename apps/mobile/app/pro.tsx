import AuthGate from '../src/components/AuthGate';
import HouseholdGate from '../src/components/HouseholdGate';
import ProScreen from '../src/screens/ProScreen';

/**
 * /pro — Phare Pro through Apple's in-app purchase, as a modal over the tabs.
 * Outside the (tabs) group, so it carries the same two gates itself.
 */
export default function Pro() {
  return (
    <AuthGate>
      <HouseholdGate>
        <ProScreen />
      </HouseholdGate>
    </AuthGate>
  );
}
