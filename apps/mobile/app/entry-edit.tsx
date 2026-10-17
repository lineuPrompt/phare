import AuthGate from '../src/components/AuthGate';
import HouseholdGate from '../src/components/HouseholdGate';
import EditEntryScreen from '../src/screens/EditEntryScreen';

/**
 * /entry-edit?id=…&kind=… — edit or delete one Timeline entry, as a modal over
 * the tabs. Outside the (tabs) group, so it carries the same two gates itself.
 */
export default function EntryEdit() {
  return (
    <AuthGate>
      <HouseholdGate>
        <EditEntryScreen />
      </HouseholdGate>
    </AuthGate>
  );
}
