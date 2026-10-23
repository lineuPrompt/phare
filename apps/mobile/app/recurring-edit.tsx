import AuthGate from '../src/components/AuthGate';
import HouseholdGate from '../src/components/HouseholdGate';
import RecurringEditScreen from '../src/screens/RecurringEditScreen';

/**
 * /recurring-edit?id=… (edit) or ?type=income|expense|transfer (new), as a
 * modal over Recurring. Outside the (tabs) group, so it carries the gates.
 */
export default function RecurringEdit() {
  return (
    <AuthGate>
      <HouseholdGate>
        <RecurringEditScreen />
      </HouseholdGate>
    </AuthGate>
  );
}
