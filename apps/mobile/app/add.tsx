import AuthGate from '../src/components/AuthGate';
import QuickEntryScreen from '../src/screens/QuickEntryScreen';

/**
 * /add — quick expense entry, presented as a modal over the tabs (see the
 * root layout). It sits outside the (tabs) group, so it carries its own gate.
 */
export default function Add() {
  return (
    <AuthGate>
      <QuickEntryScreen />
    </AuthGate>
  );
}
