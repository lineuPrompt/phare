import AuthGate from '../src/components/AuthGate';
import HouseholdGate from '../src/components/HouseholdGate';
import AccountScreen from '../src/screens/AccountScreen';

/**
 * /account — email, accounts and balances, Phare Pro, privacy, sign out and
 * account deletion, opened from the More tab (2026-10-23; it was a tab of its
 * own). Outside the (tabs) group, so it carries the same two gates itself.
 */
export default function Account() {
  return (
    <AuthGate>
      <HouseholdGate>
        <AccountScreen />
      </HouseholdGate>
    </AuthGate>
  );
}
