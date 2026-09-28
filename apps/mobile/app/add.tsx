import AuthGate from '../src/components/AuthGate';
import HouseholdGate from '../src/components/HouseholdGate';
import QuickEntryScreen from '../src/screens/QuickEntryScreen';

/**
 * /add — quick expense entry, presented as a modal over the tabs (see the
 * root layout). It sits outside the (tabs) group, so it carries its own
 * gates — the same two the tabs have, so a deep link cannot skip the terms.
 */
export default function Add() {
  return (
    <AuthGate>
      <HouseholdGate>
        <QuickEntryScreen />
      </HouseholdGate>
    </AuthGate>
  );
}
